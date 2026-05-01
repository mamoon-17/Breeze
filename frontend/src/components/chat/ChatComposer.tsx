// Composer at the bottom of a thread.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { emitTyping, emitStopTyping } from "@/lib/breeze/socket";

interface Props {
  onSend: (text: string) => void;
  onSendAudio?: (blob: Blob) => void;
  conversationId?: string;
  disabled?: boolean;
}

const TYPING_THROTTLE_MS = 2000;

export function ChatComposer({
  onSend,
  onSendAudio,
  conversationId,
  disabled,
}: Props) {
  const [value, setValue] = useState("");
  const typingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
      recorderRef.current = null;
    };
  }, []);

  const clearTypingTimer = () => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  };

  const stopTyping = () => {
    if (!conversationId || !typingRef.current) return;
    typingRef.current = false;
    clearTypingTimer();
    emitStopTyping(conversationId);
  };

  const handleChange = (text: string) => {
    setValue(text);
    if (!conversationId) return;

    if (text.trim()) {
      if (!typingRef.current) {
        typingRef.current = true;
        emitTyping(conversationId);
      }
      // Reset the auto-stop timer on every keystroke.
      clearTypingTimer();
      typingTimerRef.current = setTimeout(() => {
        typingRef.current = false;
        emitStopTyping(conversationId);
      }, TYPING_THROTTLE_MS);
    } else {
      stopTyping();
    }
  };

  const send = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    stopTyping();
    onSend(trimmed);
    setValue("");
  };

  const toggleRecord = async () => {
    if (disabled) return;
    if (recording) {
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
      return;
    }

    if (!("mediaDevices" in navigator) || typeof MediaRecorder === "undefined") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      setRecordSeconds(0);

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstart = () => {
        setRecording(true);
        recordStartedAtRef.current = Date.now();
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        recordTimerRef.current = setInterval(() => {
          const startedAt = recordStartedAtRef.current;
          if (!startedAt) return;
          setRecordSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        }, 250);
      };
      rec.onstop = () => {
        setRecording(false);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
        recordStartedAtRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        stream.getTracks().forEach((t) => t.stop());
        if (blob.size > 0) {
          onSendAudio?.(blob);
        }
      };
      recorderRef.current = rec;
      rec.start();
    } catch {
      // ignore (permission denied, etc.)
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="shrink-0 px-6 pb-6 md:px-8">
      <div className="flex items-end gap-2 rounded-2xl border border-linen-200 bg-card p-2 shadow-soft">
        <button
          aria-label="Attach"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-linen-100"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          aria-label="Emoji"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-linen-100"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>
        <textarea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={onKey}
          onBlur={stopTyping}
          rows={1}
          placeholder="Write your thoughts…"
          className="scroll-soft min-h-10 max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <button
          aria-label="Voice message"
          type="button"
          onClick={() => void toggleRecord()}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-linen-100"
          title={recording ? `Recording… ${recordSeconds}s` : "Voice message"}
        >
          {recording ? (
            <span className="flex items-center gap-2 text-xs font-semibold text-red-600">
              <span className="size-2 rounded-full bg-red-500" />
              {recordSeconds}s
            </span>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="9" y1="22" x2="15" y2="22" />
            </svg>
          )}
        </button>
        <button
          onClick={send}
          disabled={!value.trim() || disabled}
          className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground transition hover:bg-linen-600 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
