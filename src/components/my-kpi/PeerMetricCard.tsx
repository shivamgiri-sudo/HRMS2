export interface KpiMetricResult {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  category: string;
  unit: string;
  direction: string;
  family: string;
  target_value: number;
  min_threshold: number | null;
  actual_value: number | null;
  score_pct: number;
  score_status: string;
  rating: string | null;
  rating_color: string | null;
  resolved_from: string;
  trend_data: Array<{ date: string; value: number; source: string }>;
  peer_avg: number | null;
  peer_count: number | null;
  percentile: number | null;
}

type Rag = "green" | "amber" | "red";

function scoreToRag(score: number): Rag {
  if (score >= 90) return "green";
  if (score >= 70) return "amber";
  return "red";
}

const RAG_BORDER: Record<Rag, string> = {
  green: "border-l-emerald-500",
  amber: "border-l-amber-500",
  red:   "border-l-rose-500",
};

const RAG_BAR: Record<Rag, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red:   "bg-rose-500",
};

const RATING_PILL: Record<string, string> = {
  S: "text-emerald-700 bg-emerald-50 border-emerald-200",
  A: "text-blue-700    bg-blue-50    border-blue-200",
  B: "text-amber-700   bg-amber-50   border-amber-200",
  C: "text-orange-700  bg-orange-50  border-orange-200",
  D: "text-rose-700    bg-rose-50    border-rose-200",
};

function formatValue(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "seconds") {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  if (unit === "percent") return `${Math.round(v * 10) / 10}%`;
  if (unit === "currency") return `₹${v.toLocaleString("en-IN")}`;
  return String(Math.round(v * 10) / 10);
}

function Sparkline({
  data,
  rag,
  metricId,
}: {
  data: Array<{ date: string; value: number; source: string }>;
  rag: Rag;
  metricId: string;
}) {
  if (!data || data.length < 2)
    return <div className="h-8 w-24 bg-slate-100 rounded opacity-50" />;

  const vals = data.map((d) => d.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 96;
  const h = 32;
  const pad = 2;

  const pts = vals
    .map((v, i) => {
      const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
      const y = pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const fillPts = `${pad},${h} ` + pts + ` ${w - pad},${h}`;

  const color =
    rag === "green" ? "#16a34a"
    : rag === "amber" ? "#d97706"
    : "#e11d48";

  const gradId = `spk-${metricId.replace(/[^a-z0-9]/gi, "_")}`;

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#${gradId})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={pad + (vals.length - 1) / (vals.length - 1) * (w - pad * 2)}
        cy={pad + (h - pad * 2) - ((vals[vals.length - 1] - min) / range) * (h - pad * 2)}
        r="3"
        fill={color}
        className="animate-pulse"
      />
    </svg>
  );
}

function ScoreRing({ score }: { score: number }) {
  const SIZE = 44;
  const R = 17;
  const CIRC = 2 * Math.PI * R;
  const rag = scoreToRag(score);
  const dashOffset = CIRC - (Math.min(score, 100) / 100) * CIRC;
  const color =
    rag === "green" ? "#16a34a" : rag === "amber" ? "#d97706" : "#e11d48";

  return (
    <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: `${SIZE / 2}px ${SIZE / 2}px`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[9px] font-bold font-mono text-slate-700">
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

type Props = { metric: KpiMetricResult; onClick?: () => void };

export function PeerMetricCard({ metric, onClick }: Props) {
  const hasData = metric.actual_value !== null;
  const rag = scoreToRag(hasData ? metric.score_pct : 0);
  const isLower = metric.direction === "lower_is_better";

  const peerScorePct =
    metric.peer_avg !== null && metric.target_value > 0
      ? isLower
        ? Math.min((metric.target_value / metric.peer_avg) * 100, 100)
        : Math.min((metric.peer_avg / metric.target_value) * 100, 100)
      : null;

  const percentile = metric.percentile;

  return (
    <div
      className={`bg-white rounded-xl p-4 border border-slate-200 border-l-[3px] shadow-sm flex flex-col gap-3 transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 ${
        hasData ? RAG_BORDER[rag] : "border-l-slate-300"
      } ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {metric.metric_code}
            {isLower ? " · lower is better" : ""}
          </p>
          <p className="text-sm font-bold text-slate-900 mt-0.5 truncate">
            {metric.metric_name}
          </p>
        </div>
        {metric.rating && (
          <span
            className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full border flex-shrink-0 ${
              RATING_PILL[metric.rating] ?? "text-slate-600 bg-slate-100 border-slate-200"
            }`}
          >
            {metric.rating}
          </span>
        )}
      </div>

      {/* Value + sparkline + ring */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">
          <div className="text-2xl font-extrabold font-mono text-slate-900 leading-tight">
            {formatValue(metric.actual_value, metric.unit)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Target: {formatValue(metric.target_value, metric.unit)}
          </div>
        </div>
        <Sparkline data={metric.trend_data} rag={rag} metricId={metric.metric_id} />
        {hasData && <ScoreRing score={metric.score_pct} />}
      </div>

      {/* Peer comparison bars */}
      {hasData && metric.peer_avg !== null && peerScorePct !== null && (
        <div className="space-y-1.5 pt-1 border-t border-slate-100">
          {[
            { label: "YOU", pct: Math.min(metric.score_pct, 100), isYou: true, raw: metric.actual_value },
            { label: "PEER", pct: peerScorePct, isYou: false, raw: metric.peer_avg },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <span className="text-[9px] font-bold tracking-widest text-slate-400 w-8 flex-shrink-0">
                {row.label}
              </span>
              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    row.isYou ? RAG_BAR[rag] : "bg-slate-300"
                  }`}
                  style={{ width: `${Math.min(row.pct, 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-600 w-12 text-right flex-shrink-0">
                {formatValue(row.raw, metric.unit)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Percentile badge */}
      {percentile !== null && (
        <div
          className={`text-center text-[10px] font-bold uppercase tracking-widest py-1 rounded-lg border ${
            percentile >= 75
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : percentile >= 50
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-slate-50 text-slate-500 border-slate-200"
          }`}
        >
          Ahead of {Math.round(percentile)}% of peers
        </div>
      )}

      {!hasData && (
        <div className="text-xs text-slate-400 text-center py-1">
          No data available for this period
        </div>
      )}
    </div>
  );
}
