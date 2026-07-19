import { Award, Zap, Clock, TrendingUp, TrendingDown, Target } from "lucide-react";

const RAG_BORDER_SHADOW = {
  green: "border-l-green-500 shadow-green-950/20 shadow-lg border border-slate-800/80 hover:border-green-500/30",
  amber: "border-l-amber-500 shadow-amber-950/20 shadow-lg border border-slate-800/80 hover:border-amber-500/30",
  red: "border-l-red-500 shadow-red-950/20 shadow-lg border border-slate-800/80 hover:border-red-500/30"
};

const RAG_TEXT = {
  green: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  red: "text-rose-400 bg-rose-500/10 border-rose-500/20"
};

const RAG_ICON_BG = {
  green: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  red: "bg-rose-500/10 text-rose-400 border border-rose-500/20"
};

function MetricIcon({ code }: { code: string }) {
  const norm = code.toUpperCase();
  if (norm.includes("CSAT")) return <Award className="w-5 h-5" />;
  if (norm.includes("AHT")) return <Clock className="w-5 h-5" />;
  return <Zap className="w-5 h-5" />;
}

function Sparkline({ points, rag, metricId }: { points: Array<{ value: number }>; rag: string; metricId: string }) {
  if (!points || points.length < 2) return <div className="h-8 w-24 bg-slate-800 rounded opacity-25" />;
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;

  const w = 110, h = 40;
  const padding = 2;
  const pointsString = vals
    .map((v, i) => {
      const px = padding + (i / (vals.length - 1)) * (w - padding * 2);
      const py = padding + (h - padding * 2) - ((v - min) / range) * (h - padding * 2);
      return `${px},${py}`;
    })
    .join(" ");

  const fillPointsString = `${padding},${h} ` + pointsString + ` ${w - padding},${h}`;

  const strokeColor = rag === "green" ? "#10b981" : rag === "amber" ? "#f59e0b" : "#f43f5e";
  // Stable ID derived from metricId — avoids Math.random() breaking React reconciliation
  const gradientId = `spark-grad-${metricId.replace(/[^a-z0-9]/gi, "_")}`;

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      
      {/* Area Fill */}
      <polygon points={fillPointsString} fill={`url(#${gradientId})`} />

      {/* Trajectory line */}
      <polyline points={pointsString} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Endpoint dot */}
      {vals.length > 0 && (
        <circle
          cx={padding + (vals.length - 1) / (vals.length - 1) * (w - padding * 2)}
          cy={padding + (h - padding * 2) - ((vals[vals.length - 1] - min) / range) * (h - padding * 2)}
          r="3"
          fill={strokeColor}
          className="animate-pulse"
        />
      )}
    </svg>
  );
}

export function KpiScorecardGrid({ scorecards }: { scorecards: any[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {scorecards.map(m => {
        const hasHistory = m.sparkline && m.sparkline.length > 1;
        const trend = hasHistory ? m.sparkline[m.sparkline.length - 1].value >= m.sparkline[m.sparkline.length - 2].value : true;

        return (
          <div
            key={m.metric_id}
            className={`bg-slate-900/60 backdrop-blur-md rounded-xl p-5 border-l-[6px] transition-all hover:-translate-y-1 hover:bg-slate-800/80 duration-300 ${
              RAG_BORDER_SHADOW[m.rag as keyof typeof RAG_BORDER_SHADOW]
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-lg ${RAG_ICON_BG[m.rag as keyof typeof RAG_ICON_BG]}`}>
                  <MetricIcon code={m.metric_code} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{m.metric_code}</p>
                    {trend ? (
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-slate-100 mt-0.5 line-clamp-1">{m.metric_name}</h3>
                </div>
              </div>
              <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full border ${RAG_TEXT[m.rag as keyof typeof RAG_TEXT]}`}>
                {m.achievement_pct.toFixed(0)}% Target
              </span>
            </div>

            <div className="mt-6 flex items-end justify-between">
              <div>
                <p className="text-3xl font-extrabold text-white tracking-tight">
                  {m.actual != null ? m.actual : "—"}
                  <span className="text-sm font-semibold text-slate-400 ml-0.5">
                    {m.unit === "percent" ? "%" : m.unit === "seconds" ? "s" : ""}
                  </span>
                </p>
                <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
                  <Target className="w-3 h-3 text-slate-600" />
                  <span>Target: {m.target}{m.unit === "percent" ? "%" : m.unit === "seconds" ? "s" : ""}</span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase mb-0.5">6M Trend</span>
                <Sparkline points={m.sparkline} rag={m.rag} metricId={String(m.metric_id ?? m.metric_code ?? "m")} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
