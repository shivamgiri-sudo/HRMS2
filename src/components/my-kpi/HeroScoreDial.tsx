const RATING_DARK_STYLE: Record<string, string> = {
  S: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
  A: "bg-blue-500/20 border-blue-500/40 text-blue-300",
  B: "bg-amber-500/20 border-amber-500/40 text-amber-300",
  C: "bg-orange-500/20 border-orange-500/40 text-orange-300",
  D: "bg-rose-500/20 border-rose-500/40 text-rose-300",
};

type Props = {
  score: number;
  rating: string | null;
  ratingColor: string | null;
};

export function HeroScoreDial({ score, rating }: Props) {
  const SIZE = 176;
  const R = 72;
  const CIRCUMFERENCE = 2 * Math.PI * R;
  const clampedScore = Math.min(Math.max(score, 0), 100);
  const dashOffset = CIRCUMFERENCE - (clampedScore / 100) * CIRCUMFERENCE;

  const strokeColor =
    clampedScore >= 90 ? "#34d399"
    : clampedScore >= 70 ? "#fbbf24"
    : "#fb7185";

  return (
    <div className="relative flex-shrink-0 w-44 h-44">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Background track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="#0f172a"
          strokeWidth="18"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="#1e293b"
          strokeWidth="14"
        />
        {/* Progress arc */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={strokeColor}
          strokeWidth="14"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{
            transform: `rotate(-90deg)`,
            transformOrigin: `${SIZE / 2}px ${SIZE / 2}px`,
            filter: `drop-shadow(0 0 10px ${strokeColor}88)`,
            transition: "stroke-dashoffset 0.7s ease",
          }}
        />
        {/* Score value */}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 4}
          textAnchor="middle"
          fontSize="34"
          fontWeight="800"
          fill="#f8fafc"
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          {Math.round(clampedScore)}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 16}
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fill="#475569"
          letterSpacing="2"
        >
          / 100
        </text>
      </svg>

      {rating && (
        <div
          className={`absolute -bottom-2 left-1/2 -translate-x-1/2 text-lg font-extrabold px-4 py-0.5 rounded-full border whitespace-nowrap ${
            RATING_DARK_STYLE[rating] ?? "bg-slate-700/60 border-slate-600 text-slate-300"
          }`}
        >
          {rating}
        </div>
      )}
    </div>
  );
}
