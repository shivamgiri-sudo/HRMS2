import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Lightbulb,
  Check,
  Sparkles,
  BookOpen,
  ExternalLink,
  Building2,
  Cpu,
  MessageSquare,
  TrendingUp,
  Heart,
  Laugh,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TipCategory = 'productivity' | 'tech' | 'communication' | 'company' | 'industry' | 'wellness' | 'fun_fact' | 'general';

interface DailyTip {
  id: string;
  tip_date: string;
  category: TipCategory;
  title: string;
  content: string;
  media_url: string | null;
  learn_more_url: string | null;
  source: string | null;
}

interface TipReadStatus {
  tip: DailyTip;
  alreadyRead: boolean;
  readAt: string | null;
  pointsAwarded: number;
}

interface ReadTipResult {
  alreadyRead: boolean;
  pointsAwarded: number;
  tip: DailyTip;
}

const CATEGORY_CONFIG: Record<TipCategory, { icon: React.ElementType; label: string; color: string; bgColor: string }> = {
  productivity: { icon: TrendingUp, label: 'Productivity', color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  tech: { icon: Cpu, label: 'Tech Tip', color: 'text-purple-600', bgColor: 'bg-purple-100 dark:bg-purple-900/30' },
  communication: { icon: MessageSquare, label: 'Communication', color: 'text-green-600', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  company: { icon: Building2, label: 'Company', color: 'text-indigo-600', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  industry: { icon: BookOpen, label: 'Industry', color: 'text-amber-600', bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  wellness: { icon: Heart, label: 'Wellness', color: 'text-rose-600', bgColor: 'bg-rose-100 dark:bg-rose-900/30' },
  fun_fact: { icon: Laugh, label: 'Fun Fact', color: 'text-orange-600', bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  general: { icon: Lightbulb, label: 'Tip', color: 'text-slate-600', bgColor: 'bg-slate-100 dark:bg-slate-900/30' },
};

export function TipOfTheDay({ compact = false }: { compact?: boolean }) {
  const [showFull, setShowFull] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<TipReadStatus | null>({
    queryKey: ["daily-tip-today"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: TipReadStatus | null }>("/api/engagement/tips/today");
      return res.data;
    },
    staleTime: 60_000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (tipId: string) => {
      const res = await hrmsApi.post<{ data: ReadTipResult }>(`/api/engagement/tips/${tipId}/read`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-tip-today"] });
      queryClient.invalidateQueries({ queryKey: ["engagement-me"] });
      queryClient.invalidateQueries({ queryKey: ["gamification-points"] });
    },
  });

  if (isLoading) {
    return (
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data?.tip) {
    return (
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/50 dark:to-slate-800/50 shadow-lg">
        <CardContent className="p-4 flex items-center gap-3 text-slate-500">
          <Lightbulb className="h-5 w-5" />
          <span className="text-sm">No tip available today. Check back tomorrow!</span>
        </CardContent>
      </Card>
    );
  }

  const { tip, alreadyRead } = data;
  const categoryConfig = CATEGORY_CONFIG[tip.category] || CATEGORY_CONFIG.general;
  const CategoryIcon = categoryConfig.icon;

  // Compact version for dashboard
  if (compact) {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl p-3 transition-all cursor-pointer hover:shadow-md",
          alreadyRead
            ? "bg-green-50 dark:bg-green-950/30"
            : "bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30"
        )}
        onClick={() => !alreadyRead && tip && markReadMutation.mutate(tip.id)}
      >
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0",
            alreadyRead
              ? "bg-green-100 dark:bg-green-900/50"
              : categoryConfig.bgColor
          )}
        >
          {alreadyRead ? (
            <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
          ) : (
            <CategoryIcon className={cn("h-5 w-5", categoryConfig.color)} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {tip.title}
            </p>
            {!alreadyRead && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700">
                +2 pts
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
            {tip.content}
          </p>
        </div>
        {!alreadyRead && (
          <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
        )}
      </div>
    );
  }

  // Full card version
  return (
    <Card
      className={cn(
        "relative overflow-hidden border-0 shadow-xl transition-all duration-300",
        alreadyRead
          ? "bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30"
          : "bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-950/30 dark:via-yellow-950/30 dark:to-orange-950/30"
      )}
    >
      {/* Background decoration */}
      <div className="absolute -top-16 -right-16 h-32 w-32 rounded-full bg-gradient-to-br from-amber-200/30 to-yellow-200/30 blur-2xl" />

      <CardContent className="relative p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-xl shadow-lg",
                alreadyRead
                  ? "bg-gradient-to-br from-green-400 to-emerald-500"
                  : "bg-gradient-to-br from-amber-400 to-orange-500"
              )}
            >
              {alreadyRead ? (
                <Check className="h-6 w-6 text-white" />
              ) : (
                <Lightbulb className="h-6 w-6 text-white" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Tip of the Day
                </span>
                {!alreadyRead && (
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                    +2 pts
                  </Badge>
                )}
              </div>
              <Badge variant="outline" className={cn("text-xs mt-1", categoryConfig.color)}>
                <CategoryIcon className="h-3 w-3 mr-1" />
                {categoryConfig.label}
              </Badge>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="rounded-xl bg-white/60 dark:bg-slate-900/40 backdrop-blur-sm p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
            {tip.title}
          </h3>
          <p className={cn(
            "text-sm text-slate-600 dark:text-slate-300 leading-relaxed",
            !showFull && tip.content.length > 200 && "line-clamp-3"
          )}>
            {tip.content}
          </p>
          {tip.content.length > 200 && (
            <button
              onClick={() => setShowFull(!showFull)}
              className="text-xs text-amber-600 hover:text-amber-700 mt-2 font-medium"
            >
              {showFull ? 'Show less' : 'Read more'}
            </button>
          )}

          {/* Media */}
          {tip.media_url && (
            <div className="mt-3">
              <img
                src={tip.media_url}
                alt={tip.title}
                className="rounded-lg max-h-48 object-cover"
              />
            </div>
          )}

          {/* Source & Learn More */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-200/50 dark:border-slate-700/50">
            {tip.source && (
              <span className="text-xs text-slate-400">
                Source: {tip.source}
              </span>
            )}
            {tip.learn_more_url && (
              <a
                href={tip.learn_more_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"
              >
                Learn more <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        {/* Action */}
        {!alreadyRead ? (
          <Button
            onClick={() => markReadMutation.mutate(tip.id)}
            disabled={markReadMutation.isPending}
            className="w-full h-11 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold shadow-lg shadow-amber-500/25"
          >
            {markReadMutation.isPending ? (
              <Sparkles className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <BookOpen className="h-4 w-4 mr-2" />
            )}
            {markReadMutation.isPending ? "Marking as read..." : "I've read this tip"}
          </Button>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-green-100 dark:bg-green-900/30 p-3 text-green-700 dark:text-green-300">
            <Check className="h-4 w-4" />
            <span className="text-sm font-medium">You've read today's tip!</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TipOfTheDay;
