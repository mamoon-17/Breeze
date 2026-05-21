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
    const response = await Calls.iceServers();
    this.iceServers = response;
  }

  async initializeMedia(): Promise<MediaStream> {
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
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  private createPeerConnection(userId: string, socket: Socket): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.localStream
      ?.getTracks()
      .forEach((track) => pc.addTrack(track, this.localStream as MediaStream));

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
