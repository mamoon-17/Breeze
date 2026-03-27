import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/app-config.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatMessage } from './chat-message.entity';

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forFeature([ChatMessage]),
  ],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
