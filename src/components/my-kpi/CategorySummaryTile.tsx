import { type LucideIcon } from "lucide-react";

type Rag = "green" | "amber" | "red";

const RAG_BORDER: Record<Rag, string> = {
  green: "border-l-emerald-500 shadow-[0_0_20px_-8px_rgba(16,185,129,0.3)]",
  amber: "border-l-amber-500  shadow-[0_0_20px_-8px_rgba(245,158,11,0.3)]",
  red:   "border-l-rose-500   shadow-[0_0_20px_-8px_rgba(244,63,94,0.3)]",
};

const RAG_ICON_BG: Record<Rag, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  amber: "bg-amber-500/10  text-amber-400  border border-amber-500/20",
  red:   "bg-rose-500/10   text-rose-400   border border-rose-500/20",
};

const RAG_SCORE: Record<Rag, string> = {
  green: "text-emerald-300",
  amber: "text-amber-300",
  red:   "text-rose-300",
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
};

export function CategorySummaryTile({ label, avgScore, metricsCount, icon: Icon }: Props) {
  const rag = scoreToRag(avgScore);

  return (
    <div
      className={`bg-slate-900/60 backdrop-blur-md rounded-xl p-4 border border-slate-800/80 border-l-[3px] transition-all hover:-translate-y-0.5 hover:bg-slate-800/70 duration-200 ${RAG_BORDER[rag]}`}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`p-2 rounded-lg ${RAG_ICON_BG[rag]}`}>
          <Icon size={16} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </span>
      </div>
      <div className="flex items-end gap-1">
        <span className={`text-3xl font-extrabold font-mono ${RAG_SCORE[rag]}`}>
          {avgScore > 0 ? Math.round(avgScore) : "—"}
        </span>
        {avgScore > 0 && (
          <span className="text-slate-500 text-sm mb-1">/100</span>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">{metricsCount} metric{metricsCount !== 1 ? "s" : ""} tracked</p>
    </div>
  );
}
