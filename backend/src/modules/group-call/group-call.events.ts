// ─── Group Call WS Event Names ──────────────────────────────────────────────
// Single source of truth for WebSocket event names used by the group call system.
// Mirrored on the frontend in `frontend/src/lib/breeze/types.ts`.

/** Client → Server events (used with @SubscribeMessage). */
export const GroupCallClientEvents = {
  START: 'group-call:start',
  JOIN: 'group-call:join',
  LEAVE: 'group-call:leave',
  OFFER: 'group-call:offer',
  ANSWER: 'group-call:answer',
  ICE: 'group-call:ice',
} as const;

/** Server → Client events (emitted via SocketStateService.emitToUser). */
export const GroupCallServerEvents = {
  INITIATED: 'group-call:initiated',
  PARTICIPANT_JOINED: 'group-call:participant-joined',
  PARTICIPANT_LEFT: 'group-call:participant-left',
  ENDED: 'group-call:ended',
  ERROR: 'group-call:error',
} as const;
