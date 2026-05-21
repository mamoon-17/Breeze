import { useEffect, useRef } from "react";
import { useGroupCall } from "@/contexts/GroupCallContext";

type GroupCallParticipant = {
  userId: string;
  userName: string;
  stream: MediaStream | null;
};

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0]?.charAt(0).toUpperCase() ?? "?";
  }
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts[1]?.charAt(0) ?? "";
  return `${first}${second}`.toUpperCase() || "?";
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.36 2.18" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function HangupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
    </svg>
  );
}

function ParticipantTile({
  participant,
  isSolo,
}: {
  participant: GroupCallParticipant;
  isSolo: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (participant.stream) {
      if (audio.srcObject !== participant.stream) {
        audio.srcObject = participant.stream;
      }
      audio.play().catch(() => {});
    } else {
      audio.srcObject = null;
    }
  }, [participant.stream]);

  const displayName = participant.userName || "Unknown";
  const initials = getInitials(displayName);
  const avatarSize = isSolo ? 120 : 96;
  const fontSize = isSolo ? 40 : 32;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.06)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
      }}
    >
      <div
        style={{
          width: avatarSize,
          height: avatarSize,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize,
          fontWeight: 700,
          color: "white",
          fontFamily: "'Inter', -apple-system, sans-serif",
        }}
      >
        {initials}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "white",
          fontFamily: "'Inter', -apple-system, sans-serif",
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        <span>{displayName}</span>
        {participant.stream && (
          <span
            aria-label="Participant audio active"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#2ecc71",
              boxShadow: "0 0 8px rgba(46,204,113,0.8)",
              animation: "pulseDot 1.5s ease-in-out infinite",
            }}
          />
        )}
      </div>
      <audio ref={audioRef} autoPlay playsInline style={{ display: "none" }} />
    </div>
  );
}

export default function GroupCallOverlay() {
  const {
    groupCallState,
    participants,
    isMuted,
    toggleMute,
    leaveGroupCall,
  } = useGroupCall();

  if (groupCallState !== "active") return null;

  const count = participants.length;
  const isSolo = count === 1;
  const gridColumns = count <= 1 ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";
  const gridRows = count <= 2 ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";

  return (
    <div
      id="group-call-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "linear-gradient(135deg, #0f172a 0%, #111827 55%, #0b1220 100%)",
        display: "flex",
        flexDirection: "column",
        color: "white",
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}
    >
      <style>{`
        @keyframes pulseDot {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.4); opacity: 1; }
        }
        .group-call-btn {
          width: 64px; height: 64px; border-radius: 50%; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        .group-call-btn:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.4); }
        .group-call-btn:active { transform: scale(0.95); }
        .group-call-btn-sm {
          width: 52px; height: 52px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.1); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s ease; color: white;
        }
        .group-call-btn-sm:hover { background: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.4); }
      `}</style>

      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(15,23,42,0.6)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Group Call</span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
            {count} {count === 1 ? "participant" : "participants"}
          </span>
        </div>
        <button
          className="group-call-btn-sm"
          onClick={leaveGroupCall}
          aria-label="Leave group call"
          style={{ background: "rgba(255,71,87,0.25)", borderColor: "#ff4757" }}
        >
          <HangupIcon className="size-5 text-white" />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        {isSolo ? (
          <div style={{ width: "min(520px, 92vw)", height: "min(520px, 70vh)" }}>
            {participants[0] && (
              <ParticipantTile participant={participants[0]} isSolo />
            )}
          </div>
        ) : (
          <div
            style={{
              width: "min(1100px, 92vw)",
              height: "min(680px, 72vh)",
              display: "grid",
              gridTemplateColumns: gridColumns,
              gridTemplateRows: gridRows,
              gap: 24,
            }}
          >
            {participants.map((participant) => (
              <ParticipantTile
                key={participant.userId}
                participant={participant}
                isSolo={false}
              />
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          height: 96,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          paddingBottom: 16,
        }}
      >
        <button
          className="group-call-btn-sm"
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          style={isMuted ? { background: "rgba(255,71,87,0.3)", borderColor: "#ff4757" } : {}}
        >
          {isMuted ? <MicOffIcon className="size-5" /> : <MicIcon className="size-5" />}
        </button>
        <button
          className="group-call-btn"
          onClick={leaveGroupCall}
          aria-label="End call"
          style={{ background: "linear-gradient(135deg, #ff4757, #c0392b)" }}
        >
          <HangupIcon className="size-6 text-white" />
        </button>
      </div>
    </div>
  );
}
