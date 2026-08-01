import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Flame,
  Gift,
  Trophy,
  Sparkles,
  Check,
  Zap,
  Crown,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";

interface StreakStatus {
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string | null;
  todayClaimed: boolean;
  nextMilestone?: { days: number; multiplier: number };
}

interface ClaimResult {
  alreadyClaimedToday: boolean;
  pointsAwarded: number;
  basePoints: number;
  multiplier: number;
  currentStreak: number;
  longestStreak: number;
  streakBroken: boolean;
  newBadgeEarned?: { id: string; name: string; icon: string };
  nextMilestone?: { days: number; multiplier: number };
}

const MILESTONE_ICONS: Record<number, React.ReactNode> = {
  7: <Flame className="h-4 w-4 text-orange-500" />,
  30: <Zap className="h-4 w-4 text-yellow-500" />,
  100: <Trophy className="h-4 w-4 text-amber-500" />,
  365: <Crown className="h-4 w-4 text-purple-500" />,
};

function triggerConfetti() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    colors: ["#f59e0b", "#eab308", "#fbbf24", "#fcd34d"],
  });
}

export function DailyRewardClaim({ compact = false }: { compact?: boolean }) {
  const [showCelebration, setShowCelebration] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<StreakStatus>({
    queryKey: ["daily-login-status"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: StreakStatus }>("/engagement/daily-login/status");
      return res.data;
    },
    staleTime: 30_000,
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await hrmsApi.post<{ data: ClaimResult }>("/engagement/daily-login/claim");
      return res.data;
    },
    onSuccess: (data) => {
      setClaimResult(data);
      if (!data.alreadyClaimedToday && data.pointsAwarded > 0) {
        setShowCelebration(true);
        triggerConfetti();
        setTimeout(() => setShowCelebration(false), 3000);
      }
      queryClient.invalidateQueries({ queryKey: ["daily-login-status"] });
      queryClient.invalidateQueries({ queryKey: ["engagement-me"] });
      queryClient.invalidateQueries({ queryKey: ["gamification-points"] });
    },
  });

  const alreadyClaimed = status?.todayClaimed || claimResult?.alreadyClaimedToday;
  const currentStreak = claimResult?.currentStreak ?? status?.currentStreak ?? 0;
  const nextMilestone = claimResult?.nextMilestone ?? status?.nextMilestone;

  // Calculate multiplier text
  const getMultiplierText = (streak: number) => {
    if (streak >= 365) return "5x";
    if (streak >= 100) return "4x";
    if (streak >= 30) return "3x";
    if (streak >= 7) return "2x";
    return "1x";
  };

  if (isLoading) {
    return (
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-10 w-24 rounded-xl" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Compact version for dashboard widget
  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl p-3 transition-all",
          alreadyClaimed
            ? "bg-green-50 dark:bg-green-950/30"
            : "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30"
        )}
      >
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl",
            alreadyClaimed
              ? "bg-green-100 dark:bg-green-900/50"
              : "bg-gradient-to-br from-amber-400 to-orange-500"
          )}
        >
          {alreadyClaimed ? (
            <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
          ) : (
            <Gift className="h-5 w-5 text-white" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {alreadyClaimed ? "Daily Reward Claimed" : "Claim Daily Reward"}
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Flame className="h-3 w-3 text-orange-500" />
            <span>{currentStreak} day streak</span>
            {currentStreak >= 7 && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                {getMultiplierText(currentStreak)} bonus
              </Badge>
            )}
          </div>
        </div>
        {!alreadyClaimed && (
          <Button
            size="sm"
            onClick={() => claimMutation.mutate()}
            disabled={claimMutation.isPending}
            className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md"
          >
            {claimMutation.isPending ? (
              <Sparkles className="h-4 w-4 animate-spin" />
            ) : (
              "+5"
            )}
          </Button>
        )}
      </div>
    );
  }

  // Full card version
  return (
    <Card
      className={cn(
        "relative overflow-hidden border-0 shadow-xl transition-all duration-500",
        showCelebration
          ? "bg-gradient-to-br from-amber-100 via-orange-100 to-yellow-100 dark:from-amber-900/50 dark:via-orange-900/50 dark:to-yellow-900/50"
          : alreadyClaimed
          ? "bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30"
          : "bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-yellow-950/30"
      )}
    >
      {/* Background decoration */}
      <div className="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-gradient-to-br from-amber-200/30 to-orange-200/30 blur-3xl" />
      <div className="absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-gradient-to-br from-yellow-200/30 to-amber-200/30 blur-2xl" />

      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl shadow-lg",
              alreadyClaimed
                ? "bg-gradient-to-br from-green-400 to-emerald-500"
                : "bg-gradient-to-br from-amber-400 to-orange-500"
            )}
          >
            {alreadyClaimed ? (
              <Check className="h-5 w-5 text-white" />
            ) : (
              <Gift className="h-5 w-5 text-white" />
            )}
          </div>
          Daily Login Reward
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Celebration message */}
        {showCelebration && claimResult && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-4 text-center shadow-inner">
            <Sparkles className="mx-auto h-8 w-8 text-amber-500 animate-pulse" />
            <p className="mt-2 text-2xl font-bold text-amber-600">
              +{claimResult.pointsAwarded} Points!
            </p>
            {claimResult.multiplier > 1 && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {claimResult.multiplier}x streak bonus applied
              </p>
            )}
            {claimResult.newBadgeEarned && (
              <div className="mt-2 flex items-center justify-center gap-2 text-purple-600">
                <Trophy className="h-4 w-4" />
                <span className="font-medium">
                  New Badge: {claimResult.newBadgeEarned.name}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Streak display */}
        <div className="flex items-center justify-between rounded-xl bg-white/60 dark:bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-red-500 shadow-lg">
              <Flame className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {currentStreak}
              </p>
              <p className="text-sm text-slate-500">Day Streak</p>
            </div>
          </div>

          <div className="text-right">
            <Badge
              variant="secondary"
              className={cn(
                "text-sm font-semibold",
                currentStreak >= 7
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                  : ""
              )}
            >
              {getMultiplierText(currentStreak)} Multiplier
            </Badge>
            {nextMilestone && (
              <p className="mt-1 text-xs text-slate-500">
                {nextMilestone.days - currentStreak} days to{" "}
                {nextMilestone.multiplier}x
              </p>
            )}
          </div>
        </div>

        {/* Milestones */}
        <div className="flex justify-between rounded-xl bg-white/40 dark:bg-slate-900/30 p-3">
          {[7, 30, 100, 365].map((days) => (
            <div
              key={days}
              className={cn(
                "flex flex-col items-center gap-1 transition-opacity",
                currentStreak >= days ? "opacity-100" : "opacity-40"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg",
                  currentStreak >= days
                    ? "bg-gradient-to-br from-amber-400 to-orange-500"
                    : "bg-slate-200 dark:bg-slate-700"
                )}
              >
                {MILESTONE_ICONS[days]}
              </div>
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                {days}d
              </span>
            </div>
          ))}
        </div>

        {/* Claim button */}
        {!alreadyClaimed ? (
          <Button
            onClick={() => claimMutation.mutate()}
            disabled={claimMutation.isPending}
            className="w-full h-12 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-600 hover:via-orange-600 hover:to-amber-600 text-white font-semibold text-lg shadow-xl shadow-amber-500/25 transition-all hover:shadow-2xl hover:shadow-amber-500/30"
          >
            {claimMutation.isPending ? (
              <Sparkles className="h-5 w-5 animate-spin mr-2" />
            ) : (
              <Gift className="h-5 w-5 mr-2" />
            )}
            {claimMutation.isPending ? "Claiming..." : "Claim Daily Reward"}
          </Button>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-green-100 dark:bg-green-900/30 p-3 text-green-700 dark:text-green-300">
            <Check className="h-5 w-5" />
            <span className="font-medium">Today's reward claimed!</span>
          </div>
        )}

        {/* Stats footer */}
        <div className="flex justify-between text-xs text-slate-500 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>Best: {status?.longestStreak ?? 0} days</span>
          </div>
          <div className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            <span>Base: 5 pts/day</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default DailyRewardClaim;
