import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Conversation } from './conversation.entity';
import { Membership } from './membership.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Membership)
    private readonly membershipRepository: Repository<Membership>,
    private readonly dataSource: DataSource,
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

    return this.dataSource.transaction(async (manager) => {
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
  }

  // ─── Group ───────────────────────────────────────────────────────────────────

  async createGroup(
    creatorId: string,
    dto: CreateGroupDto,
  ): Promise<Conversation> {
    const memberIds = [...new Set([creatorId, ...dto.memberIds])];

    // After deduplication (creator may already be in memberIds), a group needs
    // at least 2 distinct participants — otherwise it's just a note-to-self.
    if (memberIds.length < 2) {
      throw new BadRequestException(
        'A group conversation requires at least one other member besides yourself',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const conversation = manager.create(Conversation, {
        type: 'group',
        name: dto.name,
        avatarUrl: dto.avatarUrl ?? null,
      });
      const saved = await manager.save(conversation);

      await manager.insert(
        Membership,
        memberIds.map((userId) => ({
          userId,
          conversationId: saved.id,
          lastReadAt: null,
        })),
      );

      return saved;
    });
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

  async addMember(
    requesterId: string,
    conversationId: string,
    newUserId: string,
  ): Promise<void> {
    const conversation = await this.findOneOrFail(conversationId);

    if (conversation.type === 'dm') {
      throw new BadRequestException('Cannot add members to a DM conversation');
    }

    await this.requireMember(requesterId, conversationId);

    const alreadyMember = await this.isMember(newUserId, conversationId);
    if (alreadyMember) {
      throw new BadRequestException('User is already a member of this conversation');
    }

    await this.membershipRepository.insert({
      userId: newUserId,
      conversationId,
      lastReadAt: null,
    });
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

    await this.membershipRepository.remove(membership);
  }

  async getMembers(
    requesterId: string,
    conversationId: string,
  ): Promise<Membership[]> {
    await this.requireMember(requesterId, conversationId);

    return this.membershipRepository.find({
      where: { conversationId },
      order: { joinedAt: 'ASC' },
    });
  }

  // ─── Shared ──────────────────────────────────────────────────────────────────

  async isMember(userId: string, conversationId: string): Promise<boolean> {
    const count = await this.membershipRepository.count({
      where: { userId, conversationId },
    });
    return count > 0;
  }

  async getConversationsForUser(userId: string): Promise<Conversation[]> {
    return this.conversationRepository
      .createQueryBuilder('c')
      .innerJoin('c.memberships', 'm', 'm.userId = :userId', { userId })
      .orderBy('c.createdAt', 'DESC')
      .getMany();
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
}
