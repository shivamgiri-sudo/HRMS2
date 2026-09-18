/**
 * Multi-segment RAG donut used on the Client Portal Executive Home to show the
 * distribution of processes (or metrics) across green/amber/red/no_data at a glance.
 *
 * Pure SVG, no chart library — mirrors the small stat-donut pattern already used in
 * AttritionTab's capacity ring inside PortalProcessDashboard.tsx, generalized to N segments.
 */

export interface RagDonutSegment {
  key: "green" | "amber" | "red" | "no_data";
  label: string;
  value: number;
  color: string; // stroke color
}

export function PortalRagDonut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: RagDonutSegment[];
  centerLabel: string;
  centerValue: string | number;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const r = 54;
  const circumference = 2 * Math.PI * r;
  let offsetAcc = 0;

  return (
    <div className="flex items-center gap-6">
      <div className="relative flex-shrink-0">
        <svg width={140} height={140} viewBox="0 0 140 140" className="-rotate-90">
          <circle cx={70} cy={70} r={r} fill="transparent" stroke="#1e293b" strokeWidth="14" />
          {total > 0 &&
            segments
              .filter((s) => s.value > 0)
              .map((seg) => {
                const frac = seg.value / total;
                const dash = frac * circumference;
                const gap = circumference - dash;
                const dashOffset = -offsetAcc;
                offsetAcc += dash;
                return (
                  <circle
                    key={seg.key}
                    cx={70}
                    cy={70}
                    r={r}
                    fill="transparent"
                    stroke={seg.color}
                    strokeWidth="14"
                    strokeDasharray={`${dash} ${gap}`}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="butt"
                    style={{ filter: `drop-shadow(0 0 6px ${seg.color}66)` }}
                  />
                );
              })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold text-white tabular-nums">{centerValue}</span>
          <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wide">{centerLabel}</span>
        </div>
      </div>

      <div className="space-y-2 min-w-0">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: seg.color, boxShadow: `0 0 6px ${seg.color}99` }}
            />
            <span className="text-slate-300 font-medium truncate">{seg.label}</span>
            <span className="text-slate-500 font-mono ml-auto pl-3">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
