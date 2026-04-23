import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ConversationInvitation } from './conversation-invitation.entity';
import { Conversation } from './conversation.entity';
import { Membership } from './membership.entity';
import { User } from '../user/user.entity';
import { SocketStateService } from '../socket/socket-state.service';
import {
  effectiveAvatarUrl,
  effectiveDisplayName,
} from '../user/user-projection';

export interface HydratedInvitation {
  id: string;
  status: ConversationInvitation['status'];
  createdAt: Date;
  respondedAt: Date | null;
  conversation: {
    id: string;
    type: Conversation['type'];
    name: string | null;
    avatarUrl: string | null;
  };
  inviter: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
  };
  invitee: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
  };
}

@Injectable()
export class ConversationInvitationService {
  private readonly logger = new Logger(ConversationInvitationService.name);

  constructor(
    @InjectRepository(ConversationInvitation)
    private readonly invitationRepo: Repository<ConversationInvitation>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Membership)
    private readonly membershipRepo: Repository<Membership>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly socketState: SocketStateService,
  ) {}

  /**
   * Invite multiple users (by email) to a group. Only emails belonging to
   * existing Breeze users are invited; unknown emails are returned so the
   * caller can surface a "not on Breeze" hint to the user.
   */
  async inviteEmails(
    inviterId: string,
    conversationId: string,
    emails: string[],
  ): Promise<{
    invitations: HydratedInvitation[];
    unknownEmails: string[];
    skipped: { email: string; reason: string }[];
  }> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.type === 'dm') {
      throw new BadRequestException('Cannot invite people to a DM');
    }

    const inviterMembership = await this.membershipRepo.findOne({
      where: { userId: inviterId, conversationId },
    });
    if (!inviterMembership) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const normalizedEmails = Array.from(
      new Set(emails.map((e) => e.trim().toLowerCase())),
    );

    const users = await this.userRepo.find({
      where: { email: In(normalizedEmails) },
    });
    const knownByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    const unknownEmails = normalizedEmails.filter(
      (e) => !knownByEmail.has(e),
    );

    const existingMembers = await this.membershipRepo.find({
      where: {
        conversationId,
        userId: In(users.map((u) => u.id)),
      },
      withDeleted: true,
    });
    const activeMemberIds = new Set(
      existingMembers
        .filter((m) => !m.leftAt)
        .map((m) => m.userId),
    );

    const skipped: { email: string; reason: string }[] = [];
    const toInvite: User[] = [];
    for (const user of users) {
      if (user.id === inviterId) {
        skipped.push({ email: user.email, reason: 'self' });
        continue;
      }
      if (activeMemberIds.has(user.id)) {
        skipped.push({ email: user.email, reason: 'already_member' });
        continue;
      }
      toInvite.push(user);
    }

    const created: ConversationInvitation[] = [];
    for (const user of toInvite) {
      const existing = await this.invitationRepo.findOne({
        where: { conversationId, inviteeId: user.id },
      });

      if (existing) {
        existing.status = 'pending';
        existing.inviterId = inviterId;
        existing.respondedAt = null;
        const saved = await this.invitationRepo.save(existing);
        created.push(saved);
      } else {
        const row = this.invitationRepo.create({
          conversationId,
          inviterId,
          inviteeId: user.id,
          status: 'pending',
        });
        const saved = await this.invitationRepo.save(row);
        created.push(saved);
      }
    }

    const inviter = await this.userRepo.findOne({ where: { id: inviterId } });
    if (!inviter) {
      throw new NotFoundException('Inviter user not found');
    }

    const hydrated = created.map((inv) => {
      const invitee = knownByEmail.get(
        users.find((u) => u.id === inv.inviteeId)?.email.toLowerCase() ?? '',
      );
      return this.hydrate(inv, conversation, inviter, invitee ?? users[0]);
    });

    // Notify invitees in real-time so their "Invitations" badge updates.
    for (const inv of hydrated) {
      this.socketState.emitToUser(
        inv.invitee.id,
        'invitationReceived',
        inv,
      );
    }

    return {
      invitations: hydrated,
      unknownEmails,
      skipped,
    };
  }

  async listPendingForUser(userId: string): Promise<HydratedInvitation[]> {
    const rows = await this.invitationRepo.find({
      where: { inviteeId: userId, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
    if (rows.length === 0) return [];

    const conversationIds = Array.from(
      new Set(rows.map((r) => r.conversationId)),
    );
    const inviterIds = Array.from(new Set(rows.map((r) => r.inviterId)));

    const [conversations, inviters, invitee] = await Promise.all([
      this.conversationRepo.find({ where: { id: In(conversationIds) } }),
      this.userRepo.find({ where: { id: In(inviterIds) } }),
      this.userRepo.findOne({ where: { id: userId } }),
    ]);
    if (!invitee) return [];

    const convoById = new Map(conversations.map((c) => [c.id, c]));
    const inviterById = new Map(inviters.map((u) => [u.id, u]));

    return rows.flatMap((row) => {
      const convo = convoById.get(row.conversationId);
      const inviter = inviterById.get(row.inviterId);
      if (!convo || !inviter) return [];
      return [this.hydrate(row, convo, inviter, invitee)];
    });
  }

  async accept(
    userId: string,
    invitationId: string,
  ): Promise<{ conversationId: string }> {
    const invitation = await this.invitationRepo.findOne({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.inviteeId !== userId) {
      throw new ForbiddenException('This invitation is not for you');
    }
    if (invitation.status !== 'pending') {
      throw new BadRequestException(
        `Invitation is already ${invitation.status}`,
      );
    }

    const conversationId = invitation.conversationId;

    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(Membership, {
        where: { userId, conversationId },
        withDeleted: true,
      });

      if (existing && existing.leftAt) {
        await manager.restore(Membership, { id: existing.id });
        await manager.update(
          Membership,
          { id: existing.id },
          { lastReadAt: null },
        );
      } else if (!existing) {
        await manager.insert(Membership, {
          userId,
          conversationId,
          lastReadAt: null,
        });
      }

      invitation.status = 'accepted';
      invitation.respondedAt = new Date();
      await manager.save(invitation);
    });

    // Let existing members know someone joined (sidebar / member list update).
    this.socketState.emitToRoom(conversationId, 'memberAdded', {
      conversationId,
      userId,
    });

    // Let the accepter's own sockets refresh their conversation list & open it.
    this.socketState.emitToUser(userId, 'invitationUpdated', {
      id: invitation.id,
      status: 'accepted',
      conversationId,
    });

    // Let the original inviter know their invite was accepted.
    this.socketState.emitToUser(invitation.inviterId, 'invitationUpdated', {
      id: invitation.id,
      status: 'accepted',
      conversationId,
    });

    return { conversationId };
  }

  async reject(userId: string, invitationId: string): Promise<void> {
    const invitation = await this.invitationRepo.findOne({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.inviteeId !== userId) {
      throw new ForbiddenException('This invitation is not for you');
    }
    if (invitation.status !== 'pending') {
      throw new BadRequestException(
        `Invitation is already ${invitation.status}`,
      );
    }

    invitation.status = 'rejected';
    invitation.respondedAt = new Date();
    await this.invitationRepo.save(invitation);

    this.socketState.emitToUser(userId, 'invitationUpdated', {
      id: invitation.id,
      status: 'rejected',
      conversationId: invitation.conversationId,
    });
    this.socketState.emitToUser(invitation.inviterId, 'invitationUpdated', {
      id: invitation.id,
      status: 'rejected',
      conversationId: invitation.conversationId,
    });
  }

  async cancel(requesterId: string, invitationId: string): Promise<void> {
    const invitation = await this.invitationRepo.findOne({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    // The inviter or any current member of the conversation can cancel.
    const membership = await this.membershipRepo.findOne({
      where: {
        userId: requesterId,
        conversationId: invitation.conversationId,
      },
    });
    if (invitation.inviterId !== requesterId && !membership) {
      throw new ForbiddenException('Not allowed to cancel this invitation');
    }
    if (invitation.status !== 'pending') {
      throw new BadRequestException(
        `Invitation is already ${invitation.status}`,
      );
    }

    invitation.status = 'cancelled';
    invitation.respondedAt = new Date();
    await this.invitationRepo.save(invitation);

    this.socketState.emitToUser(invitation.inviteeId, 'invitationUpdated', {
      id: invitation.id,
      status: 'cancelled',
      conversationId: invitation.conversationId,
    });
  }

  private hydrate(
    row: ConversationInvitation,
    convo: Conversation,
    inviter: User,
    invitee: User,
  ): HydratedInvitation {
    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      respondedAt: row.respondedAt,
      conversation: {
        id: convo.id,
        type: convo.type,
        name: convo.name,
        avatarUrl: convo.avatarUrl,
      },
      inviter: {
        id: inviter.id,
        email: inviter.email,
        displayName: effectiveDisplayName(inviter),
        avatarUrl: effectiveAvatarUrl(inviter),
      },
      invitee: {
        id: invitee.id,
        email: invitee.email,
        displayName: effectiveDisplayName(invitee),
        avatarUrl: effectiveAvatarUrl(invitee),
      },
    };
  }
}
