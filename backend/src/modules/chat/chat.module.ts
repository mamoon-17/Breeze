import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/app-config.module';
import { AppConfigService } from '../../config/app-config.service';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { ConversationModule } from '../conversation/conversation.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatMessage } from './chat-message.entity';
import { MessageReceipt } from './message-receipt.entity';
import { ChatMessageAttachment } from './chat-message-attachment.entity';
import { WsJwtMiddleware } from '../auth/middlewares/ws-jwt.middleware';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    UserModule,
    NotificationsModule,
    forwardRef(() => ConversationModule),
    TypeOrmModule.forFeature([ChatMessage, MessageReceipt, ChatMessageAttachment]),
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        secret: appConfig.jwtAccessSecret,
      }),
    }),
  ],
  providers: [ChatGateway, ChatService, WsJwtMiddleware],
  exports: [ChatService],
})
export class ChatModule {}
