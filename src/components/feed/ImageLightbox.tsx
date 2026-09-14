import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { AuthedImage } from "@/components/ui/AuthedImage";

interface ImageLightboxProps {
  images: string[];
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
  currentIndex?: number;
}

export function ImageLightbox({
  images,
  open,
  onClose,
  initialIndex = 0,
  currentIndex,
  onIndexChange,
}: ImageLightboxProps) {
  const idx = currentIndex ?? initialIndex;
  const total = images.length;

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && total > 1) onIndexChange?.((idx - 1 + total) % total);
      if (e.key === "ArrowRight" && total > 1) onIndexChange?.((idx + 1) % total);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, idx, total, onClose, onIndexChange]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close lightbox"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Counter */}
      {total > 1 && (
        <span className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white backdrop-blur-sm">
          {idx + 1} / {total}
        </span>
      )}

      {/* Prev */}
      {total > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange?.((idx - 1 + total) % total); }}
          aria-label="Previous image"
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {/* Image */}
      <div
        className="max-h-[90vh] max-w-[90vw] relative"
        onClick={(e) => e.stopPropagation()}
      >
        <AuthedImage
          src={images[idx]}
          alt={`Image ${idx + 1} of ${total}`}
          loading="eager"
          className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        />
      </div>

      {/* Next */}
      {total > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange?.((idx + 1) % total); }}
          aria-label="Next image"
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Dots */}
      {total > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); onIndexChange?.(i); }}
              aria-label={`Go to image ${i + 1}`}
              className={`h-2 rounded-full transition-all ${i === idx ? "w-6 bg-white" : "w-2 bg-white/40"}`}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
