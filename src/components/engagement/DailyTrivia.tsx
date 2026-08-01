import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain,
  Check,
  X,
  Trophy,
  Timer,
  Users,
  Sparkles,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TriviaCategory = "company" | "process" | "industry" | "general" | "fun";

interface TriviaQuestion {
  id: string;
  question_date: string;
  question_text: string;
  category: TriviaCategory;
  option_a: string;
  option_b: string;
  option_c: string | null;
  option_d: string | null;
  correct_option?: string;
  explanation: string | null;
  points_correct: number;
  points_participate: number;
}

interface TriviaResponse {
  selected_option: string;
  is_correct: boolean;
  points_awarded: number;
  answered_at: string;
}

interface TodayTriviaResult {
  question: TriviaQuestion;
  myResponse: TriviaResponse | null;
  participantCount: number;
  correctCount: number;
}

interface AnswerResult {
  correct: boolean;
  correctOption: string;
  explanation: string | null;
  pointsAwarded: number;
  rank: number | null;
}

const CATEGORY_COLORS: Record<TriviaCategory, string> = {
  company: "from-indigo-500 to-blue-600",
  process: "from-purple-500 to-violet-600",
  industry: "from-amber-500 to-orange-600",
  general: "from-slate-500 to-slate-600",
  fun: "from-pink-500 to-rose-600",
};

const CATEGORY_LABELS: Record<TriviaCategory, string> = {
  company: "Company",
  process: "Process",
  industry: "Industry",
  general: "General",
  fun: "Fun",
};

const OPTION_KEYS = ["A", "B", "C", "D"] as const;
const OPTION_LABELS: Record<string, string> = { A: "option_a", B: "option_b", C: "option_c", D: "option_d" };

export function DailyTrivia({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number>(Date.now());
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<TodayTriviaResult | null>({
    queryKey: ["daily-trivia-today"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: TodayTriviaResult | null }>("/engagement/trivia/today");
      return res.data;
    },
    staleTime: 60_000,
  });

  // Start timer when question loaded and not yet answered
  useEffect(() => {
    if (!data?.question || data.myResponse) return;
    startedAt.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [data?.question?.id, data?.myResponse]);

  const submitMutation = useMutation({
    mutationFn: async (option: string) => {
      if (timerRef.current) clearInterval(timerRef.current);
      const timeTaken = Math.floor((Date.now() - startedAt.current) / 1000);
      const res = await hrmsApi.post<{ data: AnswerResult }>("/engagement/trivia/answer", {
        questionId: data!.question.id,
        selectedOption: option,
        timeTakenSeconds: timeTaken,
      });
      return res.data;
    },
    onSuccess: (result) => {
      setAnswerResult(result);
      queryClient.invalidateQueries({ queryKey: ["daily-trivia-today"] });
      queryClient.invalidateQueries({ queryKey: ["engagement-me"] });
      queryClient.invalidateQueries({ queryKey: ["gamification-points"] });
    },
  });

  const handleSelect = (option: string) => {
    if (submitMutation.isPending || answerResult || data?.myResponse) return;
    setSelected(option);
    submitMutation.mutate(option);
  };

  if (isLoading) {
    return (
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-violet-50 to-indigo-50 shadow-lg">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 rounded-xl" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data?.question) {
    return (
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-slate-50 to-slate-100 shadow-lg">
        <CardContent className="p-4 flex items-center gap-3 text-slate-500">
          <Brain className="h-5 w-5" />
          <span className="text-sm">No trivia question today. Check back tomorrow!</span>
        </CardContent>
      </Card>
    );
  }

  const { question, myResponse, participantCount } = data;
  const result = answerResult || (myResponse ? {
    correct: myResponse.is_correct,
    correctOption: question.correct_option ?? "",
    explanation: question.explanation,
    pointsAwarded: myResponse.points_awarded,
    rank: null,
  } : null);
  const alreadyAnswered = !!myResponse || !!answerResult;
  const selectedOpt = selected || myResponse?.selected_option || null;
  const categoryColor = CATEGORY_COLORS[question.category] || CATEGORY_COLORS.general;

  const getOptionText = (key: string) => {
    const field = OPTION_LABELS[key];
    return (question as any)[field] as string | null;
  };

  const getOptionState = (key: string) => {
    if (!alreadyAnswered) return "default";
    const correctKey = result?.correctOption?.toUpperCase();
    if (key === correctKey) return "correct";
    if (key === selectedOpt && key !== correctKey) return "wrong";
    return "default";
  };

  // Compact variant
  if (compact) {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl p-3 transition-all",
          alreadyAnswered
            ? result?.correct
              ? "bg-green-50"
              : "bg-red-50"
            : "bg-gradient-to-r from-violet-50 to-indigo-50 cursor-pointer hover:shadow-md"
        )}
        onClick={() => !alreadyAnswered && undefined}
      >
        <div className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0",
          alreadyAnswered
            ? result?.correct ? "bg-green-100" : "bg-red-100"
            : `bg-gradient-to-br ${categoryColor}`
        )}>
          {alreadyAnswered
            ? result?.correct
              ? <Check className="h-5 w-5 text-green-600" />
              : <X className="h-5 w-5 text-red-600" />
            : <Brain className="h-5 w-5 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-slate-900 truncate">Daily Trivia</p>
            {!alreadyAnswered && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700">
                +{question.points_correct} pts
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
            {alreadyAnswered
              ? result?.correct ? "Correct! Well done." : "Not quite — better luck tomorrow!"
              : question.question_text}
          </p>
        </div>
        {!alreadyAnswered && <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />}
      </div>
    );
  }

  return (
    <Card className="relative overflow-hidden border-0 shadow-xl">
      {/* Header gradient */}
      <div className={cn("h-2 w-full bg-gradient-to-r", categoryColor)} />

      <CardContent className="p-5 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl shadow-lg bg-gradient-to-br",
              categoryColor
            )}>
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-900">Daily Trivia</span>
                {!alreadyAnswered && (
                  <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">
                    +{question.points_correct} pts
                  </Badge>
                )}
              </div>
              <Badge variant="outline" className="text-xs mt-0.5 text-slate-500">
                {CATEGORY_LABELS[question.category]}
              </Badge>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            {!alreadyAnswered && (
              <div className="flex items-center gap-1 text-slate-500">
                <Timer className="h-3.5 w-3.5" />
                <span className="text-sm font-mono font-medium">{elapsed}s</span>
              </div>
            )}
            <div className="flex items-center gap-1 text-slate-400">
              <Users className="h-3.5 w-3.5" />
              <span className="text-xs">{participantCount} answered</span>
            </div>
          </div>
        </div>

        {/* Question */}
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="flex items-start gap-2">
            <HelpCircle className="h-4 w-4 text-violet-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-semibold text-slate-800 leading-relaxed">
              {question.question_text}
            </p>
          </div>
        </div>

        {/* Options */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OPTION_KEYS.map((key) => {
            const text = getOptionText(key);
            if (!text) return null;
            const state = alreadyAnswered ? getOptionState(key) : "default";
            const isSelected = selectedOpt === key;

            return (
              <button
                key={key}
                onClick={() => handleSelect(key)}
                disabled={alreadyAnswered || submitMutation.isPending}
                className={cn(
                  "flex items-center gap-3 rounded-xl p-3 text-left text-sm font-medium transition-all border-2",
                  state === "correct"
                    ? "border-green-400 bg-green-50 text-green-800"
                    : state === "wrong"
                    ? "border-red-400 bg-red-50 text-red-800"
                    : isSelected && submitMutation.isPending
                    ? "border-violet-400 bg-violet-50 text-violet-800"
                    : !alreadyAnswered
                    ? "border-slate-200 bg-white hover:border-violet-400 hover:bg-violet-50 hover:text-violet-800 cursor-pointer"
                    : "border-slate-200 bg-white text-slate-500"
                )}
              >
                <span className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                  state === "correct" ? "bg-green-200 text-green-700"
                    : state === "wrong" ? "bg-red-200 text-red-700"
                    : "bg-slate-100 text-slate-600"
                )}>
                  {state === "correct" ? <Check className="h-3.5 w-3.5" /> :
                   state === "wrong" ? <X className="h-3.5 w-3.5" /> : key}
                </span>
                {text}
              </button>
            );
          })}
        </div>

        {/* Result */}
        {alreadyAnswered && result && (
          <div className={cn(
            "rounded-xl p-4 space-y-2",
            result.correct
              ? "bg-green-50 border border-green-200"
              : "bg-red-50 border border-red-200"
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {result.correct
                  ? <Check className="h-5 w-5 text-green-600" />
                  : <X className="h-5 w-5 text-red-500" />}
                <span className={cn(
                  "font-bold",
                  result.correct ? "text-green-700" : "text-red-700"
                )}>
                  {result.correct ? "Correct!" : "Not quite!"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {result.pointsAwarded > 0 && (
                  <Badge className={cn(
                    "font-bold",
                    result.correct
                      ? "bg-green-100 text-green-700 hover:bg-green-100"
                      : "bg-orange-100 text-orange-700 hover:bg-orange-100"
                  )}>
                    <Sparkles className="h-3 w-3 mr-1" />
                    +{result.pointsAwarded} pts
                  </Badge>
                )}
                {result.rank && (
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                    <Trophy className="h-3 w-3 mr-1" />
                    #{result.rank}
                  </Badge>
                )}
              </div>
            </div>
            {result.explanation && (
              <p className="text-xs text-slate-600 leading-relaxed">{result.explanation}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default DailyTrivia;
