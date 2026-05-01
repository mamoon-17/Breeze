import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { UserModule } from '../user/user.module';
import { ConversationController } from './conversation.controller';
import { InvitationController } from './invitation.controller';
import { ConversationService } from './conversation.service';
import { ConversationInvitationService } from './conversation-invitation.service';
import { Conversation } from './conversation.entity';
import { Membership } from './membership.entity';
import { ConversationInvitation } from './conversation-invitation.entity';
import { User } from '../user/user.entity';
import { ChatMessage } from '../chat/chat-message.entity';
import { MessageReceipt } from '../chat/message-receipt.entity';
import { ChatMessageAttachment } from '../chat/chat-message-attachment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Membership,
      ConversationInvitation,
      User,
      ChatMessage,
      MessageReceipt,
      ChatMessageAttachment,
    ]),
    AuthModule,
    UserModule,
    forwardRef(() => ChatModule),
  ],
  controllers: [ConversationController, InvitationController],
  providers: [ConversationService, ConversationInvitationService],
  exports: [ConversationService],
})
export class ConversationModule {}
