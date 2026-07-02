import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CompetencyCardProps {
  name: string;
  category: string;
  rating: number | null;
  description?: string;
  variant?: "default" | "compact";
  className?: string;
}

const categoryColors: Record<string, string> = {
  technical: "bg-blue-500/10 text-blue-600 border-blue-200",
  behavioral: "bg-purple-500/10 text-purple-600 border-purple-200",
  leadership: "bg-amber-500/10 text-amber-600 border-amber-200",
  communication: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
  default: "bg-muted text-muted-foreground border-muted",
};

export function CompetencyCard({
  name,
  category,
  rating,
  description,
  variant = "default",
  className,
}: CompetencyCardProps) {
  const categoryColor =
    categoryColors[category.toLowerCase()] || categoryColors.default;

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center justify-between p-3 rounded-lg border bg-card",
          className
        )}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{name}</span>
            <Badge variant="outline" className={cn("text-xs", categoryColor)}>
              {category}
            </Badge>
          </div>
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 ml-4">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={cn(
                "h-4 w-4",
                star <= (rating || 0)
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/20"
              )}
            />
          ))}
          {rating !== null && rating !== undefined && (
            <span className="text-sm font-bold text-muted-foreground ml-2">
              {rating}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className={cn("hover:shadow-md transition-shadow", className)}>
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <h4 className="font-semibold text-base">{name}</h4>
              <Badge variant="outline" className={cn("text-xs", categoryColor)}>
                {category}
              </Badge>
            </div>

            {rating !== null && rating !== undefined && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
                <span className="text-2xl font-bold text-foreground">
                  {rating}
                </span>
                <span className="text-sm text-muted-foreground">/5</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={cn(
                  "h-5 w-5",
                  star <= (rating || 0)
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground/20"
                )}
              />
            ))}
          </div>

          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
