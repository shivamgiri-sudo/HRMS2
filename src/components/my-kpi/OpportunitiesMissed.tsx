import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface WeaknessCategory {
  category: string;
  score: number;
  peer_avg: number;
  gap: number;
  sub_metrics?: Array<{ name: string; score: number; peer_avg: number }>;
}

const OPPORTUNITY_TIPS: Record<string, string> = {
  opening: "Greet callers by name within the first 5 seconds and confirm the customer's issue before proceeding.",
  soft_skills: "Use empathy statements and active listening cues. Avoid interrupting the customer.",
  hold_procedure: "Always ask permission before placing on hold. Limit hold time to under 2 minutes or offer a callback.",
  resolution: "Verify the resolution is complete before closing. Offer a reference number when applicable.",
  closing: "Confirm customer satisfaction, offer further assistance, and close with a warm sign-off.",
};

export function OpportunitiesMissed() {
  const { data: weaknesses, isLoading } = useQuery<WeaknessCategory[]>({
    queryKey: ["weakness-detail"],
    queryFn: () => hrmsApi.get("/api/agent/weakness-detail").then((r) => r.data?.data ?? r.data ?? []),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3 animate-pulse">
        <div className="h-4 w-48 bg-slate-100 rounded" />
        {[1, 2].map((i) => <div key={i} className="h-16 bg-slate-100 rounded-lg" />)}
      </div>
    );
  }

  const opportunities = (weaknesses ?? [])
    .filter((w) => w.gap < -5)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 4);

  if (!opportunities.length) {
    return (
      <div className="bg-emerald-50 rounded-xl border border-emerald-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={16} className="text-emerald-600" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Opportunities Missed</p>
        </div>
        <p className="text-sm text-emerald-700 font-medium">No significant gaps vs peers — keep it up!</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle size={16} className="text-amber-500" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Opportunities Missed</p>
        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          {opportunities.length} area{opportunities.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-3">
        {opportunities.map((opp) => {
          const key = opp.category.toLowerCase().replace(/\s+/g, "_");
          const tip = OPPORTUNITY_TIPS[key] ?? OPPORTUNITY_TIPS[Object.keys(OPPORTUNITY_TIPS).find(k => opp.category.toLowerCase().includes(k)) ?? ""] ?? "Review your coaching notes for this area.";
          const gapAbs = Math.abs(Math.round(opp.gap));
          return (
            <div key={opp.category} className="rounded-lg border border-rose-100 bg-rose-50 p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-900 capitalize">{opp.category.replace(/_/g, " ")}</p>
                  <p className="text-[10px] text-rose-600 font-semibold mt-0.5">
                    {Math.round(opp.score)}% vs peer avg {Math.round(opp.peer_avg)}% ({gapAbs}pp gap)
                  </p>
                </div>
                <div className="flex-shrink-0 bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  -{gapAbs}pp
                </div>
              </div>
              {/* Score bar */}
              <div className="space-y-1">
                {[
                  { label: "You", pct: opp.score, color: "bg-rose-400" },
                  { label: "Peer", pct: opp.peer_avg, color: "bg-slate-300" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-slate-400 w-6">{row.label}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${row.color}`} style={{ width: `${Math.min(row.pct, 100)}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 w-8 text-right">{Math.round(row.pct)}%</span>
                  </div>
                ))}
              </div>
              {tip && (
                <p className="text-[11px] text-slate-600 mt-2 pt-2 border-t border-rose-100">
                  <span className="font-semibold text-slate-700">Tip: </span>{tip}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
