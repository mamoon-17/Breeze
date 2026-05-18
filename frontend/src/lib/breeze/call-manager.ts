/**
 * CallManager — singleton WebRTC peer connection lifecycle for 1:1 calls.
 *
 * Responsibilities:
 * - getUserMedia for audio/video calls
 * - Create / handle RTCPeerConnection, SDP offers & answers
 * - Trickle ICE relay via socket helpers
 * - Mute/unmute and camera enable/disable
 * - ICE failure detection with grace period + restartIce
 * - Cleanup on call end
 */

import { emitCallIceCandidate } from "./socket";

export type CallManagerState = "idle" | "connecting" | "connected" | "failed";
export type CallType = "audio" | "video";

export interface CallManagerCallbacks {
  onStateChange: (state: CallManagerState) => void;
  onRemoteStream: (stream: MediaStream) => void;
}

let instance: CallManager | null = null;

export class CallManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private originalVideoTrack: MediaStreamTrack | null = null;
  private replacingTrackUntil: number = 0;
  private facingMode: "user" | "environment" = "user";
  private callId: string | null = null;
  private state: CallManagerState = "idle";
  private callbacks: CallManagerCallbacks | null = null;
  private iceRestartAttempted = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCandidates: RTCIceCandidate[] = [];
  videoFallbackToAudio = false;
  isScreenSharing = false;
  onScreenShareStopped: (() => void) | null = null;
  onIceFailed: (() => void) | null = null;

  static getInstance(): CallManager {
    if (!instance) instance = new CallManager();
    return instance;
  }

  setCallbacks(cb: CallManagerCallbacks) {
    this.callbacks = cb;
  }

  get activeCallId(): string | null {
    return this.callId;
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
    type: CallType = "audio",
  ): Promise<string> {
    this.callId = callId;
    this.setState("connecting");

    await this.initializeMedia(type);
    this.createPeerConnection(iceServers, type);

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
    type: CallType = "audio",
  ): Promise<string> {
    this.callId = callId;
    this.setState("connecting");

    await this.initializeMedia(type);
    this.createPeerConnection(iceServers, type);

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

  // ─── Media controls ─────────────────────────────────────────────────────

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

  toggleCamera(): boolean {
    const track = this.cameraTrack;
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled; // returns true if camera is now off
  }

  async switchCamera(): Promise<void> {
    this.facingMode = this.facingMode === "user" ? "environment" : "user";
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facingMode, width: 1280, height: 720, frameRate: 30 },
    });
    const newTrack = newStream.getVideoTracks()[0];
    if (!newTrack) return;
    newTrack.enabled = this.cameraTrack?.enabled ?? true;

    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);

    if (this.localStream) {
      const oldTrack = this.cameraTrack;
      if (oldTrack) this.localStream.removeTrack(oldTrack);
      this.localStream.addTrack(newTrack);
    }

    this.cameraTrack?.stop();
    this.cameraTrack = newTrack;
  }

  async startScreenShare(): Promise<void> {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor" },
      audio: false,
    });
    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack) return;

    // Store original camera track so we can restore it
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    this.originalVideoTrack = sender.track ?? null;

    this.replacingTrackUntil = Date.now() + 3000;
    await sender.replaceTrack(screenTrack);
    this.screenTrack = screenTrack;
    this.isScreenSharing = true;

    // When user stops sharing via browser UI (clicks Stop in browser bar)
    screenTrack.onended = () => {
      this.stopScreenShare().catch(() => {});
      this.onScreenShareStopped?.();
    };
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenTrack) return;
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (sender && this.originalVideoTrack) {
      if (this.originalVideoTrack.readyState === "live") {
        this.replacingTrackUntil = Date.now() + 3000;
        await sender.replaceTrack(this.originalVideoTrack);
      } else {
        // Original camera track was stopped (user turned camera off)
        // Replace with null to send a black track rather than crashing
        this.replacingTrackUntil = Date.now() + 3000;
        await sender.replaceTrack(null);
      }
    }
    this.screenTrack.stop();
    this.screenTrack = null;
    this.isScreenSharing = false;
  }

  async initializeMedia(type: CallType): Promise<MediaStream> {
    if (this.localStream) return this.localStream;

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    };
    const audioOnlyConstraints: MediaStreamConstraints = {
      audio: audioConstraints,
      video: false,
    };

    this.videoFallbackToAudio = false;

    if (type === "audio") {
      this.localStream = await navigator.mediaDevices.getUserMedia(audioOnlyConstraints);
    } else {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: {
            width: 1280,
            height: 720,
            frameRate: 30,
            facingMode: this.facingMode,
          },
        });
      } catch {
        this.videoFallbackToAudio = true;
        this.localStream = await navigator.mediaDevices.getUserMedia(audioOnlyConstraints);
      }
    }

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) this.cameraTrack = videoTrack;

    return this.localStream;
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

    if (this.screenTrack) {
      this.screenTrack.stop();
      this.screenTrack = null;
    }

    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.ontrack = null;
      this.pc.close();
      this.pc = null;
    }

    this.remoteStream = null;
    this.cameraTrack = null;
    this.videoFallbackToAudio = false;
    this.originalVideoTrack = null;
    this.isScreenSharing = false;
    this.onScreenShareStopped = null;
    this.onIceFailed = null;
    this.callId = null;
    this.pendingCandidates = [];
    this.iceRestartAttempted = false;
    this.replacingTrackUntil = 0;
    this.setState("idle");
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private setState(s: CallManagerState) {
    this.state = s;
    this.callbacks?.onStateChange(s);
  }

  private createPeerConnection(iceServers: RTCIceServer[], type: CallType): void {
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

    // Remote track → media playback
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
          if (type === "video") {
            void this.applyVideoBandwidthHint();
          }
          if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
          }
          break;

        case "disconnected":
          // 5s grace period before treating as failed
          if (!this.disconnectTimer && Date.now() > this.replacingTrackUntil) {
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
          if (Date.now() > this.replacingTrackUntil) this.handleIceFailed();
          break;
      }
    };
  }

  private async applyVideoBandwidthHint(): Promise<void> {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = 500_000;
    try {
      await sender.setParameters(params);
    } catch (err) {
      console.warn("[CallManager] Failed to set video bandwidth hint:", err);
    }
  }

  private handleIceFailed(): void {
    if (Date.now() <= this.replacingTrackUntil) return;
    this.setState("failed");
    this.onIceFailed?.();
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
    const lines = sdp.split("\r\n");
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      result.push(line);

      // Find Opus fmtp lines and enhance them
      if (line.startsWith("a=fmtp:") && i > 0) {
        // Check if the corresponding rtpmap is opus
        const payloadMatch = line.match(/^a=fmtp:(\d+)/);
        if (payloadMatch) {
          const pt = payloadMatch[1];
          // Look for the rtpmap for this payload type
          const rtpmapLine = lines.find(
            (l) => l.startsWith(`a=rtpmap:${pt} `) && l.toLowerCase().includes("opus"),
          );
          if (rtpmapLine) {
            // Replace the fmtp line we just pushed with enhanced params
            const existingParams = line.substring(line.indexOf(" ") + 1);
            const params = new Map<string, string>();

            // Parse existing params
            for (const param of existingParams.split(";")) {
              const [key, val] = param.trim().split("=");
              if (key && val !== undefined) {
                params.set(key.trim(), val.trim());
              }
            }

            // Set quality params
            params.set("maxaveragebitrate", "64000");
            params.set("useinbandfec", "1");
            params.set("usedtx", "0");
            params.set("stereo", "0");
            params.set("maxplaybackrate", "48000");
            params.set("cbr", "0");
            params.set("ptime", "60");

            const enhanced = `a=fmtp:${pt} ${Array.from(params.entries())
              .map(([k, v]) => `${k}=${v}`)
              .join(";")}`;

            // Replace the last pushed line
            result[result.length - 1] = enhanced;
          }
        }
      }
    }

    return result.join("\r\n");
  }
}
