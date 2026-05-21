/**
 * CallContext — global call state machine mounted inside AuthProvider.
 *
 * State machine: idle → outgoing | incoming → active → ended → idle
 *
 * Subscribes to all call:* server events; exposes actions for
 * initiateCall, acceptCall, rejectCall, cancelCall, endCall.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Calls } from "./api";
import { CallManager, type CallType } from "./call-manager";
import {
  getSocket,
  emitCallInitiate,
  emitCallAccept,
  emitCallAnswer,
  emitCallReject,
  emitCallCancel,
  emitCallEnd,
  emitCallIceFailed,
} from "./socket";
import type {
  CallState,
  WsCallIncoming,
  WsCallAnswered,
  WsCallIceCandidate,
  WsCallEnded,
  WsCallBusy,
  WsCallError,
  IceServersResponse,
} from "./types";

interface CallContextValue {
  callState: CallState;
  callId: string | null;
  conversationId: string | null;
  peerId: string | null;
  /** Resolved display name of the peer (from backend on incoming, from members on outgoing). */
  peerName: string | null;
  callType: CallType;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isPeerScreenSharing: boolean;
  videoFallbackToAudio: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  answeredAt: Date | null;
  /** True when the active call overlay is visible (user can hide it to browse). */
  overlayVisible: boolean;
  /** True when the socket is reconnecting during an active call. */
  isReconnecting: boolean;
  initiateCall: (
    calleeId: string,
    conversationId: string,
    calleeName?: string,
    type?: CallType,
  ) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  cancelCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  switchCamera: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  showOverlay: () => void;
  hideOverlay: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}

// ICE server cache in sessionStorage
const ICE_CACHE_KEY = "breeze.iceServers";

function getCachedIce(): RTCIceServer[] | null {
  try {
    const raw = sessionStorage.getItem(ICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { servers: RTCIceServer[]; expiresAt: number };
    if (Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(ICE_CACHE_KEY);
      return null;
    }
    return parsed.servers;
  } catch {
    return null;
  }
}

function setCachedIce(data: IceServersResponse): void {
  try {
    sessionStorage.setItem(
      ICE_CACHE_KEY,
      JSON.stringify({
        servers: data.iceServers,
        expiresAt: Date.now() + data.ttlSeconds * 1000,
      }),
    );
  } catch {
    // ignore
  }
}

async function getIceServers(): Promise<RTCIceServer[]> {
  const cached = getCachedIce();
  if (cached) return cached;
  try {
    const data = await Calls.iceServers();
    setCachedIce(data);
    return data.iceServers;
  } catch {
    // Fallback to public STUN
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

function inferCallTypeFromOffer(offerSdp: string): CallType {
  try {
    const offer = JSON.parse(offerSdp) as RTCSessionDescriptionInit;
    return offer.sdp?.includes("m=video") ? "video" : "audio";
  } catch {
    return "audio";
  }
}

export function CallProvider({ children }: { children: ReactNode }) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [callType, setCallType] = useState<CallType>("audio");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isPeerScreenSharing, setIsPeerScreenSharing] = useState(false);
  const [videoFallbackToAudio, setVideoFallbackToAudio] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [answeredAt, setAnsweredAt] = useState<Date | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Refs for the incoming offer SDP (needed when callee accepts)
  const incomingOfferRef = useRef<string | null>(null);
  const isPeerScreenSharingRef = useRef(false);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callManagerRef = useRef(CallManager.getInstance());

  // Set up remote audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.autoplay = true;
    remoteAudioRef.current = audio;
    return () => {
      audio.pause();
      audio.srcObject = null;
    };
  }, []);

  // Setup CallManager callbacks
  useEffect(() => {
    callManagerRef.current.setCallbacks({
      onStateChange: () => {
        // CallManager state is separate from call flow state
      },
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
        }
      },
    });
  }, []);

  const reset = useCallback(() => {
    callManagerRef.current.cleanup();
    setCallState("idle");
    setCallId(null);
    setConversationId(null);
    setPeerId(null);
    setPeerName(null);
    setCallType("audio");
    setIsMuted(false);
    setIsCameraOff(false);
    setIsScreenSharing(false);
    setIsPeerScreenSharing(false);
    isPeerScreenSharingRef.current = false;
    setVideoFallbackToAudio(false);
    setLocalStream(null);
    setRemoteStream(null);
    setAnsweredAt(null);
    setOverlayVisible(false);
    setIsReconnecting(false);
    incomingOfferRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  // ─── Socket event subscriptions ──────────────────────────────────────

  useEffect(() => {
    const socket = getSocket();

    const onIncoming = (evt: WsCallIncoming) => {
      // If already in a call, ignore (server handles busy)
      if (callState !== "idle") return;
      setCallId(evt.callId);
      setConversationId(evt.conversationId);
      setPeerId(evt.callerId);
      setPeerName((evt as WsCallIncoming & { callerName?: string }).callerName ?? null);
      setCallType(evt.type ?? inferCallTypeFromOffer(evt.offer));
      setIsCameraOff(false);
      setVideoFallbackToAudio(false);
      setCallState("incoming");
      setOverlayVisible(true);
      incomingOfferRef.current = evt.offer;
    };

    const onAnswered = async (evt: WsCallAnswered) => {
      try {
        await callManagerRef.current.setRemoteAnswer(evt.answer);
        setCallState("active");
        setAnsweredAt(new Date());
      } catch (err) {
        console.error("[CallContext] Failed to set remote answer:", err);
        toast.error("Call connection failed");
        reset();
      }
    };

    const onIceCandidate = (evt: WsCallIceCandidate) => {
      callManagerRef.current.addIceCandidate(evt.candidate);
    };

    const onEnded = (evt: WsCallEnded) => {
      if (evt.callId !== callId && callId !== null) return;
      // Show brief "ended" state before resetting
      setCallState("ended");
      setIsReconnecting(false);
      setIsScreenSharing(false);
      setIsPeerScreenSharing(false);
      isPeerScreenSharingRef.current = false;
      setTimeout(() => reset(), 1500);
    };

    const onBusy = (_evt: WsCallBusy) => {
      toast.info("User is busy on another call");
      reset();
    };

    const onError = (evt: WsCallError) => {
      const messages: Record<string, string> = {
        CANNOT_CALL_SELF: "You can't call yourself",
        NOT_DM: "Voice calls are only available in DMs",
        NOT_MEMBER: "You're not a member of this conversation",
        ALREADY_IN_CALL: "You're already in a call",
      };
      toast.error(messages[evt.code] ?? evt.message ?? "Call error");
      reset();
    };

    // ─── Reconnect logic (Phase 12) ──────────────────────────────────
    const onConnect = () => {
      const mgr = callManagerRef.current;
      const activeId = mgr.activeCallId;
      if (activeId) {
        socket.emit("call:reconnect", { callId: activeId });
        setIsReconnecting(true);
      }
    };

    const onPeerReconnected = () => {
      setIsReconnecting(false);
    };

    const onPeerScreenShareStarted = () => {
      setIsPeerScreenSharing(true);
      isPeerScreenSharingRef.current = true;
    };

    const onPeerScreenShareStopped = () => {
      setIsPeerScreenSharing(false);
      isPeerScreenSharingRef.current = false;
    };

    const onIceFailed = () => {
      callManagerRef.current.cleanup();
      setCallState("ended");
      setIsReconnecting(false);
      setIsScreenSharing(false);
      setIsPeerScreenSharing(false);
      isPeerScreenSharingRef.current = false;
      setTimeout(() => reset(), 1500);
    };

    const onReoffer = async (evt: { callId: string; sdp: string }) => {
      if (evt.callId !== callId) return;
      const mgr = callManagerRef.current;
      if (!mgr) return;
      const sdp = JSON.parse(evt.sdp) as RTCSessionDescriptionInit;
      await mgr.pc?.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await mgr.pc?.createAnswer();
      if (!answer || !mgr.pc) return;
      await mgr.pc.setLocalDescription(answer);
      getSocket().emit("call:reanswer", {
        callId: evt.callId,
        sdp: JSON.stringify(mgr.pc.localDescription),
      });
      setIsPeerScreenSharing(true);
      isPeerScreenSharingRef.current = true;
    };

    const onReanswer = async (evt: { callId: string; sdp: string }) => {
      if (evt.callId !== callId) return;
      const mgr = callManagerRef.current;
      if (!mgr) return;
      const sdp = JSON.parse(evt.sdp) as RTCSessionDescriptionInit;
      await mgr.pc?.setRemoteDescription(new RTCSessionDescription(sdp));
    };

    socket.on("connect", onConnect);
    socket.on("call:peer-reconnected", onPeerReconnected);
    socket.on("call:screen-share-started", onPeerScreenShareStarted);
    socket.on("call:screen-share-stopped", onPeerScreenShareStopped);
    socket.on("call:incoming", onIncoming);
    socket.on("call:answered", onAnswered);
    socket.on("call:ice-candidate", onIceCandidate);
    socket.on("call:ice-failed", onIceFailed);
    socket.on("call:reoffer", onReoffer);
    socket.on("call:reanswer", onReanswer);
    socket.on("call:ended", onEnded);
    socket.on("call:busy", onBusy);
    socket.on("call:missed", () => {
      if (callState === "outgoing") {
        toast.info("No answer");
        reset();
      }
    });
    socket.on("call:error", onError);

    callManagerRef.current.onScreenShareStopped = () => {
      setIsScreenSharing(false);
      const activeCallId = callManagerRef.current.activeCallId ?? callId;
      if (activeCallId) {
        socket.emit("call:screen-share-stopped", { callId: activeCallId });
      }
    };

    callManagerRef.current.onIceFailed = () => {
      const activeCallId = callManagerRef.current.activeCallId;
      if (activeCallId) emitCallIceFailed(activeCallId);
    };

    callManagerRef.current.onNegotiationNeeded = (offerSdp: string) => {
      const activeId = callManagerRef.current.activeCallId ?? callId;
      if (!activeId) return;
      getSocket().emit("call:reoffer", { callId: activeId, sdp: offerSdp });
    };

    return () => {
      socket.off("connect", onConnect);
      socket.off("call:peer-reconnected", onPeerReconnected);
      socket.off("call:screen-share-started", onPeerScreenShareStarted);
      socket.off("call:screen-share-stopped", onPeerScreenShareStopped);
      socket.off("call:incoming", onIncoming);
      socket.off("call:answered", onAnswered);
      socket.off("call:ice-candidate", onIceCandidate);
      socket.off("call:ice-failed", onIceFailed);
      socket.off("call:reoffer", onReoffer);
      socket.off("call:reanswer", onReanswer);
      socket.off("call:ended", onEnded);
      socket.off("call:busy", onBusy);
      socket.off("call:missed");
      socket.off("call:error", onError);
      callManagerRef.current.onScreenShareStopped = null;
      callManagerRef.current.onIceFailed = null;
      callManagerRef.current.onNegotiationNeeded = null;
    };
    // We intentionally re-subscribe when callState/callId change so our closures
    // see current values.
  }, [callState, callId, reset]);

  // ─── Actions ──────────────────────────────────────────────────────────

  const initiateCall = useCallback(
    async (calleeId: string, convId: string, calleeName?: string, type: CallType = "audio") => {
      if (callState !== "idle") {
        toast.error("You're already in a call");
        return;
      }

      try {
        const iceServers = await getIceServers();
        const mgr = callManagerRef.current;

        // We need a temporary callId for the manager — server will confirm it
        const tempCallId = crypto.randomUUID();
        const offerSdp = await mgr.createOffer(tempCallId, iceServers, type);
        const fallback = mgr.videoFallbackToAudio;

        setCallState("outgoing");
        setConversationId(convId);
        setPeerId(calleeId);
        setPeerName(calleeName ?? null);
        setCallType(type);
        setIsCameraOff(false);
        setVideoFallbackToAudio(fallback);
        setLocalStream(mgr.getLocalStream());
        setOverlayVisible(true);

        const result = await emitCallInitiate(convId, calleeId, offerSdp, type);
        if (result.error || !result.callId) {
          // Server rejected — cleanup
          mgr.cleanup();
          reset();
          return;
        }

        setCallId(result.callId);
      } catch (err) {
        console.error("[CallContext] Failed to initiate call:", err);
        toast.error("Could not start call");
        reset();
      }
    },
    [callState, reset],
  );

  const acceptCall = useCallback(async () => {
    if (callState !== "incoming" || !callId) return;

    try {
      const iceServers = await getIceServers();
      const mgr = callManagerRef.current;

      emitCallAccept(callId);

      const answerSdp = await mgr.createAnswer(
        callId,
        incomingOfferRef.current!,
        iceServers,
        callType,
      );
      emitCallAnswer(callId, answerSdp);

      setLocalStream(mgr.getLocalStream());
      setVideoFallbackToAudio(mgr.videoFallbackToAudio);
      setIsCameraOff(false);
      setCallState("active");
      setAnsweredAt(new Date());
    } catch (err) {
      console.error("[CallContext] Failed to accept call:", err);
      toast.error("Could not accept call");
      reset();
    }
  }, [callState, callId, callType, reset]);

  const rejectCall = useCallback(() => {
    if (callId) emitCallReject(callId);
    reset();
  }, [callId, reset]);

  const cancelCall = useCallback(() => {
    if (callId) emitCallCancel(callId);
    reset();
  }, [callId, reset]);

  const endCall = useCallback(() => {
    if (callId) emitCallEnd(callId);
    setCallState("ended");
    setTimeout(() => reset(), 1500);
  }, [callId, reset]);

  const toggleMute = useCallback(() => {
    const muted = callManagerRef.current.toggleMute();
    setIsMuted(muted);
  }, []);

  const toggleCamera = useCallback(() => {
    const nowOff = callManagerRef.current.toggleCamera();
    setIsCameraOff(nowOff);
  }, []);

  const switchCamera = useCallback(() => {
    void callManagerRef.current
      .switchCamera()
      .then(() => setLocalStream(callManagerRef.current.getLocalStream()))
      .catch((err) => console.warn("[CallContext] Failed to switch camera:", err));
  }, []);

  const startScreenShare = useCallback(async () => {
    if (isPeerScreenSharingRef.current) {
      toast.error("Can't share screen while the other person is sharing");
      return;
    }
    try {
      await callManagerRef.current.startScreenShare();
      setIsScreenSharing(true);
      const activeCallId = callManagerRef.current.activeCallId ?? callId;
      if (activeCallId) {
        getSocket().emit("call:screen-share-started", { callId: activeCallId });
      }
    } catch (err) {
      console.error("Screen share failed:", err);
      toast.error("Could not start screen share");
    }
  }, [callId]);

  const stopScreenShare = useCallback(async () => {
    await callManagerRef.current.stopScreenShare();
    setIsScreenSharing(false);
    const activeCallId = callManagerRef.current.activeCallId ?? callId;
    if (activeCallId) {
      getSocket().emit("call:screen-share-stopped", { callId: activeCallId });
    }
  }, [callId]);

  const showOverlay = useCallback(() => setOverlayVisible(true), []);
  const hideOverlay = useCallback(() => setOverlayVisible(false), []);

  return (
    <CallContext.Provider
      value={{
        callState,
        callId,
        conversationId,
        peerId,
        peerName,
        callType,
        isMuted,
        isCameraOff,
        isScreenSharing,
        isPeerScreenSharing,
        videoFallbackToAudio,
        localStream,
        remoteStream,
        answeredAt,
        overlayVisible,
        isReconnecting,
        initiateCall,
        acceptCall,
        rejectCall,
        cancelCall,
        endCall,
        toggleMute,
        toggleCamera,
        switchCamera,
        startScreenShare,
        stopScreenShare,
        showOverlay,
        hideOverlay,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}
