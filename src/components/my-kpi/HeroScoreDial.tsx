const RATING_STYLE: Record<string, string> = {
  S: "bg-emerald-50 border-emerald-200 text-emerald-700",
  A: "bg-blue-50 border-blue-200 text-blue-700",
  B: "bg-amber-50 border-amber-200 text-amber-700",
  C: "bg-orange-50 border-orange-200 text-orange-700",
  D: "bg-rose-50 border-rose-200 text-rose-700",
};

type Props = {
  score: number;
  rating: string | null;
  ratingColor: string | null;
  size?: number;
};

export function HeroScoreDial({ score, rating, size = 176 }: Props) {
  const SIZE = size;
  const R = Math.round(SIZE * 0.41);
  const CIRCUMFERENCE = 2 * Math.PI * R;
  const strokeW = Math.round(SIZE * 0.08);
  const clampedScore = Math.min(Math.max(score, 0), 100);
  const dashOffset = CIRCUMFERENCE - (clampedScore / 100) * CIRCUMFERENCE;

  const strokeColor =
    clampedScore >= 90 ? "#16a34a"
    : clampedScore >= 70 ? "#d97706"
    : "#e11d48";

  return (
    <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Background track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={strokeW}
        />
        {/* Progress arc */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeW}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{
            transform: `rotate(-90deg)`,
            transformOrigin: `${SIZE / 2}px ${SIZE / 2}px`,
            transition: "stroke-dashoffset 0.7s ease",
          }}
        />
        {/* Score value */}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 4}
          textAnchor="middle"
          fontSize={Math.round(SIZE * 0.19)}
          fontWeight="800"
          fill="#0f172a"
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          {Math.round(clampedScore)}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + Math.round(SIZE * 0.1)}
          textAnchor="middle"
          fontSize={Math.round(SIZE * 0.057)}
          fontWeight="700"
          fill="#64748b"
          letterSpacing="2"
        >
          / 100
        </text>
      </svg>

      {rating && (
        <div
          className={`absolute -bottom-2 left-1/2 -translate-x-1/2 text-sm font-extrabold px-4 py-0.5 rounded-full border whitespace-nowrap ${
            RATING_STYLE[rating] ?? "bg-slate-100 border-slate-200 text-slate-600"
          }`}
        >
          {rating}
        </div>
      )}
    </div>
  );
}
