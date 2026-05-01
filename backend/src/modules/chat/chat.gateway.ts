import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { AppConfigService } from '../../config/app-config.service';
import { ChatService } from './chat.service';
import { SocketStateService } from '../socket/socket-state.service';
import { ConversationService } from '../conversation/conversation.service';
import { WsJwtMiddleware } from '../auth/middlewares/ws-jwt.middleware';
import type { AuthenticatedSocket } from '../../common/types/authenticated-socket';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { JwtService } from '@nestjs/jwt';
import type { JwtRefreshPayload } from '../auth/types/auth.types';
import { AuthService } from '../auth/auth.service';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { NotificationsService } from '../notifications/notifications.service';

const wsValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@WebSocketGateway({
  // Faster presence updates when a user closes their last tab.
  // With these values peers should see offline within ~7–12 seconds.
  pingInterval: 5000,
  pingTimeout: 7000,
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly socketState: SocketStateService,
    private readonly appConfig: AppConfigService,
    private readonly wsJwtMiddleware: WsJwtMiddleware,
    private readonly conversationService: ConversationService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly notificationsService: NotificationsService,
  ) {}

  afterInit(server: Server) {
    server.use(this.wsJwtMiddleware.build());

    server.engine.opts.cors = {
      origin: this.appConfig.allowedOrigins,
      credentials: true,
    };

    this.socketState.setServer(server);
    this.logger.log(
      `WebSocket gateway initialised — allowed origins: ${this.appConfig.allowedOrigins.join(', ')}`,
    );
  }

  async handleConnection(client: AuthenticatedSocket) {
    const userId = client.data.user.id;
    const justCameOnline = this.socketState.addSocket(userId, client.id);

    // Validate refresh session mid-connection (on each inbound packet).
    // If refresh token/session is expired or revoked, disconnect gracefully.
    const refresh = this.extractRefreshToken(client);
    if (refresh) {
      try {
        const payload = this.jwtService.verify<JwtRefreshPayload>(refresh, {
          secret: this.appConfig.jwtRefreshSecret,
        });
        if (
          payload?.tokenType === 'refresh' &&
          payload.sid &&
          payload.uid &&
          payload.uid === client.data.user.id
        ) {
          client.data.refreshSessionId = payload.sid;
          client.data.refreshTokenExp = (payload as unknown as { exp?: number }).exp;
        }
      } catch {
        // Ignore here; packet middleware below will force disconnect if needed.
      }
    }

    client.use(async (_packet, next) => {
      try {
        // 1) If access token got blacklisted after connection (logout), kick.
        if (client.data.accessTokenJti) {
          const isRevoked = await this.tokenBlacklistService.isBlacklisted(
            client.data.accessTokenJti,
          );
          if (isRevoked.isErr() || isRevoked.value) {
            client.emit('authExpired', { reason: 'access_token_revoked' });
            client.disconnect(true);
            return;
          }
        }

        // 2) Validate refresh session to ensure the session is still active.
        if (client.data.refreshSessionId) {
          const sessionResult = await this.authService.getSessionByRefreshPayload({
            tokenType: 'refresh',
            sid: client.data.refreshSessionId,
            uid: client.data.user.id,
            sub: client.data.user.providerId,
            email: client.data.user.email,
            provider: client.data.user.provider,
          });

          const session = sessionResult.isErr() ? null : sessionResult.value;
          const now = new Date();
          if (
            !session ||
            session.revokedAt ||
            session.expiresAt < now ||
            session.absoluteExpiresAt < now
          ) {
            client.emit('authExpired', { reason: 'refresh_session_invalid' });
            client.disconnect(true);
            return;
          }
        }

        next();
      } catch {
        client.emit('authExpired', { reason: 'session_validation_failed' });
        client.disconnect(true);
      }
    });

    const results = await this.chatService.deliverPendingMessages(userId);
    for (const { messageId, room, deliveredAt } of results) {
      this.socketState.emitToRoom(room, 'messageDelivered', {
        messageId,
        userId,
        deliveredAt,
      });
    }

    // Presence: join all conversation rooms this user is a member of,
    // then broadcast online status to those rooms.
    const conversations = await this.conversationService.getConversationsForUser(
      userId,
    );
    const roomIds = conversations.map((c) => c.id);
    if (roomIds.length > 0) {
      await client.join(roomIds);
      // Only broadcast 'userOnline' on the user's FIRST active socket — if
      // they already had another tab open, peers already saw them online and
      // a duplicate event would be noise.
      if (justCameOnline) {
        for (const room of roomIds) {
          this.socketState.emitToRoom(room, 'userOnline', { userId });
        }
      }
    }

    this.logger.log(`Client connected: ${client.id} (user: ${userId})`);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.user?.id;
    if (userId) {
      // Snapshot the rooms BEFORE removeSocket/disconnect finishes — by the
      // time Socket.IO tears down, client.rooms is empty and we'd broadcast
      // nothing. This is the same reason we excluded `client.id` (the
      // auto-join "self" room) below.
      const rooms = Array.from(client.rooms).filter((r) => r !== client.id);

      this.socketState.removeSocket(userId, client.id);

      // Presence: only broadcast 'userOffline' when THIS user has no other
      // active sockets. Multi-tab / multi-device users stay "online" as long
      // as at least one tab is still connected — closing a single tab must
      // not make peers see them as offline.
      if (!this.socketState.isUserOnline(userId)) {
        for (const room of rooms) {
          this.socketState.emitToRoom(room, 'userOffline', { userId });
        }
      }
    }
    this.logger.log(
      `Client disconnected: ${client.id} (user: ${userId ?? 'unknown'})`,
    );
  }

  private extractRefreshToken(socket: AuthenticatedSocket): string | null {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return null;
    const match = /(?:^|;\s*)refreshToken=([^;]+)/.exec(cookieHeader);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
    return null;
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const isMember = await this.conversationService.isMember(
      client.data.user.id,
      conversationId,
    );

    if (!isMember) {
      throw new WsException('Unauthorized: you are not a member of this conversation');
    }

    await client.join(conversationId);
    client.emit('joinedRoom', conversationId);
  }

  @SubscribeMessage('getPresence')
  async handleGetPresence(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const isMember = await this.conversationService.isMember(
      client.data.user.id,
      conversationId,
    );

    if (!isMember) {
      throw new WsException('Unauthorized: you are not a member of this conversation');
    }

    const memberIds =
      await this.conversationService.getMemberUserIds(conversationId);
    const onlineUserIds = memberIds.filter((id) =>
      this.socketState.isUserOnline(id),
    );

    return { conversationId, onlineUserIds };
  }

  @SubscribeMessage('sendMessage')
  @UsePipes(wsValidationPipe)
  async handleSendMessage(
    @MessageBody() dto: SendMessageDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const isMember = await this.conversationService.isMember(
      client.data.user.id,
      dto.room,
    );

    if (!isMember) {
      throw new WsException('Unauthorized: you are not a member of this conversation');
    }

    const message = await this.chatService.saveMessage(dto, client.data.user.id);
    this.socketState.emitToRoom(dto.room, 'newMessage', message);

    const memberIds = await this.conversationService.getMemberUserIds(dto.room);
    const recipients = memberIds.filter((id) => id !== client.data.user.id);
    for (const recipientId of recipients) {
      if (this.socketState.isUserOnline(recipientId)) {
        const { deliveredAt } = await this.chatService.markDelivered(recipientId, [
          message.id,
        ]);
        this.socketState.emitToRoom(dto.room, 'messageDelivered', {
          messageId: message.id,
          userId: recipientId,
          deliveredAt,
        });
      } else {
        await this.notificationsService.notifyNewMessage(recipientId, {
          type: 'new_message',
          room: dto.room,
          message: {
            id: message.id,
            senderId: message.senderId,
            message: message.message,
            sentAt: message.sentAt,
          },
        });
      }
    }
  }

  @SubscribeMessage('markRead')
  @UsePipes(wsValidationPipe)
  async handleMarkRead(
    @MessageBody() dto: MarkReadDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const userId = client.data.user.id;
    const { messageIds, readAt } = await this.chatService.markRead(
      userId,
      dto.conversationId,
      dto.readUpToMessageId,
    );

    this.socketState.emitToRoom(dto.conversationId, 'messagesSeen', {
      conversationId: dto.conversationId,
      userId,
      messageIds,
      readAt,
      readUpToMessageId: dto.readUpToMessageId,
    });

    return { ok: true, messageIds, readAt };
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const isMember = await this.conversationService.isMember(
      client.data.user.id,
      conversationId,
    );
    if (!isMember) return;

    // Broadcast to everyone in the room except the sender.
    client.to(conversationId).emit('userTyping', {
      conversationId,
      userId: client.data.user.id,
    });
  }

  @SubscribeMessage('stopTyping')
  async handleStopTyping(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const isMember = await this.conversationService.isMember(
      client.data.user.id,
      conversationId,
    );
    if (!isMember) return;

    client.to(conversationId).emit('userStopTyping', {
      conversationId,
      userId: client.data.user.id,
    });
  }

  @SubscribeMessage('deleteMessage')
  @UsePipes(wsValidationPipe)
  async handleDeleteMessage(
    @MessageBody() dto: DeleteMessageDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const result = await this.chatService.deleteMessage(
      client.data.user.id,
      dto.room,
      dto.messageId,
    );

    this.socketState.emitToRoom(dto.room, 'messageDeleted', result);
    return { ok: true };
  }
}
