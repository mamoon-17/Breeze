import type { Socket } from "socket.io-client";
import { Calls } from "./api";

class GroupCallManager {
  private pcs: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [];
  callId: string | null = null;
  onParticipantStream: ((userId: string, stream: MediaStream) => void) | null = null;
  onParticipantLeft: ((userId: string) => void) | null = null;

  async fetchAndCacheIceServers(): Promise<void> {
    try {
      const response = await Calls.iceServers();
      console.log("Group call ICE servers response:", response);
      const servers = (response as { iceServers?: RTCIceServer[] }).iceServers ?? response;
      this.iceServers = Array.isArray(servers) ? servers : [];
      console.log("Group call ICE servers cached:", this.iceServers);
    } catch (err) {
      console.error("Failed to fetch ICE servers for group call:", err);
      this.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    }
  }

  async initializeMedia(): Promise<MediaStream> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
        video: false,
      });

      this.localStream = stream;
      return stream;
    } catch (err) {
      console.error("Group call getUserMedia failed:", err);
      throw err;
    }
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  private createPeerConnection(userId: string, socket: Socket): RTCPeerConnection {
    const iceServers =
      Array.isArray(this.iceServers) && this.iceServers.length > 0
        ? this.iceServers
        : [{ urls: "stun:stun.l.google.com:19302" }];
    const pc = new RTCPeerConnection({ iceServers });
    const tracks = this.localStream?.getTracks() ?? [];
    console.log(
      "GroupCall: adding tracks to PC:",
      tracks.map((track) => `${track.kind}:${track.enabled}`),
    );
    tracks.forEach((track) => {
      if (this.localStream) {
        pc.addTrack(track, this.localStream);
      }
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && this.callId) {
        socket.emit("group-call:ice", {
          callId: this.callId,
          targetUserId: userId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.onParticipantStream?.(userId, stream);
    };

    this.pcs.set(userId, pc);
    return pc;
  }

  async sendOffer(userId: string, socket: Socket): Promise<void> {
    const pc = this.createPeerConnection(userId, socket);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("group-call:offer", {
      callId: this.callId,
      targetUserId: userId,
      sdp: JSON.stringify(pc.localDescription),
    });
  }

  async handleOffer(fromUserId: string, sdp: string, socket: Socket): Promise<void> {
    const pc = this.createPeerConnection(fromUserId, socket);
    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp)));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("group-call:answer", {
      callId: this.callId,
      targetUserId: fromUserId,
      sdp: JSON.stringify(pc.localDescription),
    });
  }

  async handleAnswer(fromUserId: string, sdp: string): Promise<void> {
    const pc = this.pcs.get(fromUserId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp)));
    }
  }

  async addIceCandidate(fromUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.pcs.get(fromUserId);
    if (pc?.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  removeParticipant(userId: string): void {
    const pc = this.pcs.get(userId);
    if (pc) {
      pc.close();
      this.pcs.delete(userId);
    }

    this.onParticipantLeft?.(userId);
  }

  cleanup(): void {
    this.pcs.forEach((pc) => pc.close());
    this.pcs.clear();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.callId = null;
    this.iceServers = [];
    this.onParticipantStream = null;
    this.onParticipantLeft = null;
  }
}

export const groupCallManager = new GroupCallManager();
