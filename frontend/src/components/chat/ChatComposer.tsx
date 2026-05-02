// Composer at the bottom of a thread.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import { emitTyping, emitStopTyping } from "@/lib/breeze/socket";

interface Props {
  onSend: (text: string) => void;
  onSendAudio?: (blob: Blob) => void;
  onSendAttachments?: (files: File[]) => void;
  uploadingAttachments?: boolean;
  conversationId?: string;
  disabled?: boolean;
  /** When provided, the composer uses this external value instead of local state */
  externalValue?: string;
  /** Called when the composer text changes (used with externalValue) */
  onExternalChange?: (text: string) => void;
}

const TYPING_THROTTLE_MS = 2000;

export function ChatComposer({
  onSend,
  onSendAudio,
  onSendAttachments,
  uploadingAttachments,
  conversationId,
  disabled,
  externalValue,
  onExternalChange,
}: Props) {
  const [localValue, setLocalValue] = useState("");
  const value = externalValue !== undefined ? externalValue : localValue;
  const setValueFn = onExternalChange ?? setLocalValue;
  const typingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartedAtRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<number | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pickerLeft, setPickerLeft] = useState<number | null>(null);

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

  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (emojiPickerRef.current?.contains(target)) return;
      if (emojiButtonRef.current?.contains(target)) return;
      setShowEmojiPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmojiPicker]);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowEmojiPicker(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showEmojiPicker]);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const button = emojiButtonRef.current;
    const container = composerRef.current;
    if (!button || !container) return;
    const buttonRect = button.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const nextLeft = Math.max(8, Math.round(buttonRect.left - containerRect.left));
    setPickerLeft(nextLeft);
  }, [showEmojiPicker]);

  const openFilePicker = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const updateSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    selectionRef.current = el.selectionStart ?? el.value.length;
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onSendAttachments?.(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
    setValueFn(text);
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
    setValueFn("");
  };

  const handleEmojiSelect = (emojiData: EmojiClickData) => {
    const emoji = emojiData.emoji;
    const currentValue = value;
    const input = textareaRef.current;
    const cursor = input?.selectionStart ?? selectionRef.current ?? currentValue.length;
    const nextValue = currentValue.slice(0, cursor) + emoji + currentValue.slice(cursor);
    setValueFn(nextValue);
    setShowEmojiPicker(false);

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const nextCursor = cursor + emoji.length;
      el.setSelectionRange(nextCursor, nextCursor);
      selectionRef.current = nextCursor;
    });
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

  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div ref={composerRef} className="relative shrink-0 px-6 pb-6 md:px-8">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,video/*,application/pdf"
        onChange={(e) => onPickFiles(e.target.files)}
      />
      {showEmojiPicker && (
        <div
          ref={emojiPickerRef}
          className="absolute bottom-full z-50 mb-2"
          style={{ left: pickerLeft ?? 0 }}
        >
          <EmojiPicker onEmojiClick={handleEmojiSelect} />
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-linen-200 bg-card p-2 shadow-soft">
        <button
          aria-label="Attach"
          type="button"
          onClick={openFilePicker}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-linen-100"
        >
          {uploadingAttachments ? (
            <span
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-label="Uploading"
            />
          ) : (
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
          )}
        </button>
        <button
          aria-label="Emoji"
          ref={emojiButtonRef}
          onMouseDown={updateSelection}
          onClick={() => setShowEmojiPicker((prev) => !prev)}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-linen-100"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            handleChange(e.target.value);
            selectionRef.current = e.target.selectionStart ?? e.target.value.length;
          }}
          onKeyDown={onKey}
          onClick={updateSelection}
          onKeyUp={updateSelection}
          onSelect={updateSelection}
          onFocus={updateSelection}
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
