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
import { MarkDeliveredDto } from './dto/mark-delivered.dto';
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

  handleConnection(client: AuthenticatedSocket) {
    this.logger.log(
      `Client connected: ${client.id} (user: ${client.data.user.id})`,
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(
      `Client disconnected: ${client.id} (user: ${client.data.user?.id ?? 'unknown'})`,
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
  }

  @SubscribeMessage('markDelivered')
  @UsePipes(wsValidationPipe)
  async handleMarkDelivered(
    @MessageBody() dto: MarkDeliveredDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const userId = client.data.user.id;
    const { updates, deliveredAt } = await this.chatService.markDelivered(
      userId,
      dto.messageIds,
    );

    for (const { messageId, room } of updates) {
      this.socketState.emitToRoom(room, 'messageDelivered', {
        messageId,
        userId,
        deliveredAt,
      });
    }

    return {
      ok: true,
      updatedMessageIds: updates.map((u) => u.messageId),
      deliveredAt,
    };
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
