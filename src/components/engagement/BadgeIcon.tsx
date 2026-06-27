import { Award } from "lucide-react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface BadgeIconProps {
  badge_name: string;
  badge_icon: string | null;
  badge_description: string | null;
  earned_at: string;
  badge_category: string;
  className?: string;
}

const categoryColors = {
  performance: "from-amber-400 to-yellow-500",
  activity: "from-blue-400 to-indigo-500",
  tenure: "from-purple-400 to-pink-500",
  social: "from-green-400 to-emerald-500",
};

export function BadgeIcon({
  badge_name,
  badge_icon,
  badge_description,
  earned_at,
  badge_category,
  className,
}: BadgeIconProps) {
  const gradientClass = categoryColors[badge_category as keyof typeof categoryColors] || "from-slate-400 to-gray-500";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "group relative flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-all duration-300 hover:scale-110 hover:shadow-xl",
              "bg-gradient-to-br from-white to-slate-50 border-2 border-slate-200 hover:border-slate-300",
              className
            )}
          >
            {/* Shiny effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            {/* Badge Icon */}
            <div
              className={cn(
                "relative h-16 w-16 rounded-full flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:rotate-12",
                "bg-gradient-to-br",
                gradientClass
              )}
            >
              {badge_icon ? (
                <span className="text-3xl">{badge_icon}</span>
              ) : (
                <Award className="h-8 w-8 text-white" />
              )}

              {/* Sparkle effect */}
              <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-yellow-300 animate-ping opacity-75" />
              <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-yellow-400" />
            </div>

            {/* Badge Name */}
            <p className="text-xs font-bold text-center text-slate-900 line-clamp-2 min-h-[2rem]">
              {badge_name}
            </p>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-2">
            <p className="font-bold text-sm">{badge_name}</p>
            {badge_description && (
              <p className="text-xs text-slate-600">{badge_description}</p>
            )}
            <p className="text-xs text-slate-400">
              Earned: {formatISTDate(earned_at)}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
