import { X } from "lucide-react";

interface VideoModalProps {
  videoId: string;
  title: string;
  onClose: () => void;
}

export function VideoModal({ videoId, title, onClose }: VideoModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl overflow-hidden rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MCN navy top bar */}
        <div className="flex items-center gap-3 bg-[#073f78] px-4 py-3">
          <img
            src="/mcn-icon.png"
            alt="MCN"
            className="h-5 w-5 brightness-0 invert"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <p className="flex-1 truncate text-sm font-black text-white">{title || "MAS Connect"}</p>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition hover:bg-[#E8231A] hover:text-white cursor-pointer"
            aria-label="Close video"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Three-stripe */}
        <div className="flex h-[3px]">
          <div className="flex-1 bg-[#1B6AB5]" />
          <div className="flex-1 bg-[#3BAD49]" />
          <div className="flex-1 bg-[#E8231A]" />
        </div>

        {/* 16:9 iframe */}
        <div className="aspect-video bg-black">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full border-0"
          />
        </div>
      </div>
    </div>
  );
}
