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
    // Munge SDP for better audio quality before setting
    const mungedOffer = {
      ...offer,
      sdp: offer.sdp ? CallManager.mungeOpusSdp(offer.sdp) : offer.sdp,
    };
    await this.pc!.setLocalDescription(mungedOffer);

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
    // Munge SDP for better audio quality
    const mungedAnswer = {
      ...answer,
      sdp: answer.sdp ? CallManager.mungeOpusSdp(answer.sdp) : answer.sdp,
    };
    await this.pc!.setLocalDescription(mungedAnswer);

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
      audio: {
        // Echo/noise processing — critical for call quality
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Request high-quality audio capture
        channelCount: 1,         // Mono is best for voice
        sampleRate: 48000,       // Opus native rate
        sampleSize: 16,          // 16-bit samples
      },
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

  /**
   * Munge SDP to set Opus codec parameters for higher voice quality:
   * - maxaveragebitrate: 64000 (64kbps — double the ~32kbps default)
   * - useinbandfec=1: Forward error correction for packet loss resilience
   * - usedtx=0: Disable discontinuous transmission to avoid audio gaps
   * - stereo=0: Mono for voice (more efficient)
   * - maxplaybackrate=48000: Full Opus sample rate
   * - cbr=0: Allow variable bitrate for better quality
   * - ptime=60: 60ms audio frames for less packet overhead & fewer cut-offs
   */
  private static mungeOpusSdp(sdp: string): string {
    const lines = sdp.split('\r\n');
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      result.push(line);

      // Find Opus fmtp lines and enhance them
      if (line.startsWith('a=fmtp:') && i > 0) {
        // Check if the corresponding rtpmap is opus
        const payloadMatch = line.match(/^a=fmtp:(\d+)/);
        if (payloadMatch) {
          const pt = payloadMatch[1];
          // Look for the rtpmap for this payload type
          const rtpmapLine = lines.find(
            (l) => l.startsWith(`a=rtpmap:${pt} `) && l.toLowerCase().includes('opus'),
          );
          if (rtpmapLine) {
            // Replace the fmtp line we just pushed with enhanced params
            const existingParams = line.substring(line.indexOf(' ') + 1);
            const params = new Map<string, string>();

            // Parse existing params
            for (const param of existingParams.split(';')) {
              const [key, val] = param.trim().split('=');
              if (key && val !== undefined) {
                params.set(key.trim(), val.trim());
              }
            }

            // Set quality params
            params.set('maxaveragebitrate', '64000');
            params.set('useinbandfec', '1');
            params.set('usedtx', '0');
            params.set('stereo', '0');
            params.set('maxplaybackrate', '48000');
            params.set('cbr', '0');
            params.set('ptime', '60');

            const enhanced = `a=fmtp:${pt} ${Array.from(params.entries())
              .map(([k, v]) => `${k}=${v}`)
              .join(';')}`;

            // Replace the last pushed line
            result[result.length - 1] = enhanced;
          }
        }
      }
    }

    return result.join('\r\n');
  }
}
