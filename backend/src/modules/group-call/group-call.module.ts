import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/app-config.module';
import { AppConfigService } from '../../config/app-config.service';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { ConversationModule } from '../conversation/conversation.module';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WsJwtMiddleware } from '../auth/middlewares/ws-jwt.middleware';
import { CallRecord } from '../call/call-record.entity';
import { GroupCallGateway } from './group-call.gateway';
import { GroupCallSessionMap } from './group-call-session.map';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    UserModule,
    ConversationModule,
    forwardRef(() => ChatModule),
    NotificationsModule,
    TypeOrmModule.forFeature([CallRecord]),
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        secret: appConfig.jwtAccessSecret,
      }),
    }),
  ],
  providers: [GroupCallGateway, GroupCallSessionMap, WsJwtMiddleware],
  exports: [GroupCallSessionMap],
})
export class GroupCallModule {}
