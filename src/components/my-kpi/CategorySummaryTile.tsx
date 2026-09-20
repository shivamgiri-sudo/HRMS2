import { type LucideIcon } from "lucide-react";

type Rag = "green" | "amber" | "red";

const RAG_BORDER: Record<Rag, string> = {
  green: "border-l-emerald-500",
  amber: "border-l-amber-500",
  red:   "border-l-rose-500",
};

const RAG_ICON_BG: Record<Rag, string> = {
  green: "bg-emerald-50 text-emerald-600 border border-emerald-100",
  amber: "bg-amber-50  text-amber-600  border border-amber-100",
  red:   "bg-rose-50   text-rose-600   border border-rose-100",
};

const RAG_SCORE: Record<Rag, string> = {
  green: "text-emerald-700",
  amber: "text-amber-700",
  red:   "text-rose-700",
};

function scoreToRag(score: number): Rag {
  if (score >= 90) return "green";
  if (score >= 70) return "amber";
  return "red";
}

type Props = {
  category: string;
  label: string;
  avgScore: number;
  metricsCount: number;
  icon: LucideIcon;
  onClick?: () => void;
};

export function CategorySummaryTile({ label, avgScore, metricsCount, icon: Icon, onClick }: Props) {
  const rag = scoreToRag(avgScore);

  return (
    <div
      className={`bg-white rounded-xl p-4 border border-slate-200 border-l-[3px] shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 ${RAG_BORDER[rag]} ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`p-2 rounded-lg ${RAG_ICON_BG[rag]}`}>
          <Icon size={16} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {label}
        </span>
      </div>
      <div className="flex items-end gap-1">
        <span className={`text-3xl font-extrabold font-mono ${RAG_SCORE[rag]}`}>
          {avgScore > 0 ? Math.round(avgScore) : "—"}
        </span>
        {avgScore > 0 && (
          <span className="text-slate-400 text-sm mb-1">/100</span>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-1">{metricsCount} metric{metricsCount !== 1 ? "s" : ""} tracked</p>
    </div>
  );
}
