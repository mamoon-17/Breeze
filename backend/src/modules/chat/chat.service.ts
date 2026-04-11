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
  LessThanOrEqual,
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
        message: dto.message,
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
    const pending = await this.receiptRepository.find({
      where: { userId, deliveredAt: IsNull() },
      relations: ['message'],
    });
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

    const cursor = await this.chatMessageRepository.findOne({
      where: { id: readUpToMessageId, room: conversationId },
    });
    if (!cursor) {
      throw new NotFoundException('Message not found in this conversation');
    }

    const now = new Date();

    const toMark = await this.chatMessageRepository.find({
      where: {
        room: conversationId,
        senderId: Not(userId),
        createdAt: LessThanOrEqual(cursor.createdAt),
      },
      select: ['id'],
    });

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
        ...(beforeDate ? { createdAt: LessThan(beforeDate) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['receipts'],
    });
  }

  async broadcastAnnouncement(text: string): Promise<void> {
    this.socketState.emitToAll('announcement', { text, timestamp: new Date() });
  }
}
