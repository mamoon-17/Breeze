/**
 * CallFloater — compact floating banner when the user navigates away from
 * the call overlay during an active call. Clicking brings back the full overlay.
 */

import { useCall } from "@/lib/breeze/call-context";
import { useEffect, useState } from "react";

export function CallFloater() {
  const { callState, peerId, peerName, answeredAt, overlayVisible, showOverlay } = useCall();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (callState !== "active" || !answeredAt) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - answeredAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [callState, answeredAt]);

  // Only show floater when in a call AND the overlay is hidden
  if (callState === "idle" || callState === "ended") return null;
  if (overlayVisible) return null;

  const displayName = peerName ?? peerId?.slice(0, 8) ?? "Call";
  const isActive = callState === "active";
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const timeStr = `${m}:${s.toString().padStart(2, "0")}`;

  return (
    <button
      id="call-floater"
      onClick={showOverlay}
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9998,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        borderRadius: 9999,
        border: "none",
        cursor: "pointer",
        background: isActive
          ? "linear-gradient(135deg, #2ecc71, #27ae60)"
          : "linear-gradient(135deg, #667eea, #764ba2)",
        color: "white",
        fontFamily: "'Inter', -apple-system, sans-serif",
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        animation: "floaterSlide 0.3s ease-out",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "scale(1.05)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "scale(1)";
      }}
    >
      <style>{`
        @keyframes floaterSlide {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes floaterPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Pulsing green dot for active calls */}
      {isActive && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "white",
            animation: "floaterPulse 1.5s ease-in-out infinite",
          }}
        />
      )}

      {/* Phone icon */}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>

      <span>{displayName}</span>

      {isActive && (
        <span style={{ opacity: 0.85, fontSize: 12, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
          {timeStr}
        </span>
      )}

      {!isActive && (
        <span style={{ opacity: 0.85, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {callState === "outgoing" ? "Calling…" : "Incoming…"}
        </span>
      )}
    </button>
  );
}
