import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { Conversation } from './conversation.entity';
import { Membership } from './membership.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Membership]),
    AuthModule,
    forwardRef(() => ChatModule),
  ],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
