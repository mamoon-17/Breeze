/**
 * CallOverlay — renders the incoming/outgoing/active/ended call UI
 * based on CallContext state. Mounted globally from __root.tsx via CallProvider.
 */

import { useEffect, useState, useRef } from "react";
import { useCall } from "@/lib/breeze/call-context";
import { useAuth } from "@/lib/breeze/auth-context";

// ─── Utility: format mm:ss ─────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Phone / Mic SVG Icons ─────────────────────────────────────────────────
function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function PhoneOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-4.35-3.71" />
      <path d="M14.05 2a12.84 12.84 0 0 0-1.81.18A2 2 0 0 0 10.72 4.1l.2.74a2 2 0 0 1-.45 2.11L9.2 8.22" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.36 2.18" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function CallOverlay() {
  const {
    callState,
    peerId,
    isMuted,
    answeredAt,
    overlayVisible,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    toggleMute,
  } = useCall();
  const { user } = useAuth();

  // Duration timer for active calls
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (callState === "active" && answeredAt) {
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - answeredAt.getTime()) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (callState === "idle") setDuration(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState, answeredAt]);

  // Simple ringtone using Web Audio API (plays during incoming state)
  const ringOscillatorRef = useRef<{ osc: OscillatorNode; ctx: AudioContext } | null>(null);

  useEffect(() => {
    if (callState === "incoming") {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 440;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        // Pulse on/off
        const pulseInterval = setInterval(() => {
          gain.gain.value = gain.gain.value > 0 ? 0 : 0.15;
        }, 800);

        ringOscillatorRef.current = { osc, ctx };

        return () => {
          clearInterval(pulseInterval);
          osc.stop();
          ctx.close();
          ringOscillatorRef.current = null;
        };
      } catch {
        // Audio not available
      }
    } else if (ringOscillatorRef.current) {
      ringOscillatorRef.current.osc.stop();
      ringOscillatorRef.current.ctx.close();
      ringOscillatorRef.current = null;
    }
  }, [callState]);

  if (callState === "idle" || !overlayVisible) return null;

  const peerDisplay = peerId === user?.id ? "You" : peerId?.slice(0, 8) ?? "Unknown";

  return (
    <div
      id="call-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        backdropFilter: "blur(20px)",
        animation: "fadeIn 0.3s ease-out",
      }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.3); opacity: 0; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .call-btn { 
          width: 64px; height: 64px; border-radius: 50%; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        .call-btn:hover { transform: scale(1.1); box-shadow: 0 6px 24px rgba(0,0,0,0.4); }
        .call-btn:active { transform: scale(0.95); }
        .call-btn-sm {
          width: 52px; height: 52px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.1); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s ease; color: white;
        }
        .call-btn-sm:hover { background: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.4); }
      `}</style>

      <div style={{ textAlign: "center", animation: "slideUp 0.4s ease-out" }}>
        {/* Avatar placeholder with pulse ring */}
        <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 24px" }}>
          {(callState === "incoming" || callState === "outgoing") && (
            <div style={{
              position: "absolute", inset: -12,
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.3)",
              animation: "pulse 2s ease-in-out infinite",
            }} />
          )}
          <div style={{
            width: 120, height: 120, borderRadius: "50%",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 40, fontWeight: 700, color: "white",
            fontFamily: "'Inter', -apple-system, sans-serif",
          }}>
            {peerDisplay[0]?.toUpperCase() ?? "?"}
          </div>
        </div>

        {/* Peer name */}
        <h2 style={{
          color: "white", fontSize: 24, fontWeight: 600, marginBottom: 8,
          fontFamily: "'Inter', -apple-system, sans-serif",
        }}>
          {peerDisplay}
        </h2>

        {/* Status text */}
        <p style={{
          color: "rgba(255,255,255,0.6)", fontSize: 14, marginBottom: 40,
          fontFamily: "'Inter', -apple-system, sans-serif",
        }}>
          {callState === "incoming" && "Incoming voice call…"}
          {callState === "outgoing" && "Calling…"}
          {callState === "active" && formatDuration(duration)}
          {callState === "ended" && "Call ended"}
        </p>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 24, justifyContent: "center", alignItems: "center" }}>
          {callState === "incoming" && (
            <>
              <button
                className="call-btn"
                onClick={rejectCall}
                aria-label="Decline call"
                style={{ background: "linear-gradient(135deg, #ff4757, #c0392b)" }}
              >
                <PhoneOffIcon className="size-6 text-white" />
              </button>
              <button
                className="call-btn"
                onClick={acceptCall}
                aria-label="Accept call"
                style={{ background: "linear-gradient(135deg, #2ecc71, #27ae60)" }}
              >
                <PhoneIcon className="size-6 text-white" />
              </button>
            </>
          )}

          {callState === "outgoing" && (
            <button
              className="call-btn"
              onClick={cancelCall}
              aria-label="Cancel call"
              style={{ background: "linear-gradient(135deg, #ff4757, #c0392b)" }}
            >
              <PhoneOffIcon className="size-6 text-white" />
            </button>
          )}

          {callState === "active" && (
            <>
              <button
                className="call-btn-sm"
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                style={isMuted ? { background: "rgba(255,71,87,0.3)", borderColor: "#ff4757" } : {}}
              >
                {isMuted
                  ? <MicOffIcon className="size-5" />
                  : <MicIcon className="size-5" />
                }
              </button>
              <button
                className="call-btn"
                onClick={endCall}
                aria-label="End call"
                style={{ background: "linear-gradient(135deg, #ff4757, #c0392b)" }}
              >
                <PhoneOffIcon className="size-6 text-white" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
