import { useEffect } from "react";
import { useGroupCall } from "@/contexts/GroupCallContext";

export default function IncomingGroupCallBanner() {
  const { groupCallState, incomingGroupCall, joinGroupCall, declineGroupCall } = useGroupCall();

  useEffect(() => {
    if (groupCallState !== "incoming" || !incomingGroupCall) return;
    const timer = setTimeout(() => {
      declineGroupCall();
    }, 30_000);
    return () => clearTimeout(timer);
  }, [groupCallState, incomingGroupCall, declineGroupCall]);

  if (groupCallState !== "incoming" || !incomingGroupCall) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 55,
        padding: "14px 18px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(15,23,42,0.88)",
        color: "white",
        boxShadow: "0 16px 32px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {incomingGroupCall.initiatorName} started a group call
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
          Join to connect with the group
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
        <button
          onClick={joinGroupCall}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg, #2ecc71, #27ae60)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Join
        </button>
        <button
          onClick={declineGroupCall}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.1)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
