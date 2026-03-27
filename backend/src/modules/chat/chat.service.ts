import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { SocketStateService } from '../socket/socket-state.service';
import { ChatMessage } from './chat-message.entity';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    private readonly socketState: SocketStateService,
  ) {}

  async saveMessage(dto: SendMessageDto, senderId: string): Promise<ChatMessage> {
    const message = this.chatMessageRepository.create({
      room: dto.room,
      senderId,
      message: dto.message,
    });
    return this.chatMessageRepository.save(message);
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
    });
  }

  async broadcastAnnouncement(text: string): Promise<void> {
    this.socketState.emitToAll('announcement', { text, timestamp: new Date() });
  }
}
