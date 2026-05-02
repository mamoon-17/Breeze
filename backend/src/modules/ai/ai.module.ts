import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AuthModule } from '../auth/auth.module';
import { ConversationModule } from '../conversation/conversation.module';
import { ChatMessage } from '../chat/chat-message.entity';
import { User } from '../user/user.entity';

@Module({
  imports: [
    AuthModule,
    ConversationModule,
    TypeOrmModule.forFeature([ChatMessage, User]),
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
