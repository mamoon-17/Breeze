import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async getRoomHistory(room: string, limit = 50): Promise<ChatMessage[]> {
    return this.chatMessageRepository.find({
      where: { room },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async broadcastAnnouncement(text: string): Promise<void> {
    this.socketState.emitToAll('announcement', { text, timestamp: new Date() });
  }
}
