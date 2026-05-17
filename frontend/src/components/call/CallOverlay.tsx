/**
 * CallOverlay — renders the incoming/outgoing/active/ended call UI
 * based on CallContext state. Mounted globally from __root.tsx via CallProvider.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useCall } from "@/lib/breeze/call-context";
import { useAuth } from "@/lib/breeze/auth-context";

// ─── Utility: format mm:ss ─────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Phone / Mic / Camera SVG Icons ────────────────────────────────────────
function PhoneIcon({ className }: { className?: string }) {
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
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

/** WhatsApp-style hangup icon — phone rotated 135° to face down-left. */
function HangupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
    </svg>
  );
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

function CameraIcon({ className }: { className?: string }) {
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
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function CameraOffIcon({ className }: { className?: string }) {
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
      <path d="M21 6.5a2 2 0 0 1 1 1.73v7.54a2 2 0 0 1-.42 1.22" />
      <path d="M16 10l7-5v8" />
      <path d="M3.27 5.27A2 2 0 0 1 5 5h11v11.73A2 2 0 0 1 14.73 18H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    </svg>
  );
}

function SwitchCameraIcon({ className }: { className?: string }) {
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
      <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2l2-2h8l2 2h2a2 2 0 0 1 2 2v4" />
      <path d="M14 16h5v-5" />
      <path d="M19 16l-6-6" />
      <path d="M19 21h-5v-5" />
      <path d="M14 21l6-6" />
    </svg>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function CallOverlay() {
  const {
    callState,
    peerId,
    peerName,
    callType,
    isMuted,
    isCameraOff,
    videoFallbackToAudio,
    localStream,
    remoteStream,
    answeredAt,
    overlayVisible,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    hideOverlay,
  } = useCall();
  const { user } = useAuth();

  // Duration timer for active calls
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [fallbackDismissed, setFallbackDismissed] = useState(false);
  const [pipPosition, setPipPosition] = useState(() => {
    if (typeof window === "undefined") return { x: 16, y: 80 };
    return {
      x: Math.max(16, window.innerWidth - 136),
      y: Math.max(16, window.innerHeight - 240),
    };
  });
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);

  const constrainPip = useCallback((x: number, y: number) => {
    if (typeof window === "undefined") return { x, y };
    return {
      x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - 120)),
      y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 160)),
    };
  }, []);

  const movePip = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragOffset) return;
      setPipPosition(constrainPip(clientX - dragOffset.x, clientY - dragOffset.y));
    },
    [constrainPip, dragOffset],
  );

  useEffect(() => {
    setIsTouchDevice(typeof window !== "undefined" && "ontouchstart" in window);
  }, []);

  useEffect(() => {
    if (videoFallbackToAudio) setFallbackDismissed(false);
  }, [videoFallbackToAudio]);

  useEffect(() => {
    const vid = remoteVideoRef.current;
    if (!vid || !remoteStream) return;
    if (vid.srcObject === remoteStream) return;
    vid.srcObject = remoteStream;
    vid.play().catch(() => {});
  }, [remoteStream]);

  useEffect(() => {
    const vid = localVideoRef.current;
    if (!vid || !localStream) return;
    if (vid.srcObject === localStream) return;
    vid.srcObject = localStream;
    vid.play().catch(() => {});
  }, [localStream]);

  useEffect(() => {
    if (!dragOffset) return;

    const onMouseMove = (evt: MouseEvent) => movePip(evt.clientX, evt.clientY);
    const onMouseUp = () => setDragOffset(null);
    const onTouchMove = (evt: TouchEvent) => {
      const touch = evt.touches[0];
      if (touch) movePip(touch.clientX, touch.clientY);
    };
    const onTouchEnd = () => setDragOffset(null);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [dragOffset, movePip]);

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

  // Ringtone: two-tone alternating sine wave for more pleasant sound
  const ringOscillatorRef = useRef<{ oscs: OscillatorNode[]; ctx: AudioContext } | null>(null);

  useEffect(() => {
    if (callState === "incoming") {
      // Vibrate on mobile
      try {
        if (navigator.vibrate) {
          navigator.vibrate([300, 200, 300, 200, 300]);
        }
      } catch {
        // ignore
      }

      try {
        const ctx = new AudioContext();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);

        const osc1 = ctx.createOscillator();
        osc1.type = "sine";
        osc1.frequency.value = 440;
        osc1.connect(gain);

        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = 523.25;
        osc2.connect(gain);

        osc1.start();
        osc2.start();

        let isHigh = false;
        const pulseInterval = setInterval(() => {
          isHigh = !isHigh;
          gain.gain.setTargetAtTime(isHigh ? 0.12 : 0, ctx.currentTime, 0.05);
          // Switch between two tones for a pleasant ring
          osc1.frequency.setTargetAtTime(isHigh ? 440 : 0.001, ctx.currentTime, 0.01);
          osc2.frequency.setTargetAtTime(isHigh ? 0.001 : 523.25, ctx.currentTime, 0.01);
        }, 600);

        ringOscillatorRef.current = { oscs: [osc1, osc2], ctx };

        return () => {
          clearInterval(pulseInterval);
          osc1.stop();
          osc2.stop();
          ctx.close();
          ringOscillatorRef.current = null;
          // Stop vibration
          try {
            navigator.vibrate?.(0);
          } catch {
            /* ignore */
          }
        };
      } catch {
        // Audio not available
      }
    } else if (ringOscillatorRef.current) {
      ringOscillatorRef.current.oscs.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* ignore */
        }
      });
      ringOscillatorRef.current.ctx.close();
      ringOscillatorRef.current = null;
      try {
        navigator.vibrate?.(0);
      } catch {
        /* ignore */
      }
    }
  }, [callState]);

  if (callState === "idle" || !overlayVisible) return null;

  const displayName = peerName ?? "Unknown";
  const localDisplayName = user?.displayName ?? user?.email ?? displayName;
  const isVideoActive = callState === "active" && callType === "video" && !videoFallbackToAudio;

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
        overflow: "hidden",
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

      {isVideoActive && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{
            position: "fixed",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: 0,
          }}
        />
      )}

      {videoFallbackToAudio && !fallbackDismissed && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 4,
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 999,
            background: "rgba(15,23,42,0.82)",
            color: "white",
            padding: "9px 12px 9px 16px",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
            fontFamily: "'Inter', -apple-system, sans-serif",
            fontSize: 13,
          }}
        >
          <span>Camera unavailable — audio only</span>
          <button
            type="button"
            onClick={() => setFallbackDismissed(true)}
            aria-label="Dismiss camera notice"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: "none",
              background: "rgba(255,255,255,0.14)",
              color: "white",
              cursor: "pointer",
              lineHeight: "22px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {isVideoActive && (
        <div
          onMouseDown={(evt) => {
            setDragOffset({ x: evt.clientX - pipPosition.x, y: evt.clientY - pipPosition.y });
          }}
          onMouseMove={(evt) => movePip(evt.clientX, evt.clientY)}
          onMouseUp={() => setDragOffset(null)}
          onTouchStart={(evt) => {
            const touch = evt.touches[0];
            if (touch)
              setDragOffset({ x: touch.clientX - pipPosition.x, y: touch.clientY - pipPosition.y });
          }}
          onTouchMove={(evt) => {
            const touch = evt.touches[0];
            if (touch) movePip(touch.clientX, touch.clientY);
          }}
          onTouchEnd={() => setDragOffset(null)}
          style={{
            position: "fixed",
            left: pipPosition.x,
            top: pipPosition.y,
            width: 120,
            height: 160,
            border: "2px solid rgba(255,255,255,0.6)",
            borderRadius: 8,
            overflow: "hidden",
            zIndex: 3,
            background: "rgba(15,23,42,0.92)",
            boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
            cursor: dragOffset ? "grabbing" : "grab",
            touchAction: "none",
          }}
        >
          {isCameraOff ? (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: 34,
                fontWeight: 700,
                fontFamily: "'Inter', -apple-system, sans-serif",
              }}
            >
              {localDisplayName[0]?.toUpperCase() ?? "?"}
              <div
                style={{
                  position: "absolute",
                  right: 8,
                  bottom: 8,
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CameraOffIcon className="size-4 text-white" />
              </div>
            </div>
          ) : (
            <video
              ref={localVideoRef}
              muted
              autoPlay
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
      )}

      <div
        style={{
          textAlign: "center",
          animation: "slideUp 0.4s ease-out",
          position: "relative",
          zIndex: 2,
        }}
      >
        {/* Avatar placeholder with pulse ring */}
        {!(callState === "active" && isVideoActive) && (
          <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 24px" }}>
            {(callState === "incoming" || callState === "outgoing") && (
              <div
                style={{
                  position: "absolute",
                  inset: -12,
                  borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  animation: "pulse 2s ease-in-out infinite",
                }}
              />
            )}
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 40,
                fontWeight: 700,
                color: "white",
                fontFamily: "'Inter', -apple-system, sans-serif",
              }}
            >
              {displayName[0]?.toUpperCase() ?? "?"}
            </div>
          </div>
        )}

        {/* Peer name */}
        <h2
          style={{
            color: "white",
            fontSize: 24,
            fontWeight: 600,
            marginBottom: 8,
            fontFamily: "'Inter', -apple-system, sans-serif",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            textShadow: isVideoActive ? "0 2px 12px rgba(0,0,0,0.5)" : undefined,
          }}
        >
          {displayName}
          {callState === "active" && isMuted && (
            <span
              aria-label="Microphone muted"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#ff4757",
              }}
            >
              <MicOffIcon className="size-3.5 text-white" />
            </span>
          )}
        </h2>

        {/* Status text */}
        <p
          style={{
            color: "rgba(255,255,255,0.6)",
            fontSize: 14,
            marginBottom: 40,
            fontFamily: "'Inter', -apple-system, sans-serif",
            textShadow: isVideoActive ? "0 2px 10px rgba(0,0,0,0.55)" : undefined,
          }}
        >
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
                <HangupIcon className="size-6 text-white" />
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
              <HangupIcon className="size-6 text-white" />
            </button>
          )}

          {callState === "active" && (
            <>
              {isVideoActive && (
                <button
                  className="call-btn-sm"
                  onClick={toggleCamera}
                  aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
                  style={
                    isCameraOff ? { background: "rgba(255,71,87,0.3)", borderColor: "#ff4757" } : {}
                  }
                >
                  {isCameraOff ? (
                    <CameraOffIcon className="size-5" />
                  ) : (
                    <CameraIcon className="size-5" />
                  )}
                </button>
              )}
              <button
                className="call-btn-sm"
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                style={isMuted ? { background: "rgba(255,71,87,0.3)", borderColor: "#ff4757" } : {}}
              >
                {isMuted ? <MicOffIcon className="size-5" /> : <MicIcon className="size-5" />}
              </button>
              <button
                className="call-btn"
                onClick={endCall}
                aria-label="End call"
                style={{ background: "linear-gradient(135deg, #ff4757, #c0392b)" }}
              >
                <HangupIcon className="size-6 text-white" />
              </button>
              {isVideoActive && isTouchDevice && (
                <button className="call-btn-sm" onClick={switchCamera} aria-label="Switch camera">
                  <SwitchCameraIcon className="size-5" />
                </button>
              )}
              <button
                className="call-btn-sm"
                onClick={hideOverlay}
                aria-label="Minimize"
                title="Continue browsing"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
