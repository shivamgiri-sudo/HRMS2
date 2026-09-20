import { type LucideIcon } from "lucide-react";

type Rag = "green" | "amber" | "red";

// HRMS tone system — category-specific gradient backgrounds
const CATEGORY_GRADIENT: Record<string, { card: string; icon: string; score: string; bar: string }> = {
  operations: { card: "from-blue-50 to-indigo-50 border-blue-200",   icon: "bg-blue-100 text-blue-600",    score: "text-blue-800",    bar: "bg-blue-500" },
  quality:    { card: "from-purple-50 to-violet-50 border-purple-200", icon: "bg-purple-100 text-purple-600", score: "text-purple-800",  bar: "bg-purple-500" },
  hr:         { card: "from-pink-50 to-rose-50 border-pink-200",      icon: "bg-pink-100 text-pink-600",    score: "text-pink-800",    bar: "bg-pink-500" },
  sales:      { card: "from-emerald-50 to-green-50 border-emerald-200", icon: "bg-emerald-100 text-emerald-600", score: "text-emerald-800", bar: "bg-emerald-500" },
  custom:     { card: "from-amber-50 to-orange-50 border-amber-200",  icon: "bg-amber-100 text-amber-600",  score: "text-amber-800",   bar: "bg-amber-500" },
};

const RAG_RING: Record<Rag, string> = {
  green: "ring-2 ring-emerald-200",
  amber: "ring-2 ring-amber-200",
  red:   "ring-2 ring-rose-200",
};

function scoreToRag(score: number): Rag {
  if (score >= 90) return "green";
  if (score >= 70) return "amber";
  return "red";
}

function ragText(rag: Rag): string {
  if (rag === "green") return "text-emerald-700";
  if (rag === "amber") return "text-amber-700";
  return "text-rose-700";
}

type Props = {
  category: string;
  label: string;
  avgScore: number;
  metricsCount: number;
  icon: LucideIcon;
  onClick?: () => void;
};

export function CategorySummaryTile({ category, label, avgScore, metricsCount, icon: Icon, onClick }: Props) {
  const rag = scoreToRag(avgScore);
  const theme = CATEGORY_GRADIENT[category.toLowerCase()] ?? CATEGORY_GRADIENT.custom;

  return (
    <div
      className={`bg-gradient-to-br ${theme.card} rounded-xl p-4 border shadow-[0_1px_3px_rgba(37,99,235,0.08),_0_4px_12px_rgba(37,99,235,0.06)] transition-all hover:shadow-[0_4px_16px_rgba(37,99,235,0.12),_0_2px_6px_rgba(37,99,235,0.08)] hover:-translate-y-0.5 duration-200 ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${theme.icon}`}>
          <Icon size={16} />
        </div>
        {avgScore > 0 && (
          <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ${
            rag === "green" ? "bg-emerald-100 text-emerald-700" : rag === "amber" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
          }`}>
            {rag === "green" ? "On Track" : rag === "amber" ? "Review" : "At Risk"}
          </span>
        )}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">
        {label}
      </span>
      <div className="flex items-end gap-1 mb-2">
        <span className={`text-3xl font-extrabold font-mono ${theme.score}`}>
          {avgScore > 0 ? Math.round(avgScore) : "—"}
        </span>
        {avgScore > 0 && (
          <span className="text-slate-400 text-sm mb-1">/100</span>
        )}
      </div>
      {/* Score bar */}
      {avgScore > 0 && (
        <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${theme.bar}`}
            style={{ width: `${Math.min(avgScore, 100)}%` }}
          />
        </div>
      )}
      <p className="text-[10px] text-slate-400 mt-1.5">{metricsCount} metric{metricsCount !== 1 ? "s" : ""} tracked</p>
    </div>
  );
}
