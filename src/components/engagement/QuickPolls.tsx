import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart2, Check, Sparkles, Users, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

type PollType = "fun" | "feedback" | "decision";

interface PollResult {
  option: number;
  text: string;
  count: number;
  percent: number;
}

interface PollWithResults {
  id: string;
  question: string;
  poll_type: PollType;
  option_1: string;
  option_2: string;
  option_3: string | null;
  option_4: string | null;
  status: "pending" | "active" | "closed";
  total_votes: number;
  myVote: number | null;
  results: PollResult[];
}

const TYPE_CONFIG: Record<PollType, { label: string; color: string; bg: string }> = {
  fun:      { label: "Fun",      color: "text-pink-600",   bg: "bg-pink-50 border-pink-200" },
  feedback: { label: "Feedback", color: "text-blue-600",   bg: "bg-blue-50 border-blue-200" },
  decision: { label: "Decision", color: "text-violet-600", bg: "bg-violet-50 border-violet-200" },
};

const RESULT_COLORS = [
  "bg-indigo-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-amber-500",
];

function PollCard({ poll }: { poll: PollWithResults }) {
  const [localPoll, setLocalPoll] = useState(poll);
  const queryClient = useQueryClient();

  const voteMutation = useMutation({
    mutationFn: async (option: number) => {
      const res = await hrmsApi.post<{ data: { alreadyVoted: boolean; pointsAwarded: number; poll: PollWithResults } }>(
        `/engagement/polls/${localPoll.id}/vote`,
        { selectedOption: option }
      );
      return res.data;
    },
    onSuccess: (result) => {
      setLocalPoll(result.poll);
      queryClient.invalidateQueries({ queryKey: ["quick-polls"] });
      queryClient.invalidateQueries({ queryKey: ["engagement-me"] });
      queryClient.invalidateQueries({ queryKey: ["gamification-points"] });
    },
  });

  const voted = !!localPoll.myVote;
  const typeConfig = TYPE_CONFIG[localPoll.poll_type] || TYPE_CONFIG.fun;
  const options = [
    { option: 1, text: localPoll.option_1 },
    { option: 2, text: localPoll.option_2 },
    ...(localPoll.option_3 ? [{ option: 3, text: localPoll.option_3 }] : []),
    ...(localPoll.option_4 ? [{ option: 4, text: localPoll.option_4 }] : []),
  ];

  return (
    <div className={cn("rounded-2xl border p-4 space-y-3 transition-all", typeConfig.bg)}>
      {/* Question row */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 leading-snug flex-1">
          {localPoll.question}
        </p>
        <Badge variant="outline" className={cn("text-xs shrink-0", typeConfig.color)}>
          {typeConfig.label}
        </Badge>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {options.map(({ option, text }) => {
          const result = localPoll.results.find(r => r.option === option);
          const isMyVote = localPoll.myVote === option;
          const percent = result?.percent ?? 0;

          return voted ? (
            // Result bar
            <div key={option} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className={cn(
                  "text-xs font-medium flex items-center gap-1",
                  isMyVote ? "text-slate-900 font-bold" : "text-slate-600"
                )}>
                  {isMyVote && <Check className="h-3 w-3 text-green-600" />}
                  {text}
                </span>
                <span className={cn("text-xs font-bold", isMyVote ? "text-slate-900" : "text-slate-500")}>
                  {percent}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/60">
                <div
                  className={cn("h-full rounded-full transition-all duration-700", RESULT_COLORS[(option - 1) % RESULT_COLORS.length])}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          ) : (
            // Clickable option
            <button
              key={option}
              onClick={() => voteMutation.mutate(option)}
              disabled={voteMutation.isPending}
              className="w-full text-left rounded-xl bg-white/70 hover:bg-white border border-white/50 hover:border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 transition-all hover:shadow-sm active:scale-[0.99]"
            >
              {text}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1 text-slate-400">
          <Users className="h-3.5 w-3.5" />
          <span className="text-xs">{localPoll.total_votes} vote{localPoll.total_votes !== 1 ? "s" : ""}</span>
        </div>
        {voteMutation.data?.pointsAwarded ? (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs font-bold">
            <Sparkles className="h-3 w-3 mr-1" />+{voteMutation.data.pointsAwarded} pts
          </Badge>
        ) : voted && !localPoll.myVote ? null : voted ? (
          <span className="text-xs text-slate-400">Voted ✓</span>
        ) : (
          <span className="text-xs text-slate-400">+2 pts for voting</span>
        )}
      </div>
    </div>
  );
}

export function QuickPolls({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const { data: polls, isLoading, error } = useQuery<PollWithResults[]>({
    queryKey: ["quick-polls"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: PollWithResults[] }>("/engagement/polls");
      return res.data ?? [];
    },
    staleTime: 30_000,
  });

  if (isLoading) return (
    <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-pink-50 to-violet-50">
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </CardContent>
    </Card>
  );

  if (error || !polls) return null;

  if (polls.length === 0) return (
    <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-slate-50 to-slate-100">
      <CardContent className="p-4 flex items-center gap-3 text-slate-500">
        <BarChart2 className="h-5 w-5" />
        <span className="text-sm">No active polls right now. Check back soon!</span>
      </CardContent>
    </Card>
  );

  const unvoted = polls.filter(p => !p.myVote).length;
  const visiblePolls = expanded ? polls : polls.slice(0, compact ? 1 : 2);

  return (
    <Card className="relative overflow-hidden border-0 shadow-xl bg-white">
      <div className="h-2 w-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-600" />

      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-violet-600 shadow-lg">
              <BarChart2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                Quick Polls
                {unvoted > 0 && (
                  <Badge className="bg-pink-100 text-pink-700 hover:bg-pink-100 text-xs font-bold">
                    {unvoted} new
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">Vote &amp; see live results</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-slate-400 text-xs">
            <Users className="h-3.5 w-3.5" />
            {polls.length} active
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-4 space-y-3">
        {visiblePolls.map(poll => (
          <PollCard key={poll.id} poll={poll} />
        ))}

        {polls.length > (compact ? 1 : 2) && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors"
          >
            {expanded ? (
              <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
            ) : (
              <><ChevronDown className="h-3.5 w-3.5" /> {polls.length - (compact ? 1 : 2)} more poll{polls.length - (compact ? 1 : 2) > 1 ? "s" : ""}</>
            )}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

export default QuickPolls;
