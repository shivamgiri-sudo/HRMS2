import type { BranchHeadHealthPayload, BranchOverview } from "../../../../../backend/src/modules/branch-head-health/types";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";
import { BarList, ChartFrame, ScoreRing, Sparkline, barListTable, type BarItem, type BarListProps, type TableSpec, type Tone } from "./viz";
import { formatPct, scoreBand } from "./format";
import { StatusChip } from "./StatusChip";
import type { AttendanceData } from "./panelTypes";

type Score = BranchHeadHealthPayload["branches"][number]["score"];

export interface HeroScoreProps {
  branch: HeadBranch;
  overview: BranchOverview;
  score: Score;
  /** Daily health-score snapshots, oldest first; the sparkline draws only with >= 3 points. */
  trend?: Array<number | null>;
  onOpenAttention: () => void;
}

const BAND_TONE: Record<"Good" | "Fair" | "Poor", Tone> = { Good: "good", Fair: "warning", Poor: "critical" };
const words = (key: string) => key.split("_").join(" ");
const outOf100 = (n: number) => `${Math.round(n)}/100`;

/** Scored pillars become bars; pillars with no score, or excluded for lack of data, are listed as not scored. */
export function pillarRows(score: NonNullable<Score>) {
  const excluded = new Set(score.excluded);
  const scored: BarItem[] = [];
  const unscored: Array<{ key: string; weight: number | null }> = [];
  for (const p of score.pillars) {
    if (p.score == null || !Number.isFinite(p.score) || excluded.has(p.key)) unscored.push({ key: p.key, weight: p.weight });
    else scored.push({ id: p.key, label: words(p.key), value: p.score, note: `weight ${p.weight}`, tone: BAND_TONE[scoreBand(p.score).label] });
  }
  for (const key of score.excluded) if (!unscored.some((u) => u.key === key)) unscored.push({ key, weight: null });
  return { scored, unscored };
}

function vsYesterday(ov: BranchOverview): string | null {
  const a = ov.attendance?.status === "ok" ? (ov.attendance.data as AttendanceData | null) : null;
  const prev = a?.previousDay?.shrinkagePct;
  if (!a || prev == null || !Number.isFinite(prev) || !Number.isFinite(a.shrinkagePct)) return null;
  return `Shrinkage ${formatPct(a.shrinkagePct)} vs ${formatPct(prev)} yesterday`;
}

function PillarBars({ score }: { score: NonNullable<Score> }) {
  const { scored, unscored } = pillarRows(score);
  const bars: BarListProps = { items: scored, max: 100, format: outOf100, label: "Health score by pillar" };
  const base = barListTable(bars);
  // The table twin is the same bar data plus the not-scored pillars, so nothing is chart-only.
  const table: TableSpec = { ...base, rows: [...base.rows, ...unscored.map((u) => [words(u.key), "not scored", u.weight == null ? "no data" : `weight ${u.weight}`])] };
  return (
    <ChartFrame title="Score by pillar" table={table} height={Math.max(48, (scored.length + unscored.length) * 36)}>
      <div className="[&_.bh-row-label]:capitalize">
        {scored.length ? <BarList {...bars} /> : null}
        {unscored.length ? (
          <ul className="bh-rows bh-hero-unscored mt-1" aria-label="Pillars not scored">
            {unscored.map((u) => (
              <li key={u.key} className="bh-row">
                <span className="bh-row-label">{words(u.key)}</span>
                <span className="bh-bar-line">
                  <span className="bh-track rounded border border-dashed border-slate-300" aria-hidden="true" />
                  <span className="bh-row-value font-normal text-slate-700">not scored</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {score.excluded.length > 0 ? (
        <p className="mt-2 text-[12px] text-slate-700">Not scored (no data): {score.excluded.join(", ")} - remaining weights renormalised</p>
      ) : null}
    </ChartFrame>
  );
}

/** Hero: score ring + band, pillar bars, status chip and a one-line context strip. Deliberately little text. */
export function HeroScore({ branch, overview, score, trend, onOpenAttention }: HeroScoreProps) {
  const yesterday = vsYesterday(overview);
  const n = overview.attention.length;
  return (
    <div className="kit-card grid gap-4 p-4 lg:grid-cols-[minmax(220px,auto)_minmax(0,1fr)]">
      {/* Left column: centred stack (name and status, ring with band, trend, attention, date, vs yesterday). */}
      <div className="bh-hero-left flex min-w-0 flex-col items-center justify-center gap-2 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <h2 className="min-w-0 text-[16px] font-bold text-slate-900">{branch.branchName}</h2>
          <StatusChip status={overview.status} />
        </div>
        {score ? (
          <>
            <ScoreRing value={score.score} label="Health score" band={scoreBand(score.score).label} size={172} />
            {trend ? <Sparkline points={trend} label="Health score trend" width={120} height={32} /> : null}
          </>
        ) : (
          <div className="text-[13px] text-slate-700"><span className="text-[28px] font-extrabold text-slate-900">—</span> Score unavailable</div>
        )}
        {n > 0 ? (
          <button type="button" onClick={onOpenAttention}
            className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-blue-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {n} {n === 1 ? "needs" : "need"} attention
          </button>
        ) : null}
        <p className="text-[12px] text-slate-700">{overview.date}</p>
        {yesterday ? <p className="text-[12px] text-slate-700">{yesterday}</p> : null}
      </div>
      {score && (score.pillars.length > 0 || score.excluded.length > 0) ? <PillarBars score={score} /> : null}
    </div>
  );
}
