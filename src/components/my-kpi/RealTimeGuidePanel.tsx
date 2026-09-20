import { useQuery } from "@tanstack/react-query";
import {
  Zap, Headphones, HelpCircle, BookOpen, PhoneCall,
  Activity, CheckCircle2, AlertTriangle, Info,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface WeaknessCategory {
  category: string;
  score: number;
  peer_avg: number;
  gap: number;
}

interface LiveNumbers {
  cq_score_current?: number | null;
  calls_today?: number | null;
}

const COACHING_TIPS: Record<string, { tip: string; action: string }> = {
  opening: {
    tip: "Open calls with the customer's name and a clear greeting within the first 5 seconds.",
    action: "Practice opening scripts in your LMS module.",
  },
  soft_skills: {
    tip: "Use empathy acknowledgement after every complaint. Avoid interrupting the customer mid-sentence.",
    action: "Review the Empathy & Listening module.",
  },
  hold_procedure: {
    tip: "Always ask permission before placing on hold. Limit hold to 2 minutes max or offer a callback.",
    action: "Check the Hold Procedure quick-guide on LMS.",
  },
  resolution: {
    tip: "Confirm the customer's issue is fully resolved before moving to closure. Offer a reference number.",
    action: "Use the Resolution Checklist in your team handbook.",
  },
  closing: {
    tip: "Confirm satisfaction, offer further help, and close warmly — never hang up abruptly.",
    action: "Practice closing phrases from the call scripts library.",
  },
};

type Props = {
  refetchInterval?: number;
};

export function RealTimeGuidePanel({ refetchInterval = 30_000 }: Props) {
  const { data: weaknesses } = useQuery<WeaknessCategory[]>({
    queryKey: ["weakness-detail"],
    queryFn: () => hrmsApi.get("/api/agent/weakness-detail").then((r) => r.data?.data ?? r.data ?? []),
    staleTime: 60_000,
  });

  const { data: liveScore, dataUpdatedAt } = useQuery<LiveNumbers>({
    queryKey: ["live-cq-score"],
    queryFn: () => hrmsApi.get("/api/agent/cq-score?daysBack=1").then((r) => r.data?.data ?? r.data),
    refetchInterval,
    staleTime: refetchInterval * 0.8,
  });

  const topWeaknesses = (weaknesses ?? [])
    .filter((w) => w.gap < -5)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3);

  const lastRefresh = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <div className="space-y-5">

      {/* Live Monitoring */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-blue-600" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Live Monitoring</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-slate-400">Updated {lastRefresh}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            {
              label: "Call Quality",
              value: liveScore?.cq_score_current != null
                ? `${Math.round(liveScore.cq_score_current * 10) / 10}%`
                : "—",
              icon: PhoneCall,
              color: (() => {
                const s = liveScore?.cq_score_current ?? 0;
                return s >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                  : s >= 65 ? "bg-amber-50 text-amber-700 border-amber-100"
                  : "bg-rose-50 text-rose-700 border-rose-100";
              })(),
            },
            {
              label: "Refresh",
              value: `${Math.round(refetchInterval / 1000)}s`,
              icon: Zap,
              color: "bg-blue-50 text-blue-700 border-blue-100",
            },
            {
              label: "Status",
              value: liveScore?.cq_score_current != null && liveScore.cq_score_current >= 80
                ? "On Track"
                : "Review",
              icon: liveScore?.cq_score_current != null && liveScore.cq_score_current >= 80
                ? CheckCircle2 : AlertTriangle,
              color: liveScore?.cq_score_current != null && liveScore.cq_score_current >= 80
                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                : "bg-amber-50 text-amber-700 border-amber-100",
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className={`rounded-xl border p-3 ${color}`}>
              <Icon size={15} className="mb-1.5 opacity-80" />
              <p className="text-[9px] font-bold uppercase tracking-wide opacity-70">{label}</p>
              <p className="text-lg font-extrabold font-mono">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Real-time Guide — Coaching Tips */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Info size={15} className="text-amber-500" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Real-time Guide</p>
          <span className="text-[10px] text-slate-400 ml-auto">Based on your call quality data</span>
        </div>

        {topWeaknesses.length === 0 ? (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
            <p className="text-sm text-emerald-700 font-medium">
              No critical gaps detected — you're performing well across all areas!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {topWeaknesses.map((w, i) => {
              const key = w.category.toLowerCase().replace(/[\s]+/g, "_");
              const coaching = COACHING_TIPS[key] ?? COACHING_TIPS[Object.keys(COACHING_TIPS).find(k => w.category.toLowerCase().includes(k)) ?? ""];
              return (
                <div key={w.category} className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-extrabold flex-shrink-0">{i + 1}</span>
                    <p className="text-sm font-bold text-slate-900 capitalize">{w.category.replace(/_/g, " ")}</p>
                    <span className="text-[10px] text-rose-600 font-semibold ml-auto">{Math.round(w.gap)}pp gap</span>
                  </div>
                  {coaching && (
                    <>
                      <p className="text-xs text-slate-700 leading-relaxed">{coaching.tip}</p>
                      <p className="text-[11px] text-blue-600 font-semibold mt-1.5">→ {coaching.action}</p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Support & Resources */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Headphones size={15} className="text-violet-600" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Support & Resources</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: BookOpen, label: "LMS Library", desc: "Browse training content", href: "/lms", color: "text-blue-600 bg-blue-50 border-blue-100 hover:border-blue-300" },
            { icon: Headphones, label: "Raise Helpdesk", desc: "Get technical support", href: "/helpdesk", color: "text-violet-600 bg-violet-50 border-violet-100 hover:border-violet-300" },
            { icon: HelpCircle, label: "FAQ & Guides", desc: "Quick reference sheets", href: "/lms", color: "text-amber-600 bg-amber-50 border-amber-100 hover:border-amber-300" },
            { icon: PhoneCall, label: "Schedule Coaching", desc: "Book a 1:1 session", href: "/helpdesk", color: "text-emerald-600 bg-emerald-50 border-emerald-100 hover:border-emerald-300" },
          ].map(({ icon: Icon, label, desc, href, color }) => (
            <a
              key={label}
              href={href}
              className={`rounded-xl border p-3 transition-all hover:shadow-sm ${color}`}
            >
              <Icon size={16} className="mb-2" />
              <p className="text-sm font-bold text-slate-900">{label}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>
            </a>
          ))}
        </div>
      </div>

    </div>
  );
}
