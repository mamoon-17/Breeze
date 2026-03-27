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
import { Server, Socket } from 'socket.io';
import { AppConfigService } from '../../config/app-config.service';
import { ChatService } from './chat.service';
import { SocketStateService } from '../socket/socket-state.service';
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
  ) {}

  afterInit(server: Server) {
    server.engine.opts.cors = {
      origin: this.appConfig.allowedOrigins,
      credentials: true,
    };
    this.socketState.setServer(server);
    this.logger.log(
      `WebSocket gateway initialised — allowed origins: ${this.appConfig.allowedOrigins.join(', ')}`,
    );
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() dto: SendMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const message = await this.chatService.saveMessage(dto, client.id);
    this.socketState.emitToRoom(dto.room, 'newMessage', message);
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() room: string,
    @ConnectedSocket() client: Socket,
  ) {
    void client.join(room);
    client.emit('joinedRoom', room);
  }
}
