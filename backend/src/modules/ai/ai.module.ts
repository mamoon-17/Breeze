import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AuthModule } from '../auth/auth.module';
import { ConversationModule } from '../conversation/conversation.module';
import { ChatModule } from '../chat/chat.module';
import { ChatMessage } from '../chat/chat-message.entity';
import { User } from '../user/user.entity';
import { AiMessageJob } from './ai-message-job.entity';
import { AiMessageWriterService } from './ai-message-writer.service';
import { ReminderJob } from './reminder-job.entity';
import { ReminderService } from './reminder.service';
import { SocketModule } from '../socket/socket.module';
import { AiUserMemory } from './ai-user-memory.entity';
import { AiZenChatMessage } from './ai-zen-chat-message.entity';

@Module({
  imports: [
    AuthModule,
    ConversationModule,
    ChatModule,
    SocketModule,
    TypeOrmModule.forFeature([
      ChatMessage,
      User,
      AiMessageJob,
      ReminderJob,
      AiUserMemory,
      AiZenChatMessage,
    ]),
  ],
  controllers: [AiController],
  providers: [AiService, AiMessageWriterService, ReminderService],
  exports: [AiService],
})
export class AiModule {}

