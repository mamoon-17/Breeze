import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  IsNull,
  LessThan,
  Not,
  Repository,
} from 'typeorm';
import { SocketStateService } from '../socket/socket-state.service';
import { ConversationService } from '../conversation/conversation.service';
import { ChatMessage } from './chat-message.entity';
import { MessageReceipt } from './message-receipt.entity';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(MessageReceipt)
    private readonly receiptRepository: Repository<MessageReceipt>,
    private readonly dataSource: DataSource,
    private readonly conversationService: ConversationService,
    private readonly socketState: SocketStateService,
  ) {}

  async saveMessage(dto: SendMessageDto, senderId: string): Promise<ChatMessage> {
    const memberIds = await this.conversationService.getMemberUserIds(dto.room);
    if (!memberIds.includes(senderId)) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const msg = manager.create(ChatMessage, {
        room: dto.room,
        senderId,
        message: dto.message ?? '',
        attachmentUrl: dto.attachmentUrl ?? null,
        attachmentType: dto.attachmentType ?? null,
        sentAt: now,
      });
      const message = await manager.save(msg);

      const recipients = memberIds.filter((id) => id !== senderId);
      if (recipients.length > 0) {
        await manager.insert(
          MessageReceipt,
          recipients.map((userId) => ({
            messageId: message.id,
            userId,
            deliveredAt: null,
            readAt: null,
          })),
        );
      }

      return message;
    });

    return this.chatMessageRepository.findOneOrFail({
      where: { id: saved.id },
      relations: ['receipts'],
    });
  }

  async deliverPendingMessages(
    userId: string,
  ): Promise<{ messageId: string; room: string; deliveredAt: Date }[]> {
    const pending = await this.receiptRepository
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.message', 'm')
      .where('r.userId = :userId', { userId })
      .andWhere('r.deliveredAt IS NULL')
      .andWhere('m.deletedAt IS NULL')
      .getMany();
    if (pending.length === 0) return [];

    const now = new Date();
    await this.receiptRepository.update(
      { id: In(pending.map((r) => r.id)) },
      { deliveredAt: now },
    );

    return pending.map((r) => ({
      messageId: r.messageId,
      room: r.message.room,
      deliveredAt: now,
    }));
  }

  /** Caller must ensure recipientId is authorized (e.g. server-managed delivery). */
  async markDelivered(
    recipientId: string,
    messageIds: string[],
  ): Promise<{ deliveredAt: Date }> {
    const now = new Date();
    if (messageIds.length === 0) {
      return { deliveredAt: now };
    }

    await this.receiptRepository
      .createQueryBuilder()
      .update(MessageReceipt)
      .set({ deliveredAt: now })
      .where('userId = :recipientId', { recipientId })
      .andWhere('messageId IN (:...messageIds)', { messageIds })
      .andWhere('deliveredAt IS NULL')
      .execute();

    return { deliveredAt: now };
  }

  /**
   * Recipient has read messages up to and including readUpToMessageId.
   */
  async markRead(
    userId: string,
    conversationId: string,
    readUpToMessageId: string,
  ): Promise<{ messageIds: string[]; readAt: Date }> {
    await this.conversationService.requireMember(userId, conversationId);

    const cursorExists = await this.chatMessageRepository.findOne({
      where: { id: readUpToMessageId, room: conversationId },
      select: ['id'],
    });
    if (!cursorExists) {
      throw new NotFoundException('Message not found in this conversation');
    }

    const now = new Date();

    // IMPORTANT: compare createdAt entirely in SQL via a subquery. Round-tripping
    // the cursor's timestamp through JS (`Date`, millisecond precision) silently
    // truncates the microseconds Postgres actually stores, which caused the
    // cursor row itself to fall OUT of a `createdAt <= :cursorTs` filter —
    // leaving the latest message stuck on "Delivered" forever.
    const toMark = await this.chatMessageRepository
      .createQueryBuilder('m')
      .select('m.id', 'id')
      .where('m.room = :room', { room: conversationId })
      .andWhere('m."senderId" != :userId', { userId })
      .andWhere('m."deletedAt" IS NULL')
      .andWhere(
        `m."createdAt" <= (SELECT c."createdAt" FROM chat_messages c WHERE c.id = :cursorId)`,
        { cursorId: readUpToMessageId },
      )
      .getRawMany<{ id: string }>();

    const ids = toMark.map((m) => m.id);

    if (ids.length > 0) {
      await this.receiptRepository
        .createQueryBuilder()
        .update(MessageReceipt)
        .set({ deliveredAt: now })
        .where('messageId IN (:...ids)', { ids })
        .andWhere('userId = :userId', { userId })
        .andWhere('deliveredAt IS NULL')
        .execute();

      await this.receiptRepository
        .createQueryBuilder()
        .update(MessageReceipt)
        .set({ readAt: now })
        .where('messageId IN (:...ids)', { ids })
        .andWhere('userId = :userId', { userId })
        .andWhere('readAt IS NULL')
        .execute();
    }

    await this.conversationService.updateLastReadAt(userId, conversationId, now);

    return { messageIds: ids, readAt: now };
  }

  async getRoomHistory(
    room: string,
    limit = 50,
    before?: string,
  ): Promise<ChatMessage[]> {
    let beforeDate: Date | undefined;

    if (before) {
      const cursor = await this.chatMessageRepository.findOne({
        where: { id: before, room },
        select: ['createdAt'],
      });
      if (cursor) {
        beforeDate = cursor.createdAt;
      }
    }

    return this.chatMessageRepository.find({
      where: {
        room,
        deletedAt: IsNull(),
        ...(beforeDate ? { createdAt: LessThan(beforeDate) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['receipts'],
    });
  }

  async deleteMessage(
    requesterId: string,
    room: string,
    messageId: string,
  ): Promise<{ messageId: string; room: string; deletedAt: Date }> {
    await this.conversationService.requireMember(requesterId, room);

    const msg = await this.chatMessageRepository.findOne({
      where: { id: messageId, room },
      withDeleted: true,
    });
    if (!msg || msg.deletedAt) {
      throw new NotFoundException('Message not found');
    }
    if (msg.senderId !== requesterId) {
      throw new ForbiddenException('Only the sender can delete this message');
    }

    const deleted = await this.chatMessageRepository.softRemove(msg);
    return { messageId: deleted.id, room: deleted.room, deletedAt: deleted.deletedAt! };
  }

  async broadcastAnnouncement(text: string): Promise<void> {
    this.socketState.emitToAll('announcement', { text, timestamp: new Date() });
  }

  async getUnreadCounts(
    userId: string,
  ): Promise<{ conversationId: string; unreadCount: number }[]> {
    const rows = await this.receiptRepository
      .createQueryBuilder('r')
      .innerJoin('r.message', 'm')
      .select('m.room', 'conversationId')
      .addSelect('COUNT(*)', 'unreadCount')
      .where('r.userId = :userId', { userId })
      .andWhere('r.readAt IS NULL')
      .andWhere('m.deletedAt IS NULL')
      .groupBy('m.room')
      .getRawMany<{ conversationId: string; unreadCount: string }>();

    return rows.map((r) => ({
      conversationId: r.conversationId,
      unreadCount: Number(r.unreadCount) || 0,
    }));
  }
}
