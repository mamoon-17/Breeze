import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Conversation } from './conversation.entity';
import { Membership } from './membership.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { User } from '../user/user.entity';
import { ChatMessage } from '../chat/chat-message.entity';
import { MessageReceipt } from '../chat/message-receipt.entity';
import { ChatMessageAttachment } from '../chat/chat-message-attachment.entity';
import {
  ConversationInvitationService,
  HydratedInvitation,
} from './conversation-invitation.service';
import { SocketStateService } from '../socket/socket-state.service';
import {
  effectiveAvatarUrl,
  effectiveDisplayName,
} from '../user/user-projection';

/**
 * Conversation payload returned to the sidebar. DMs carry a lightweight `peer`
 * projection so the UI can render the other participant's name/avatar without
 * an extra /members round-trip. `lastMessage` + `unreadCount` are hydrated
 * server-side so that a page refresh restores the exact same sidebar the user
 * saw live, without the "No messages yet" flash.
 */
export interface HydratedConversation {
  id: string;
  type: Conversation['type'];
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  peer: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  lastMessage: {
    id: string;
    room: string;
    senderId: string;
    message: string;
    attachmentUrl?: string | null;
    attachmentType?: string | null;
    attachmentsCount?: number;
    firstAttachmentType?: string | null;
    sentAt: Date;
    createdAt: Date;
  } | null;
  unreadCount: number;
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Membership)
    private readonly membershipRepository: Repository<Membership>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(MessageReceipt)
    private readonly receiptRepository: Repository<MessageReceipt>,
    @InjectRepository(ChatMessageAttachment)
    private readonly attachmentRepository: Repository<ChatMessageAttachment>,
    private readonly dataSource: DataSource,
    private readonly invitationService: ConversationInvitationService,
    private readonly socketState: SocketStateService,
  ) {}

  // ─── DM ──────────────────────────────────────────────────────────────────────

  /**
   * Returns the existing DM conversation between two users, or creates one.
   * Idempotent — calling it twice with the same pair returns the same row.
   */
  async getOrCreateDm(userIdA: string, userIdB: string): Promise<Conversation> {
    if (userIdA === userIdB) {
      throw new BadRequestException('Cannot create a DM with yourself');
    }

    const existing = await this.conversationRepository
      .createQueryBuilder('c')
      .innerJoin('c.memberships', 'ma', 'ma.userId = :a', { a: userIdA })
      .innerJoin('c.memberships', 'mb', 'mb.userId = :b', { b: userIdB })
      .where('c.type = :type', { type: 'dm' })
      .getOne();

    if (existing) {
      return existing;
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const conversation = manager.create(Conversation, {
        type: 'dm',
        name: null,
        avatarUrl: null,
      });
      const saved = await manager.save(conversation);

      await manager.insert(Membership, [
        { userId: userIdA, conversationId: saved.id, lastReadAt: null },
        { userId: userIdB, conversationId: saved.id, lastReadAt: null },
      ]);

      return saved;
    });

    // Push the newly created DM to both participants so their sidebars update
    // in realtime — no refresh required.
    for (const userId of [userIdA, userIdB]) {
      this.socketState.emitToUser(userId, 'conversationCreated', {
        id: created.id,
        type: created.type,
        name: created.name,
        avatarUrl: created.avatarUrl,
        createdAt: created.createdAt,
      });
    }

    return created;
  }

  /**
   * DM creation by email. DMs don't require invitations — once both parties
   * exist, the conversation is visible for both of them.
   */
  async getOrCreateDmByEmail(
    requesterId: string,
    targetEmail: string,
  ): Promise<Conversation> {
    const normalized = targetEmail.trim().toLowerCase();
    const target = await this.userRepository.findOne({
      where: { email: normalized },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    return this.getOrCreateDm(requesterId, target.id);
  }

  // ─── Group ───────────────────────────────────────────────────────────────────

  /**
   * Creates a group where the creator is the only immediate member. Everyone
   * else is invited and must accept before joining.
   */
  async createGroup(
    creatorId: string,
    dto: CreateGroupDto,
  ): Promise<{
    conversation: Conversation;
    invitations: HydratedInvitation[];
    unknownEmails: string[];
    skipped: { email: string; reason: string }[];
  }> {
    const conversation = await this.dataSource.transaction(async (manager) => {
      const convo = manager.create(Conversation, {
        type: 'group',
        name: dto.name,
        avatarUrl: dto.avatarUrl ?? null,
      });
      const saved = await manager.save(convo);

      await manager.insert(Membership, {
        userId: creatorId,
        conversationId: saved.id,
        lastReadAt: null,
      });

      return saved;
    });

    const emails = dto.memberEmails ?? [];
    if (emails.length === 0) {
      return {
        conversation,
        invitations: [],
        unknownEmails: [],
        skipped: [],
      };
    }

    const result = await this.invitationService.inviteEmails(
      creatorId,
      conversation.id,
      emails,
    );

    return {
      conversation,
      invitations: result.invitations,
      unknownEmails: result.unknownEmails,
      skipped: result.skipped,
    };
  }

  async updateConversation(
    requesterId: string,
    conversationId: string,
    dto: UpdateConversationDto,
  ): Promise<Conversation> {
    const conversation = await this.findOneOrFail(conversationId);

    if (conversation.type === 'dm') {
      throw new BadRequestException('DM conversations cannot be updated');
    }

    await this.requireMember(requesterId, conversationId);

    if (dto.name !== undefined) conversation.name = dto.name;
    if (dto.avatarUrl !== undefined) conversation.avatarUrl = dto.avatarUrl;

    return this.conversationRepository.save(conversation);
  }

  async removeMember(
    requesterId: string,
    conversationId: string,
    targetUserId: string,
  ): Promise<void> {
    const conversation = await this.findOneOrFail(conversationId);

    if (conversation.type === 'dm') {
      throw new BadRequestException('Cannot remove members from a DM conversation');
    }

    // Members can remove themselves (leave); otherwise requester must be a member
    if (requesterId !== targetUserId) {
      await this.requireMember(requesterId, conversationId);
    }

    const membership = await this.membershipRepository.findOne({
      where: { userId: targetUserId, conversationId },
    });

    if (!membership) {
      throw new NotFoundException('User is not a member of this conversation');
    }

    await this.membershipRepository.softRemove(membership);
  }

  async leaveGroup(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.findOneOrFail(conversationId);
    if (conversation.type !== 'group') {
      throw new BadRequestException('Only group conversations can be left');
    }

    const membership = await this.membershipRepository.findOne({
      where: { userId, conversationId },
    });
    if (!membership) {
      throw new NotFoundException('User is not a member of this conversation');
    }

    await this.membershipRepository.softRemove(membership);
  }

  async getMembers(
    requesterId: string,
    conversationId: string,
  ): Promise<
    Array<{
      id: string;
      userId: string;
      conversationId: string;
      joinedAt: Date;
      lastReadAt: Date | null;
      user: {
        id: string;
        email: string;
        displayName: string;
        avatarUrl: string | null;
      } | null;
    }>
  > {
    await this.requireMember(requesterId, conversationId);

    const memberships = await this.membershipRepository.find({
      where: { conversationId },
      order: { joinedAt: 'ASC' },
    });

    if (memberships.length === 0) return [];

    const users = await this.userRepository.find({
      where: { id: In(memberships.map((m) => m.userId)) },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return memberships.map((m) => {
      const u = userById.get(m.userId);
      return {
        id: m.id,
        userId: m.userId,
        conversationId: m.conversationId,
        joinedAt: m.joinedAt,
        lastReadAt: m.lastReadAt,
        user: u
          ? {
              id: u.id,
              email: u.email,
              displayName: effectiveDisplayName(u),
              avatarUrl: effectiveAvatarUrl(u),
            }
          : null,
      };
    });
  }

  // ─── Shared ──────────────────────────────────────────────────────────────────

  async isMember(userId: string, conversationId: string): Promise<boolean> {
    const count = await this.membershipRepository.count({
      where: { userId, conversationId },
    });
    return count > 0;
  }

  async getMemberUserIds(conversationId: string): Promise<string[]> {
    const rows = await this.membershipRepository.find({
      where: { conversationId },
      select: ['userId'],
    });
    return rows.map((r) => r.userId);
  }

  async getConversationsForUser(
    userId: string,
  ): Promise<HydratedConversation[]> {
    const conversations = await this.conversationRepository
      .createQueryBuilder('c')
      .innerJoin('c.memberships', 'm', 'm.userId = :userId', { userId })
      .orderBy('c.createdAt', 'DESC')
      .getMany();

    if (conversations.length === 0) return [];

    // For DMs, look up the "other" membership to hydrate the peer avatar/name
    // in a single query — the sidebar is entirely name-driven and we don't
    // want to force the client to fan out to /members for every conversation.
    const dmIds = conversations
      .filter((c) => c.type === 'dm')
      .map((c) => c.id);

    const peerByConversation = new Map<string, User>();

    if (dmIds.length > 0) {
      const peerMemberships = await this.membershipRepository
        .createQueryBuilder('m')
        .where('m.conversationId IN (:...ids)', { ids: dmIds })
        .andWhere('m.userId != :userId', { userId })
        .getMany();

      const peerUserIds = Array.from(
        new Set(peerMemberships.map((m) => m.userId)),
      );
      const peers =
        peerUserIds.length > 0
          ? await this.userRepository.find({
              where: { id: In(peerUserIds) },
            })
          : [];
      const peerById = new Map(peers.map((u) => [u.id, u]));

      for (const m of peerMemberships) {
        const peer = peerById.get(m.userId);
        if (peer) peerByConversation.set(m.conversationId, peer);
      }
    }

    const conversationIds = conversations.map((c) => c.id);

    // Last message per conversation — one row per room via DISTINCT ON
    // (Postgres). Sorted by createdAt DESC so we pick up the newest non-deleted
    // message, which is what the sidebar preview wants to show.
    const lastMessages: ChatMessage[] =
      conversationIds.length > 0
        ? await this.chatMessageRepository
            .createQueryBuilder('m')
            .distinctOn(['m.room'])
            .where('m.room IN (:...ids)', { ids: conversationIds })
            .andWhere('m."deletedAt" IS NULL')
            .orderBy('m.room')
            .addOrderBy('m."createdAt"', 'DESC')
            .getMany()
        : [];
    const lastMessageByConversation = new Map(
      lastMessages.map((m) => [m.room, m]),
    );

    const lastIds = lastMessages.map((m) => m.id);
    const attachmentCounts =
      lastIds.length > 0
        ? await this.attachmentRepository
            .createQueryBuilder('a')
            .select('a."messageId"', 'messageId')
            .addSelect('COUNT(*)', 'count')
            .addSelect('MIN(a."type")', 'firstType')
            .where('a."messageId" IN (:...ids)', { ids: lastIds })
            .groupBy('a."messageId"')
            .getRawMany<{ messageId: string; count: string; firstType: string }>()
        : [];
    const attachmentByMessageId = new Map(
      attachmentCounts.map((r) => [
        r.messageId,
        { count: Number(r.count) || 0, firstType: r.firstType ?? null },
      ]),
    );

    // Unread counts: how many messages in each conversation this user hasn't
    // read yet (receipts rows for the current user with readAt IS NULL).
    const unreadRows =
      conversationIds.length > 0
        ? await this.receiptRepository
            .createQueryBuilder('r')
            .innerJoin('r.message', 'm')
            .select('m.room', 'conversationId')
            .addSelect('COUNT(*)', 'unreadCount')
            .where('r.userId = :userId', { userId })
            .andWhere('r.readAt IS NULL')
            .andWhere('m."deletedAt" IS NULL')
            .andWhere('m.room IN (:...ids)', { ids: conversationIds })
            .groupBy('m.room')
            .getRawMany<{ conversationId: string; unreadCount: string }>()
        : [];
    const unreadByConversation = new Map(
      unreadRows.map((r) => [r.conversationId, Number(r.unreadCount) || 0]),
    );

    return conversations.map((c) => {
      const peer = peerByConversation.get(c.id);
      const last = lastMessageByConversation.get(c.id) ?? null;
      const attachmentMeta = last ? attachmentByMessageId.get(last.id) : undefined;
      const legacyCount = last?.attachmentType ? 1 : 0;
      const legacyFirstType = last?.attachmentType ?? null;
      const combinedCount = (attachmentMeta?.count ?? 0) + legacyCount;
      const combinedFirstType =
        legacyFirstType ?? attachmentMeta?.firstType ?? null;
      return {
        id: c.id,
        type: c.type,
        name: c.name,
        avatarUrl: c.avatarUrl,
        createdAt: c.createdAt,
        peer: peer
          ? {
              id: peer.id,
              email: peer.email,
              displayName: effectiveDisplayName(peer),
              avatarUrl: effectiveAvatarUrl(peer),
            }
          : null,
        lastMessage: last
          ? {
              id: last.id,
              room: last.room,
              senderId: last.senderId,
              message: last.message,
              attachmentUrl: last.attachmentUrl ?? null,
              attachmentType: last.attachmentType ?? null,
              attachmentsCount: combinedCount,
              firstAttachmentType: combinedFirstType,
              sentAt: last.sentAt,
              createdAt: last.createdAt,
            }
          : null,
        unreadCount: unreadByConversation.get(c.id) ?? 0,
      };
    });
  }

  async findOneOrFail(conversationId: string): Promise<Conversation> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  async requireMember(userId: string, conversationId: string): Promise<void> {
    const member = await this.isMember(userId, conversationId);
    if (!member) {
      throw new ForbiddenException('You are not a member of this conversation');
    }
  }

  async updateLastReadAt(
    userId: string,
    conversationId: string,
    at: Date,
  ): Promise<void> {
    await this.membershipRepository.update(
      { userId, conversationId },
      { lastReadAt: at },
    );
  }
}
