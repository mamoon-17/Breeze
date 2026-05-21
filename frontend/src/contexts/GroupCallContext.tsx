import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSocket } from "../lib/breeze/socket";
import { groupCallManager } from "../lib/breeze/group-call-manager";

type GroupCallState = "idle" | "incoming" | "joining" | "active";

type GroupCallParticipant = {
  userId: string;
  userName: string;
  stream: MediaStream | null;
};

type IncomingGroupCall = {
  callId: string;
  conversationId: string;
  initiatorName: string;
};

type GroupCallInitiatedEvent = {
  callId: string;
  conversationId: string;
  initiatorName: string;
  participants: Array<{ userId: string; userName: string; socketId?: string }>;
};

type GroupCallParticipantJoinedEvent = {
  callId: string;
  userId: string;
  socketId: string;
  userName: string;
};

type GroupCallParticipantLeftEvent = {
  callId: string;
  userId: string;
};

type GroupCallOfferEvent = {
  callId: string;
  fromUserId: string;
  sdp: string;
};

type GroupCallIceEvent = {
  callId: string;
  fromUserId: string;
  candidate: RTCIceCandidateInit;
};

type GroupCallErrorEvent = {
  code: string;
};

interface GroupCallContextValue {
  groupCallState: GroupCallState;
  callId: string | null;
  conversationId: string | null;
  participants: GroupCallParticipant[];
  incomingGroupCall: IncomingGroupCall | null;
  localStream: MediaStream | null;
  isMuted: boolean;
  startGroupCall: (conversationId: string) => void;
  joinGroupCall: () => void;
  declineGroupCall: () => void;
  leaveGroupCall: () => void;
  toggleMute: () => void;
}

const GroupCallContext = createContext<GroupCallContextValue | null>(null);

export function useGroupCall(): GroupCallContextValue {
  const ctx = useContext(GroupCallContext);
  if (!ctx) {
    throw new Error("useGroupCall must be used within GroupCallProvider");
  }
  return ctx;
}

export function GroupCallProvider({ children }: { children: ReactNode }) {
  const [groupCallState, setGroupCallState] = useState<GroupCallState>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<GroupCallParticipant[]>([]);
  const [incomingGroupCall, setIncomingGroupCall] = useState<IncomingGroupCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const pendingStartRef = useRef(false);

  const startGroupCall = useCallback((targetConversationId: string) => {
    const socket = getSocket();
    pendingStartRef.current = true;
    socket.emit("group-call:start", { conversationId: targetConversationId });
    setGroupCallState("joining");
  }, []);

  const joinGroupCall = useCallback(() => {
    if (!incomingGroupCall) return;
    const socket = getSocket();
    groupCallManager.callId = incomingGroupCall.callId;
    socket.emit("group-call:join", { callId: incomingGroupCall.callId });
    setGroupCallState("joining");
    setIncomingGroupCall(null);
  }, [incomingGroupCall]);

  const declineGroupCall = useCallback(() => {
    setIncomingGroupCall(null);
    setGroupCallState("idle");
  }, []);

  const leaveGroupCall = useCallback(() => {
    if (!callId) return;
    const socket = getSocket();
    socket.emit("group-call:leave", { callId });
    groupCallManager.cleanup();
    setGroupCallState("idle");
    setCallId(null);
    setConversationId(null);
    setParticipants([]);
    setLocalStream(null);
    setIsMuted(false);
  }, [callId]);

  const toggleMute = useCallback(() => {
    const track = groupCallManager.getLocalStream()?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMuted(!track.enabled);
  }, []);

  useEffect(() => {
    groupCallManager.onParticipantStream = (userId, stream) => {
      setParticipants((prev) =>
        prev.map((participant) =>
          participant.userId === userId ? { ...participant, stream } : participant,
        ),
      );
    };

    groupCallManager.onParticipantLeft = (userId) => {
      setParticipants((prev) => prev.filter((participant) => participant.userId !== userId));
    };

    return () => {
      groupCallManager.onParticipantStream = null;
      groupCallManager.onParticipantLeft = null;
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const onInitiated = async (evt: GroupCallInitiatedEvent) => {
      const isSelfStart = groupCallState === "joining" || pendingStartRef.current;

      if (isSelfStart) {
        pendingStartRef.current = false;
        setCallId(evt.callId);
        setConversationId(evt.conversationId);
        setParticipants(
          evt.participants.map((participant) => ({
            userId: participant.userId,
            userName: participant.userName,
            stream: null,
          })),
        );
        setGroupCallState("active");

        await groupCallManager.fetchAndCacheIceServers();
        const stream = await groupCallManager.initializeMedia();
        setLocalStream(stream);
        groupCallManager.callId = evt.callId;

        for (const participant of evt.participants) {
          await groupCallManager.sendOffer(participant.userId, socket);
        }
      } else {
        setIncomingGroupCall({
          callId: evt.callId,
          conversationId: evt.conversationId,
          initiatorName: evt.initiatorName,
        });
        setGroupCallState("incoming");
      }
    };

    const onParticipantJoined = (evt: GroupCallParticipantJoinedEvent) => {
      setParticipants((prev) => [
        ...prev,
        { userId: evt.userId, userName: evt.userName, stream: null },
      ]);
    };

    const onParticipantLeft = (evt: GroupCallParticipantLeftEvent) => {
      groupCallManager.removeParticipant(evt.userId);
      setParticipants((prev) => prev.filter((participant) => participant.userId !== evt.userId));
    };

    const onEnded = () => {
      groupCallManager.cleanup();
      setGroupCallState("idle");
      setCallId(null);
      setConversationId(null);
      setParticipants([]);
      setLocalStream(null);
    };

    const onOffer = async (evt: GroupCallOfferEvent) => {
      await groupCallManager.handleOffer(evt.fromUserId, evt.sdp, socket);
      setParticipants((prev) =>
        prev.some((participant) => participant.userId === evt.fromUserId)
          ? prev
          : [
              ...prev,
              {
                userId: evt.fromUserId,
                userName: evt.fromUserId,
                stream: null,
              },
            ],
      );
    };

    const onAnswer = async (evt: GroupCallOfferEvent) => {
      await groupCallManager.handleAnswer(evt.fromUserId, evt.sdp);
    };

    const onIce = async (evt: GroupCallIceEvent) => {
      await groupCallManager.addIceCandidate(evt.fromUserId, evt.candidate);
    };

    const onError = (evt: GroupCallErrorEvent) => {
      console.error("Group call error:", evt.code);
      if (groupCallState === "joining") {
        setGroupCallState("idle");
      }
    };

    socket.on("group-call:initiated", onInitiated);
    socket.on("group-call:participant-joined", onParticipantJoined);
    socket.on("group-call:participant-left", onParticipantLeft);
    socket.on("group-call:ended", onEnded);
    socket.on("group-call:offer", onOffer);
    socket.on("group-call:answer", onAnswer);
    socket.on("group-call:ice", onIce);
    socket.on("group-call:error", onError);

    return () => {
      socket.off("group-call:initiated", onInitiated);
      socket.off("group-call:participant-joined", onParticipantJoined);
      socket.off("group-call:participant-left", onParticipantLeft);
      socket.off("group-call:ended", onEnded);
      socket.off("group-call:offer", onOffer);
      socket.off("group-call:answer", onAnswer);
      socket.off("group-call:ice", onIce);
      socket.off("group-call:error", onError);
    };
  }, [groupCallState]);

  const value: GroupCallContextValue = {
    groupCallState,
    callId,
    conversationId,
    participants,
    incomingGroupCall,
    localStream,
    isMuted,
    startGroupCall,
    joinGroupCall,
    declineGroupCall,
    leaveGroupCall,
    toggleMute,
  };

  return <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>;
}
