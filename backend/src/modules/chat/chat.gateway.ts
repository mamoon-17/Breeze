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

const wsValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@WebSocketGateway()
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
    this.socketState.addSocket(userId, client.id);

    const results = await this.chatService.deliverPendingMessages(userId);
    for (const { messageId, room, deliveredAt } of results) {
      this.socketState.emitToRoom(room, 'messageDelivered', {
        messageId,
        userId,
        deliveredAt,
      });
    }

    this.logger.log(`Client connected: ${client.id} (user: ${userId})`);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.user?.id;
    if (userId) {
      this.socketState.removeSocket(userId, client.id);
    }
    this.logger.log(
      `Client disconnected: ${client.id} (user: ${userId ?? 'unknown'})`,
    );
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
}
