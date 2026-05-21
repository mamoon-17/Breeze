import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { AppConfigService } from '../../config/app-config.service';
import { WsJwtMiddleware } from '../auth/middlewares/ws-jwt.middleware';
import { ConversationService } from '../conversation/conversation.service';
import { SocketStateService } from '../socket/socket-state.service';
import {
  GroupCallClientEvents,
  GroupCallServerEvents,
} from './group-call.events';
import { GroupCallParticipant, GroupCallSession } from './group-call-session';
import { GroupCallSessionMap } from './group-call-session.map';
import type { AuthenticatedSocket } from '../../common/types/authenticated-socket';

@WebSocketGateway({
  pingInterval: 5000,
  pingTimeout: 7000,
})
export class GroupCallGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GroupCallGateway.name);
  private readonly disconnectTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly groupCallSessionMap: GroupCallSessionMap,
    private readonly socketState: SocketStateService,
    private readonly conversationService: ConversationService,
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
    this.logger.log('GroupCallGateway initialised');
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.user?.id;
    if (!userId) return;

    if (!this.socketState.isUserOnline(userId)) {
      const existing = this.disconnectTimers.get(userId);
      if (existing) clearTimeout(existing);

      const socketId = client.id;
      const timer = setTimeout(() => {
        this.disconnectTimers.delete(userId);
        if (this.socketState.isUserOnline(userId)) return;

        const session = this.groupCallSessionMap.getByUserId(userId);
        if (!session) return;

        const participant = session.participants.find(
          (entry) => entry.userId === userId,
        );
        if (!participant || participant.socketId !== socketId) return;

        void this.removeParticipant(session.callId, userId);
      }, 3000);

      this.disconnectTimers.set(userId, timer);
    }
  }

  @SubscribeMessage(GroupCallClientEvents.START)
  async handleStart(
    @MessageBody() dto: { conversationId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    const user = client.data.user;

    const conversation = await this.conversationService
      .findOneOrFail(dto.conversationId)
      .catch(() => null);
    if (!conversation || conversation.type !== 'group') {
      this.emitError(client, 'NOT_GROUP');
      return;
    }

    const isMember = await this.conversationService.isMember(
      user.id,
      dto.conversationId,
    );
    if (!isMember) {
      this.emitError(client, 'NOT_MEMBER');
      return;
    }

    const existingSession = this.groupCallSessionMap.getByConversationId(
      dto.conversationId,
    );
    if (existingSession) {
      await this.handleJoin({ callId: existingSession.callId }, client);
      return;
    }

    const existingUserSession = this.groupCallSessionMap.getByUserId(user.id);
    if (existingUserSession) {
      this.emitError(client, 'ALREADY_IN_CALL');
      return;
    }

    const participant: GroupCallParticipant = {
      userId: user.id,
      socketId: client.id,
      userName: user.displayName,
      joinedAt: new Date(),
    };

    const callId = randomUUID();
    const session: GroupCallSession = {
      callId,
      conversationId: dto.conversationId,
      initiatorId: user.id,
      participants: [participant],
      state: 'waiting',
      createdAt: new Date(),
    };

    this.groupCallSessionMap.set(callId, session);

    await this.emitToConversationMembers(dto.conversationId, {
      callId,
      conversationId: dto.conversationId,
      initiatorId: user.id,
      initiatorName: user.displayName,
      participants: [
        {
          userId: user.id,
          userName: user.displayName,
        },
      ],
    });
  }

  @SubscribeMessage(GroupCallClientEvents.JOIN)
  async handleJoin(
    @MessageBody() dto: { callId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    const session = this.groupCallSessionMap.get(dto.callId);
    if (!session || session.state === 'ended') return;

    const user = client.data.user;
    const isMember = await this.conversationService.isMember(
      user.id,
      session.conversationId,
    );
    if (!isMember) {
      this.emitError(client, 'NOT_MEMBER');
      return;
    }

    const alreadyInSession = session.participants.some(
      (participant) => participant.userId === user.id,
    );
    if (alreadyInSession) return;

    if (session.participants.length >= 4) {
      this.emitError(client, 'CALL_FULL');
      return;
    }

    const existingParticipants = [...session.participants];
    const joiner: GroupCallParticipant = {
      userId: user.id,
      socketId: client.id,
      userName: user.displayName,
      joinedAt: new Date(),
    };

    session.participants = [...session.participants, joiner];
    session.state = session.participants.length > 1 ? 'active' : 'waiting';
    this.groupCallSessionMap.set(session.callId, session);

    for (const participant of existingParticipants) {
      if (!participant.socketId) continue;
      this.socketState.emitToSocket(
        participant.socketId,
        GroupCallServerEvents.PARTICIPANT_JOINED,
        {
          callId: session.callId,
          userId: user.id,
          socketId: client.id,
          userName: user.displayName,
        },
      );
    }

    this.socketState.emitToSocket(client.id, GroupCallServerEvents.INITIATED, {
      callId: session.callId,
      conversationId: session.conversationId,
      participants: session.participants.map((participant) => ({
        userId: participant.userId,
        socketId: participant.socketId,
        userName: participant.userName,
      })),
    });
  }

  @SubscribeMessage(GroupCallClientEvents.LEAVE)
  async handleLeave(
    @MessageBody() dto: { callId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    await this.removeParticipant(dto.callId, client.data.user.id);
  }

  @SubscribeMessage(GroupCallClientEvents.OFFER)
  handleOffer(
    @MessageBody()
    dto: { callId: string; targetUserId: string; sdp: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): void {
    this.forwardToParticipant(
      client,
      dto.callId,
      dto.targetUserId,
      GroupCallClientEvents.OFFER,
      {
        sdp: dto.sdp,
      },
    );
  }

  @SubscribeMessage(GroupCallClientEvents.ANSWER)
  handleAnswer(
    @MessageBody()
    dto: { callId: string; targetUserId: string; sdp: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): void {
    this.forwardToParticipant(
      client,
      dto.callId,
      dto.targetUserId,
      GroupCallClientEvents.ANSWER,
      {
        sdp: dto.sdp,
      },
    );
  }

  @SubscribeMessage(GroupCallClientEvents.ICE)
  handleIce(
    @MessageBody()
    dto: { callId: string; targetUserId: string; candidate: unknown },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): void {
    this.forwardToParticipant(
      client,
      dto.callId,
      dto.targetUserId,
      GroupCallClientEvents.ICE,
      {
        candidate: dto.candidate,
      },
    );
  }

  private emitError(client: AuthenticatedSocket, code: string): void {
    this.socketState.emitToSocket(client.id, GroupCallServerEvents.ERROR, {
      code,
    });
  }

  private forwardToParticipant(
    client: AuthenticatedSocket,
    callId: string,
    targetUserId: string,
    event: string,
    data: { sdp?: string; candidate?: unknown },
  ): void {
    const session = this.groupCallSessionMap.get(callId);
    if (!session) return;

    const userId = client.data.user.id;
    const isParticipant = session.participants.some(
      (participant) => participant.userId === userId,
    );
    if (!isParticipant) return;

    const target = session.participants.find(
      (participant) => participant.userId === targetUserId,
    );
    if (!target?.socketId) return;

    this.socketState.emitToSocket(target.socketId, event, {
      callId,
      fromUserId: userId,
      ...data,
    });
  }

  private async removeParticipant(
    callId: string,
    userId: string,
  ): Promise<void> {
    const session = this.groupCallSessionMap.get(callId);
    if (!session) return;

    const index = session.participants.findIndex(
      (participant) => participant.userId === userId,
    );
    if (index === -1) return;

    session.participants.splice(index, 1);

    if (session.participants.length === 0) {
      this.groupCallSessionMap.delete(callId);
      await this.emitToConversationMembers(
        session.conversationId,
        { callId },
        true,
      );
      return;
    }

    session.state = session.participants.length > 1 ? 'active' : 'waiting';
    this.groupCallSessionMap.set(callId, session);

    for (const participant of session.participants) {
      if (!participant.socketId) continue;
      this.socketState.emitToSocket(
        participant.socketId,
        GroupCallServerEvents.PARTICIPANT_LEFT,
        { callId, userId },
      );
    }
  }

  private async emitToConversationMembers(
    conversationId: string,
    payload: {
      callId: string;
      conversationId?: string;
      initiatorId?: string;
      initiatorName?: string;
      participants?: Array<{ userId: string; userName?: string }>;
    },
    ended = false,
  ): Promise<void> {
    const memberIds =
      await this.conversationService.getMemberUserIds(conversationId);
    const event = ended
      ? GroupCallServerEvents.ENDED
      : GroupCallServerEvents.INITIATED;

    for (const memberId of memberIds) {
      this.socketState.emitToUser(memberId, event, payload);
    }
  }
}
