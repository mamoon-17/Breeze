import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server } from 'socket.io';
import { AppConfigService } from '../../config/app-config.service';
import { SocketStateService } from '../socket/socket-state.service';
import { WsJwtMiddleware } from '../auth/middlewares/ws-jwt.middleware';
import { CallService } from './call.service';
import { CallSessionMap } from './call-session.map';
import { CallClientEvents, CallServerEvents } from './call.events';
import { CallInitiateDto } from './dto/call-initiate.dto';
import { CallIdDto } from './dto/call-id.dto';
import { CallAnswerDto } from './dto/call-answer.dto';
import { CallIceCandidateDto } from './dto/call-ice-candidate.dto';
import type { AuthenticatedSocket } from '../../common/types/authenticated-socket';

const wsValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@WebSocketGateway({
  pingInterval: 5000,
  pingTimeout: 7000,
})
export class CallGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CallGateway.name);

  constructor(
    private readonly callService: CallService,
    private readonly callSessionMap: CallSessionMap,
    private readonly socketState: SocketStateService,
    private readonly appConfig: AppConfigService,
    private readonly wsJwtMiddleware: WsJwtMiddleware,
  ) {}

  afterInit(server: Server) {
    // Duplicate WS auth + CORS setup (same namespace as ChatGateway).
    server.use(this.wsJwtMiddleware.build());
    server.engine.opts.cors = {
      origin: this.appConfig.allowedOrigins,
      credentials: true,
    };
    this.logger.log('CallGateway initialised');
  }

  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.user?.id;
    if (!userId) return;

    // When a user refreshes their browser, the socket disconnects and
    // reconnects within ~1-2 seconds.  Without a grace period, the call
    // would be killed every time the callee hits F5.  We delay 3 seconds
    // and then re-check — if they're back online, we leave the call alone.
    if (!this.socketState.isUserOnline(userId)) {
      // Clear any existing timer (shouldn't happen, but be safe)
      const existing = this.disconnectTimers.get(userId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.disconnectTimers.delete(userId);
        // Re-check: if the user reconnected within the grace window, skip.
        if (this.socketState.isUserOnline(userId)) return;
        this.callService.onUserDisconnect(userId);
      }, 3000);

      this.disconnectTimers.set(userId, timer);
    }
  }

  // ─── 8 Client→Server handlers ─────────────────────────────────────────────

  @SubscribeMessage(CallClientEvents.INITIATE)
  @UsePipes(wsValidationPipe)
  async handleInitiate(
    @MessageBody() dto: CallInitiateDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const callerId = client.data.user.id;
    const result = await this.callService.initiate(
      callerId,
      dto.calleeId,
      dto.conversationId,
      dto.offer,
      dto.type,
    );
    return result;
  }

  @SubscribeMessage(CallClientEvents.ACCEPT)
  @UsePipes(wsValidationPipe)
  async handleAccept(
    @MessageBody() dto: CallIdDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const calleeId = client.data.user.id;
    const ok = await this.callService.accept(dto.callId, calleeId);
    return { ok };
  }

  @SubscribeMessage(CallClientEvents.ANSWER)
  @UsePipes(wsValidationPipe)
  async handleAnswer(
    @MessageBody() dto: CallAnswerDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const calleeId = client.data.user.id;
    const ok = await this.callService.answer(dto.callId, calleeId, dto.answer);
    return { ok };
  }

  @SubscribeMessage(CallClientEvents.ICE_CANDIDATE)
  @UsePipes(wsValidationPipe)
  async handleIceCandidate(
    @MessageBody() dto: CallIceCandidateDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const userId = client.data.user.id;
    await this.callService.relayIceCandidate(dto.callId, userId, dto.candidate);
    return { ok: true };
  }

  @SubscribeMessage(CallClientEvents.REJECT)
  @UsePipes(wsValidationPipe)
  async handleReject(
    @MessageBody() dto: CallIdDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const calleeId = client.data.user.id;
    await this.callService.reject(dto.callId, calleeId);
    return { ok: true };
  }

  @SubscribeMessage(CallClientEvents.CANCEL)
  @UsePipes(wsValidationPipe)
  async handleCancel(
    @MessageBody() dto: CallIdDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const callerId = client.data.user.id;
    await this.callService.cancel(dto.callId, callerId);
    return { ok: true };
  }

  @SubscribeMessage(CallClientEvents.END)
  @UsePipes(wsValidationPipe)
  async handleEnd(
    @MessageBody() dto: CallIdDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const userId = client.data.user.id;
    await this.callService.end(dto.callId, userId);
    return { ok: true };
  }

  @SubscribeMessage(CallClientEvents.ICE_FAILED)
  @UsePipes(wsValidationPipe)
  async handleIceFailed(
    @MessageBody() dto: CallIdDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const userId = client.data.user.id;
    await this.callService.iceFailed(dto.callId, userId);
    return { ok: true };
  }

  @SubscribeMessage(CallClientEvents.REOFFER)
  async handleReoffer(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: { callId: string; sdp: string },
  ): Promise<void> {
    const session = await this.callSessionMap.get(dto.callId);
    if (!session) return;
    const user = client.data.user;
    if (session.callerId !== user.id && session.calleeId !== user.id) return;
    const otherSocketId =
      session.callerId === user.id
        ? session.calleeSocketId
        : session.callerSocketId;
    if (otherSocketId) {
      this.server
        .to(otherSocketId)
        .emit(CallServerEvents.REOFFER, { callId: dto.callId, sdp: dto.sdp });
    }
  }

  @SubscribeMessage(CallClientEvents.REANSWER)
  async handleReanswer(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: { callId: string; sdp: string },
  ): Promise<void> {
    const session = await this.callSessionMap.get(dto.callId);
    if (!session) return;
    const user = client.data.user;
    if (session.callerId !== user.id && session.calleeId !== user.id) return;
    const otherSocketId =
      session.callerId === user.id
        ? session.calleeSocketId
        : session.callerSocketId;
    if (otherSocketId) {
      this.server
        .to(otherSocketId)
        .emit(CallServerEvents.REANSWER, { callId: dto.callId, sdp: dto.sdp });
    }
  }

  @SubscribeMessage(CallClientEvents.SCREEN_SHARE_STARTED)
  async handleScreenShareStarted(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: { callId: string },
  ): Promise<void> {
    const session = await this.callSessionMap.get(dto.callId);
    if (!session) return;

    const userId = client.data.user?.id;
    if (!userId) return;
    if (session.callerId !== userId && session.calleeId !== userId) return;

    const otherSocketId =
      session.callerId === userId
        ? session.calleeSocketId
        : session.callerSocketId;

    if (otherSocketId) {
      this.server
        .to(otherSocketId)
        .emit(CallServerEvents.SCREEN_SHARE_STARTED, { callId: dto.callId });
    }
  }

  @SubscribeMessage(CallClientEvents.SCREEN_SHARE_STOPPED)
  async handleScreenShareStopped(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: { callId: string },
  ): Promise<void> {
    const session = await this.callSessionMap.get(dto.callId);
    if (!session) return;

    const userId = client.data.user?.id;
    if (!userId) return;
    if (session.callerId !== userId && session.calleeId !== userId) return;

    const otherSocketId =
      session.callerId === userId
        ? session.calleeSocketId
        : session.callerSocketId;

    if (otherSocketId) {
      this.server
        .to(otherSocketId)
        .emit(CallServerEvents.SCREEN_SHARE_STOPPED, { callId: dto.callId });
    }
  }

  // ─── Reconnect handler (Phase 12) ─────────────────────────────────────────

  @SubscribeMessage(CallClientEvents.RECONNECT)
  async handleReconnect(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: { callId: string },
  ): Promise<void> {
    const session = await this.callSessionMap.get(dto.callId);
    if (!session) return; // session already ended, nothing to do

    const user = client.data.user;
    if (!user) return;

    // Re-associate socket ID
    if (session.callerId === user.id) {
      session.callerSocketId = client.id;
    } else if (session.calleeId === user.id) {
      session.calleeSocketId = client.id;
    } else {
      return; // not a participant
    }

    await this.callSessionMap.set(dto.callId, session);

    // Notify the other party that this user reconnected
    const otherSocketId =
      session.callerId === user.id
        ? session.calleeSocketId
        : session.callerSocketId;

    if (otherSocketId) {
      this.server
        .to(otherSocketId)
        .emit('call:peer-reconnected', { callId: dto.callId });
    }
  }
}
