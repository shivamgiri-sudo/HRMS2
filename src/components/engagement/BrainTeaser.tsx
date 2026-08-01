import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain,
  Check,
  X,
  Lightbulb,
  Timer,
  Users,
  Sparkles,
  ChevronRight,
  Eye,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TeaserCategory = "logic" | "math" | "pattern" | "riddle" | "lateral";
type TeaserDifficulty = "easy" | "medium" | "hard";

interface BrainTeaserPublic {
  id: string;
  teaser_date: string;
  category: TeaserCategory;
  question: string;
  answer?: string;
  hint_1?: string | null;
  hint_2?: string | null;
  explanation: string | null;
  difficulty: TeaserDifficulty;
  points_no_hint: number;
  points_one_hint: number;
  points_two_hints: number;
}

interface BrainTeaserAttempt {
  submitted_answer: string | null;
  is_correct: boolean;
  hints_used: number;
  time_taken_secs: number | null;
  points_awarded: number;
  attempted_at: string;
}

interface TodayTeaserResult {
  teaser: BrainTeaserPublic;
  myAttempt: BrainTeaserAttempt | null;
  participantCount: number;
  solvedCount: number;
}

interface SubmitResult {
  correct: boolean;
  answer: string;
  explanation: string | null;
  pointsAwarded: number;
  hintsUsed: number;
}

interface HintResult {
  hint: string | null;
  hintNumber: 1 | 2;
  hintsUsed: number;
  maxPointsNow: number;
}

const CATEGORY_CONFIG: Record<TeaserCategory, { label: string; color: string; gradient: string }> = {
  logic:   { label: "Logic",   color: "text-blue-600",   gradient: "from-blue-500 to-cyan-600" },
  math:    { label: "Math",    color: "text-purple-600", gradient: "from-purple-500 to-violet-600" },
  pattern: { label: "Pattern", color: "text-teal-600",   gradient: "from-teal-500 to-emerald-600" },
  riddle:  { label: "Riddle",  color: "text-amber-600",  gradient: "from-amber-500 to-orange-600" },
  lateral: { label: "Lateral", color: "text-pink-600",   gradient: "from-pink-500 to-rose-600" },
};

const DIFFICULTY_CONFIG: Record<TeaserDifficulty, { label: string; color: string }> = {
  easy:   { label: "Easy",   color: "bg-green-100 text-green-700" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-700" },
  hard:   { label: "Hard",   color: "bg-red-100 text-red-700" },
};

export function BrainTeaser({ compact = false }: { compact?: boolean }) {
  const [answer, setAnswer] = useState("");
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hints, setHints] = useState<(string | null)[]>([]);
  const [maxPoints, setMaxPoints] = useState<number | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<TodayTeaserResult | null>({
    queryKey: ["brain-teaser-today"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: TodayTeaserResult | null }>("/engagement/brain-teaser/today");
      return res.data;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!data?.teaser || data.myAttempt) return;
    startedAt.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    // Restore hints from server if any were persisted
    if (data.teaser.hint_1) { setHints([data.teaser.hint_1]); setHintsUsed(1); }
    if (data.teaser.hint_2) { setHints([data.teaser.hint_1 ?? null, data.teaser.hint_2]); setHintsUsed(2); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [data?.teaser?.id, data?.myAttempt]);

  const hintMutation = useMutation({
    mutationFn: async (hintNumber: 1 | 2) => {
      const res = await hrmsApi.post<{ data: HintResult }>("/engagement/brain-teaser/hint", {
        teaserId: data!.teaser.id,
        hintNumber,
      });
      return res.data;
    },
    onSuccess: (result) => {
      const newHints = [...hints];
      newHints[result.hintNumber - 1] = result.hint;
      setHints(newHints);
      setHintsUsed(result.hintsUsed);
      setMaxPoints(result.maxPointsNow);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (ans: string) => {
      if (timerRef.current) clearInterval(timerRef.current);
      const timeTaken = Math.floor((Date.now() - startedAt.current) / 1000);
      const res = await hrmsApi.post<{ data: SubmitResult }>("/engagement/brain-teaser/answer", {
        teaserId: data!.teaser.id,
        submittedAnswer: ans,
        timeTakenSecs: timeTaken,
      });
      return res.data;
    },
    onSuccess: (result) => {
      setSubmitResult(result);
      queryClient.invalidateQueries({ queryKey: ["brain-teaser-today"] });
      queryClient.invalidateQueries({ queryKey: ["engagement-me"] });
      queryClient.invalidateQueries({ queryKey: ["gamification-points"] });
    },
  });

  const handleSubmit = () => {
    if (!answer.trim() || submitMutation.isPending) return;
    submitMutation.mutate(answer.trim());
  };

  if (isLoading) {
    return (
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-blue-50 to-cyan-50 shadow-lg">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data?.teaser) {
    return (
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-slate-50 to-slate-100 shadow-lg">
        <CardContent className="p-4 flex items-center gap-3 text-slate-500">
          <Brain className="h-5 w-5" />
          <span className="text-sm">No brain teaser today. Check back tomorrow!</span>
        </CardContent>
      </Card>
    );
  }

  const { teaser, myAttempt, participantCount, solvedCount } = data;
  const result = submitResult || (myAttempt ? {
    correct: myAttempt.is_correct,
    answer: teaser.answer ?? "",
    explanation: teaser.explanation,
    pointsAwarded: myAttempt.points_awarded,
    hintsUsed: myAttempt.hints_used,
  } : null);
  const alreadyDone = !!result;
  const catConfig = CATEGORY_CONFIG[teaser.category] || CATEGORY_CONFIG.logic;
  const diffConfig = DIFFICULTY_CONFIG[teaser.difficulty] || DIFFICULTY_CONFIG.medium;
  const currentMaxPts = maxPoints ?? (alreadyDone ? result!.pointsAwarded : (hintsUsed === 0 ? teaser.points_no_hint : hintsUsed === 1 ? teaser.points_one_hint : teaser.points_two_hints));

  // Compact variant
  if (compact) {
    return (
      <div className={cn(
        "flex items-start gap-3 rounded-2xl p-3 transition-all",
        alreadyDone
          ? result?.correct ? "bg-green-50" : "bg-red-50"
          : "bg-gradient-to-r from-blue-50 to-cyan-50"
      )}>
        <div className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 bg-gradient-to-br",
          alreadyDone
            ? result?.correct ? "from-green-400 to-emerald-500" : "from-red-400 to-rose-500"
            : catConfig.gradient
        )}>
          {alreadyDone
            ? result?.correct ? <Check className="h-5 w-5 text-white" /> : <X className="h-5 w-5 text-white" />
            : <Brain className="h-5 w-5 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-slate-900 truncate">Brain Teaser</p>
            {!alreadyDone && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700">
                +{teaser.points_no_hint} pts
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
            {alreadyDone
              ? result?.correct ? "Solved! Great thinking." : `Answer: ${result?.answer}`
              : teaser.question}
          </p>
        </div>
        {!alreadyDone && <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />}
      </div>
    );
  }

  return (
    <Card className="relative overflow-hidden border-0 shadow-xl bg-white">
      <div className={cn("h-2 w-full bg-gradient-to-r", catConfig.gradient)} />

      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl shadow-lg bg-gradient-to-br", catConfig.gradient)}>
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-slate-900">Brain Teaser</span>
                {!alreadyDone && (
                  <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 font-bold">
                    up to +{currentMaxPts} pts
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className={cn("text-xs", catConfig.color)}>
                  {catConfig.label}
                </Badge>
                <Badge className={cn("text-xs", diffConfig.color)}>
                  {diffConfig.label}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            {!alreadyDone && (
              <div className="flex items-center gap-1 text-slate-500">
                <Timer className="h-3.5 w-3.5" />
                <span className="text-sm font-mono font-medium">{elapsed}s</span>
              </div>
            )}
            <div className="flex items-center gap-1 text-slate-400">
              <Users className="h-3.5 w-3.5" />
              <span className="text-xs">{solvedCount}/{participantCount} solved</span>
            </div>
          </div>
        </div>

        {/* Question */}
        <div className={cn(
          "rounded-xl p-4 border",
          alreadyDone
            ? result?.correct
              ? "bg-green-50 border-green-200"
              : "bg-slate-50 border-slate-200"
            : "bg-gradient-to-br from-slate-50 to-blue-50/30 border-slate-200"
        )}>
          <p className="text-sm font-semibold text-slate-800 leading-relaxed">
            {teaser.question}
          </p>
        </div>

        {/* Hints */}
        {!alreadyDone && (
          <div className="space-y-2">
            {[1, 2].map((n) => {
              const hintText = hints[n - 1];
              const alreadyRevealed = hintsUsed >= n;
              const isNext = hintsUsed === n - 1;
              const hasHint = n === 1 ? !!teaser.hint_1 : !!teaser.hint_2;
              if (!hasHint && !alreadyRevealed) return null;

              return (
                <div key={n}>
                  {alreadyRevealed && hintText ? (
                    <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
                      <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-amber-700 mb-0.5">Hint {n}</p>
                        <p className="text-sm text-amber-800">{hintText}</p>
                      </div>
                    </div>
                  ) : isNext ? (
                    <button
                      onClick={() => hintMutation.mutate(n as 1 | 2)}
                      disabled={hintMutation.isPending}
                      className="w-full flex items-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-3 text-left hover:bg-amber-50 transition-colors"
                    >
                      <Eye className="h-4 w-4 text-amber-500" />
                      <span className="text-sm text-amber-600 font-medium">
                        Reveal Hint {n}
                      </span>
                      <span className="ml-auto text-xs text-amber-500">
                        {n === 1 ? `(reduces to ${teaser.points_one_hint} pts)` : `(reduces to ${teaser.points_two_hints} pts)`}
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 p-3 opacity-40">
                      <Lock className="h-4 w-4 text-slate-400" />
                      <span className="text-sm text-slate-400">Hint {n} — use hint {n - 1} first</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Answer input or result */}
        {!alreadyDone ? (
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Type your answer..."
              className="flex-1 rounded-xl border-slate-200 focus:border-blue-400"
              disabled={submitMutation.isPending}
            />
            <Button
              onClick={handleSubmit}
              disabled={!answer.trim() || submitMutation.isPending}
              className={cn(
                "rounded-xl px-5 font-bold bg-gradient-to-r text-white shadow-lg",
                catConfig.gradient,
                "hover:opacity-90"
              )}
            >
              {submitMutation.isPending ? (
                <Sparkles className="h-4 w-4 animate-spin" />
              ) : "Submit"}
            </Button>
          </div>
        ) : (
          <div className={cn(
            "rounded-xl p-4 space-y-2",
            result?.correct
              ? "bg-green-50 border border-green-200"
              : "bg-red-50 border border-red-200"
          )}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {result?.correct
                  ? <Check className="h-5 w-5 text-green-600" />
                  : <X className="h-5 w-5 text-red-500" />}
                <span className={cn("font-bold", result?.correct ? "text-green-700" : "text-red-700")}>
                  {result?.correct ? "Solved it!" : "Not quite!"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {(result?.pointsAwarded ?? 0) > 0 && (
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 font-bold">
                    <Sparkles className="h-3 w-3 mr-1" />
                    +{result!.pointsAwarded} pts
                  </Badge>
                )}
                {(result?.hintsUsed ?? 0) > 0 && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                    <Lightbulb className="h-3 w-3 mr-1" />
                    {result!.hintsUsed} hint{result!.hintsUsed > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>
            <p className="text-sm font-semibold text-slate-700">
              Answer: <span className="text-slate-900">{result?.answer}</span>
            </p>
            {result?.explanation && (
              <p className="text-xs text-slate-600 leading-relaxed">{result.explanation}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default BrainTeaser;
