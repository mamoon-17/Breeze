import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class SocketStateService {
  private server: Server;

  setServer(server: Server) {
    this.server = server;
  }

  emitToRoom(room: string, event: string, data: unknown) {
    this.server.to(room).emit(event, data);
  }

  emitToAll(event: string, data: unknown) {
    this.server.emit(event, data);
  }

  emitToSocket(socketId: string, event: string, data: unknown) {
    this.server.to(socketId).emit(event, data);
  }
}