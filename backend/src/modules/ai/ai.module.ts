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

@Module({
  imports: [
    AuthModule,
    ConversationModule,
    ChatModule,
    TypeOrmModule.forFeature([ChatMessage, User, AiMessageJob]),
  ],
  controllers: [AiController],
  providers: [AiService, AiMessageWriterService],
  exports: [AiService],
})
export class AiModule {}
