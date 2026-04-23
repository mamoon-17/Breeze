import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class SocketStateService {
  private server: Server;

  private userSockets: Map<string, Set<string>> = new Map();

  /**
   * Register a socket for a user. Returns true if this is the user's first
   * active socket (i.e. they just came online), false if they already had
   * other tabs/devices connected. The caller uses this to avoid broadcasting
   * redundant `userOnline` events on every tab-open.
   */
  addSocket(userId: string, socketId: string): boolean {
    let set = this.userSockets.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set<string>();
      this.userSockets.set(userId, set);
    }
    set.add(socketId);
    return wasOffline;
  }

  removeSocket(userId: string, socketId: string): void {
    const set = this.userSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
      this.userSockets.delete(userId);
    }
  }

  isUserOnline(userId: string): boolean {
    const set = this.userSockets.get(userId);
    return !!set && set.size > 0;
  }

  setServer(server: Server) {
    this.server = server;
  }

  /**
   * Disconnect all active sockets for a given user.
   * Safe to call even if the user is offline.
   */
  disconnectUser(userId: string, reason = 'forced_disconnect'): void {
    const set = this.userSockets.get(userId);
    if (!set || set.size === 0) return;

    for (const socketId of set) {
      const socket = this.server?.sockets?.sockets?.get(socketId);
      if (socket) {
        socket.emit('disconnectReason', { reason });
        socket.disconnect(true);
      }
    }

    this.userSockets.delete(userId);
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

  /**
   * Emit an event to every active socket owned by a specific user.
   * No-op if the user has no active connections.
   */
  emitToUser(userId: string, event: string, data: unknown) {
    const set = this.userSockets.get(userId);
    if (!set || set.size === 0) return;
    for (const socketId of set) {
      this.server.to(socketId).emit(event, data);
    }
  }
}