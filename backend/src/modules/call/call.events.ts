// ─── Call WS Event Names ─────────────────────────────────────────────────────
// Single source of truth for WebSocket event names used by the call system.
// Mirrored on the frontend in `frontend/src/lib/breeze/types.ts`.

/** Client → Server events (used with @SubscribeMessage). */
export const CallClientEvents = {
  INITIATE: 'call:initiate',
  ACCEPT: 'call:accept',
  ANSWER: 'call:answer',
  ICE_CANDIDATE: 'call:ice-candidate',
  REJECT: 'call:reject',
  CANCEL: 'call:cancel',
  END: 'call:end',
  ICE_FAILED: 'call:ice-failed',
  RECONNECT: 'call:reconnect',
} as const;

/** Server → Client events (emitted via SocketStateService.emitToUser). */
export const CallServerEvents = {
  INCOMING: 'call:incoming',
  ANSWERED: 'call:answered',
  OFFER: 'call:offer',
  ICE_CANDIDATE: 'call:ice-candidate',
  BUSY: 'call:busy',
  MISSED: 'call:missed',
  ENDED: 'call:ended',
  ERROR: 'call:error',
  PEER_RECONNECTED: 'call:peer-reconnected',
} as const;

/** Call outcome values persisted in CallRecord. */
export type CallOutcome =
  | 'completed'
  | 'missed'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  | 'busy';

/** Call type enum — voice-only for now, video later. */
export type CallType = 'voice';

/** Error codes sent with `call:error`. */
export const CallErrorCodes = {
  CANNOT_CALL_SELF: 'CANNOT_CALL_SELF',
  NOT_DM: 'NOT_DM',
  NOT_MEMBER: 'NOT_MEMBER',
  NO_ACTIVE_SESSION: 'NO_ACTIVE_SESSION',
  INVALID_SESSION: 'INVALID_SESSION',
} as const;
