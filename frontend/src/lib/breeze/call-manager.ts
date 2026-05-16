/**
 * CallManager — singleton WebRTC peer connection lifecycle for audio-only 1:1 calls.
 *
 * Responsibilities:
 * - getUserMedia (audio only)
 * - Create / handle RTCPeerConnection, SDP offers & answers
 * - Trickle ICE relay via socket helpers
 * - Mute/unmute (no renegotiation — just toggle track.enabled)
 * - ICE failure detection with grace period + restartIce
 * - Cleanup on call end
 */

import {
  emitCallIceCandidate,
  emitCallIceFailed,
} from "./socket";

export type CallManagerState = "idle" | "connecting" | "connected" | "failed";

export interface CallManagerCallbacks {
  onStateChange: (state: CallManagerState) => void;
  onRemoteStream: (stream: MediaStream) => void;
}

let instance: CallManager | null = null;

export class CallManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private callId: string | null = null;
  private state: CallManagerState = "idle";
  private callbacks: CallManagerCallbacks | null = null;
  private iceRestartAttempted = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCandidates: RTCIceCandidate[] = [];

  static getInstance(): CallManager {
    if (!instance) instance = new CallManager();
    return instance;
  }

  setCallbacks(cb: CallManagerCallbacks) {
    this.callbacks = cb;
  }

  getState(): CallManagerState {
    return this.state;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  // ─── Initiator (caller) ─────────────────────────────────────────────────

  async createOffer(
    callId: string,
    iceServers: RTCIceServer[],
  ): Promise<string> {
    this.callId = callId;
    this.setState("connecting");

    await this.acquireMedia();
    this.createPeerConnection(iceServers);

    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);

    return JSON.stringify(this.pc!.localDescription);
  }

  // Called when callee is initiating (they received offer, need to create answer)
  async createAnswer(
    callId: string,
    offerSdp: string,
    iceServers: RTCIceServer[],
  ): Promise<string> {
    this.callId = callId;
    this.setState("connecting");

    await this.acquireMedia();
    this.createPeerConnection(iceServers);

    const offer = JSON.parse(offerSdp) as RTCSessionDescriptionInit;
    await this.pc!.setRemoteDescription(new RTCSessionDescription(offer));

    // Flush any buffered candidates that arrived before remote description was set
    await this.flushPendingCandidates();

    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);

    return JSON.stringify(this.pc!.localDescription);
  }

  // ─── Signaling handlers ─────────────────────────────────────────────────

  async setRemoteAnswer(answerSdp: string): Promise<void> {
    if (!this.pc) return;
    const answer = JSON.parse(answerSdp) as RTCSessionDescriptionInit;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    // Flush any buffered candidates
    await this.flushPendingCandidates();
  }

  async addIceCandidate(candidateJson: string): Promise<void> {
    if (!this.pc) return;
    const candidate = JSON.parse(candidateJson) as RTCIceCandidateInit;
    const iceCandidate = new RTCIceCandidate(candidate);

    // Buffer candidates if remote description isn't set yet
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(iceCandidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(iceCandidate);
    } catch (err) {
      console.warn("[CallManager] Failed to add ICE candidate:", err);
    }
  }

  // ─── Mute ───────────────────────────────────────────────────────────────

  isMuted(): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    return track ? !track.enabled : true;
  }

  toggleMute(): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return true;
    track.enabled = !track.enabled;
    return !track.enabled; // returns true if muted
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  cleanup(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.ontrack = null;
      this.pc.close();
      this.pc = null;
    }

    this.remoteStream = null;
    this.callId = null;
    this.pendingCandidates = [];
    this.iceRestartAttempted = false;
    this.setState("idle");
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private setState(s: CallManagerState) {
    this.state = s;
    this.callbacks?.onStateChange(s);
  }

  private async acquireMedia(): Promise<void> {
    if (this.localStream) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  }

  private createPeerConnection(iceServers: RTCIceServer[]): void {
    this.pc = new RTCPeerConnection({ iceServers });

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.pc!.addTrack(track, this.localStream!);
      });
    }

    // ICE candidate → relay to server
    this.pc.onicecandidate = (evt) => {
      if (evt.candidate && this.callId) {
        emitCallIceCandidate(this.callId, JSON.stringify(evt.candidate));
      }
    };

    // Remote track → audio playback
    this.pc.ontrack = (evt) => {
      this.remoteStream = evt.streams[0] ?? new MediaStream([evt.track]);
      this.callbacks?.onRemoteStream(this.remoteStream);
    };

    // ICE connection state monitoring
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState;
      if (!state) return;

      switch (state) {
        case "connected":
        case "completed":
          this.setState("connected");
          this.iceRestartAttempted = false;
          if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
          }
          break;

        case "disconnected":
          // 5s grace period before treating as failed
          if (!this.disconnectTimer) {
            this.disconnectTimer = setTimeout(() => {
              if (this.pc?.iceConnectionState === "disconnected") {
                if (!this.iceRestartAttempted) {
                  this.iceRestartAttempted = true;
                  this.pc.restartIce();
                } else {
                  this.handleIceFailed();
                }
              }
            }, 5000);
          }
          break;

        case "failed":
          this.handleIceFailed();
          break;
      }
    };
  }

  private handleIceFailed(): void {
    if (this.callId) {
      emitCallIceFailed(this.callId);
    }
    this.setState("failed");
  }

  private async flushPendingCandidates(): Promise<void> {
    if (!this.pc || this.pendingCandidates.length === 0) return;
    for (const candidate of this.pendingCandidates) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn("[CallManager] Failed to flush ICE candidate:", err);
      }
    }
    this.pendingCandidates = [];
  }
}
