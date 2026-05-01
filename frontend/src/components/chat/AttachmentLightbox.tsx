import { useEffect, useMemo, useState } from "react";

export type LightboxItem =
  | { type: "image"; url: string; filename?: string | null }
  | { type: "video"; url: string; filename?: string | null };

export function AttachmentLightbox({
  open,
  items,
  startIndex,
  onClose,
}: {
  open: boolean;
  items: LightboxItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);

  useEffect(() => {
    if (!open) return;
    setIdx(startIndex);
  }, [open, startIndex]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(items.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, items.length, onClose]);

  const item = items[idx];
  const downloadName = useMemo(() => {
    const base = (item?.filename ?? "").trim();
    if (base) return base;
    return item?.type === "video" ? "video" : "image";
  }, [item]);

  if (!open || !item) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-black shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 text-white">
          <div className="min-w-0 truncate text-sm opacity-90">
            {item.filename ?? (item.type === "video" ? "Video" : "Image")}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={item.url}
              download={downloadName}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              Close
            </button>
          </div>
        </div>

        <div className="relative flex min-h-[240px] flex-1 items-center justify-center bg-black">
          {item.type === "image" ? (
            <img
              src={item.url}
              alt={item.filename ?? ""}
              className="max-h-[75vh] w-auto max-w-full object-contain"
            />
          ) : (
            <video
              src={item.url}
              controls
              autoPlay
              className="max-h-[75vh] w-auto max-w-full"
            />
          )}

          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
                aria-label="Previous"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setIdx((i) => Math.min(items.length - 1, i + 1))}
                disabled={idx === items.length - 1}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
                aria-label="Next"
              >
                Next
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

