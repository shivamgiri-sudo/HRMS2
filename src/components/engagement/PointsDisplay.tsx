import { Sparkles } from "lucide-react";

export function PointsDisplay({ points, compact = false }: { points: number; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-amber-600 ${compact ? "text-sm" : "text-2xl"}`}>
      <Sparkles className={compact ? "h-4 w-4" : "h-5 w-5"} />
      {Number(points ?? 0).toLocaleString()} pts
    </span>
  );
}
