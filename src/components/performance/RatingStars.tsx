import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingStarsProps {
  value: number | null;
  onChange?: (rating: number) => void;
  readonly?: boolean;
  size?: "sm" | "md";
  label?: string;
}

export function RatingStars({ value, onChange, readonly = false, size = "md", label }: RatingStarsProps) {
  const starSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div className="flex items-center gap-1">
      {label && <span className="text-xs text-muted-foreground mr-1">{label}:</span>}
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          className={cn(
            "transition-colors",
            readonly ? "cursor-default" : "cursor-pointer hover:scale-110"
          )}
        >
          <Star
            className={cn(
              starSize,
              star <= (value || 0)
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
      {value !== null && value !== undefined && (
        <span className="text-xs font-medium text-muted-foreground ml-1">{value}/5</span>
      )}
    </div>
  );
}
