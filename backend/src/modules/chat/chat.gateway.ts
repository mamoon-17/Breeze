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
import { Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AppConfigService } from '../../config/app-config.service';
import { ChatService } from './chat.service';
import { SocketStateService } from '../socket/socket-state.service';
import { ConversationService } from '../conversation/conversation.service';
import { WsJwtMiddleware } from '../auth/middlewares/ws-jwt.middleware';
import type { AuthenticatedSocket } from '../../common/types/authenticated-socket';
import { SendMessageDto } from './dto/send-message.dto';

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
  async handleSendMessage(
    @MessageBody() dto: SendMessageDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    // Double-check membership on every message — the socket.io room set is
    // client-side state and cannot be trusted as the sole authorization gate.
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
}
