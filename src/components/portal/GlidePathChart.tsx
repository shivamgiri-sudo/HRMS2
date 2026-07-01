import { Target, Calendar, BarChart2 } from "lucide-react";

export function GlidePathChart({ path }: { path: any }) {
  const points = path.points as Array<{ month: string; actual: number | null; committed: number | null; target: number }>;
  if (!points || points.length === 0) return null;

  const allVals = points.flatMap(p => [p.actual, p.committed, p.target].filter(v => v != null) as number[]);
  const minV = Math.min(...allVals), maxV = Math.max(...allVals);
  
  // Create beautiful margins for the chart
  const diff = maxV - minV || 1;
  const minVBound = Math.max(0, minV - diff * 0.15);
  const maxVBound = maxV + diff * 0.15;
  const range = maxVBound - minVBound || 1;

  const W = 600, H = 220, PAD_X = 50, PAD_Y = 35;
  const iW = W - PAD_X * 2, iH = H - PAD_Y * 2;

  const x = (i: number) => PAD_X + (i / (points.length - 1)) * iW;
  const y = (v: number) => PAD_Y + iH - ((v - minVBound) / range) * iH;

  const linePts = (getter: (p: typeof points[0]) => number | null) =>
    points.reduce<string[]>((acc, p, i) => {
      const v = getter(p);
      if (v != null) acc.push(`${x(i)},${y(v)}`);
      return acc;
    }, []).join(" ");

  const todayIdx = (() => {
    const today = new Date().toISOString().slice(0, 7);
    const i = points.findIndex(p => p.month >= today);
    return i === -1 ? points.length - 1 : i;
  })();

  // Horizontal Grid Lines
  const gridLines = [];
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const val = minVBound + (i / gridCount) * range;
    gridLines.push(val);
  }

  return (
    <div className="bg-slate-900/60 backdrop-blur-md rounded-xl p-5 border border-slate-800/80 shadow-xl relative overflow-hidden">
      <div className="absolute -top-px left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 border border-blue-500/20">
            <BarChart2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-100">{path.metric_name}</h4>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Improvement Trajectory</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {path.behind_commitment ? (
            <span className="text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider">
              ⚠️ Behind Commitment
            </span>
          ) : (
            <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider">
              ✨ On Track
            </span>
          )}
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible select-none">
          {/* Horizontal Gridlines */}
          {gridLines.map((val, idx) => (
            <g key={idx}>
              <line
                x1={PAD_X}
                y1={y(val)}
                x2={W - PAD_X}
                y2={y(val)}
                stroke="#334155"
                strokeWidth="0.5"
                strokeDasharray="4,4"
                className="opacity-40"
              />
              <text x={PAD_X - 10} y={y(val) + 3} textAnchor="end" fontSize="9" fill="#475569" className="font-mono">
                {val.toFixed(1)}{path.unit === "percent" ? "%" : ""}
              </text>
            </g>
          ))}

          {/* Today vertical marker line */}
          <g>
            <line x1={x(todayIdx)} y1={PAD_Y - 5} x2={x(todayIdx)} y2={H - PAD_Y + 5} stroke="#64748b" strokeDasharray="3,3" strokeWidth="1" className="opacity-70" />
            <text x={x(todayIdx)} y={PAD_Y - 10} textAnchor="middle" fontSize="8" fill="#94a3b8" className="font-bold uppercase tracking-wider">
              Current Month
            </text>
          </g>

          {/* Target Glide line */}
          <path d={`M ${linePts(p => p.target)}`} fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="4,4" className="opacity-80" />
          
          {/* Committed Glide line */}
          <path d={`M ${linePts(p => p.committed)}`} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6,3" className="opacity-80" />

          {/* Actual Glide line */}
          <path d={`M ${linePts(p => p.actual)}`} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-[0_2px_4px_rgba(59,130,246,0.3)]" />

          {/* Graphical circular points */}
          {points.map((p, i) => {
            const actY = p.actual != null ? y(p.actual) : null;
            const comY = p.committed != null ? y(p.committed) : null;
            const trgY = y(p.target);
            
            return (
              <g key={i}>
                {/* Target node */}
                <circle cx={x(i)} cy={trgY} r="3" fill="#10b981" />
                {/* Committed node */}
                {comY != null && <circle cx={x(i)} cy={comY} r="3" fill="#f59e0b" />}
                {/* Actual node */}
                {actY != null && (
                  <circle cx={x(i)} cy={actY} r="4.5" fill="#3b82f6" stroke="#0f172a" strokeWidth="1.5" />
                )}
              </g>
            );
          })}

          {/* X-axis months label text */}
          {points.map((p, i) => {
            const isToday = i === todayIdx;
            return (
              <text
                key={p.month}
                x={x(i)}
                y={H - 10}
                textAnchor="middle"
                fontSize="9"
                fontWeight={isToday ? "bold" : "normal"}
                fill={isToday ? "#f8fafc" : "#64748b"}
              >
                {new Date(p.month + "-02").toLocaleString("default", { month: "short", year: "2-digit" })}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Chart Interactive Legends */}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-3 pt-3 border-t border-slate-800/40 text-[11px]">
        <div className="flex gap-4">
          <span className="flex items-center gap-1.5 font-medium text-slate-300">
            <span className="w-3.5 h-0.5 bg-blue-500 inline-block rounded-full" />
            Actual Performance
          </span>
          <span className="flex items-center gap-1.5 font-medium text-slate-300">
            <span className="w-3.5 h-0.5 bg-amber-500 inline-block border-dashed rounded-full" style={{ borderStyle: "dashed" }} />
            Committed Glide Path
          </span>
          <span className="flex items-center gap-1.5 font-medium text-slate-300">
            <span className="w-3.5 h-0.5 bg-emerald-500 inline-block border-dotted rounded-full" style={{ borderStyle: "dotted" }} />
            SLA / Target
          </span>
        </div>

        <div className="flex items-center gap-1 text-slate-500">
          <Calendar className="w-3.5 h-3.5" />
          <span>Updates Monthly</span>
        </div>
      </div>
    </div>
  );
}
