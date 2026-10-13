/** KPI strip: one tile per drive type (seven stages, arrivals sparkline, change arrow as icon + words) and the cost tile (estimated figures when cost is available, otherwise the placeholder). */
import { ArrowDown, ArrowUp, Coins, Minus } from "lucide-react";
import type { DriveAnalytics, SourceType } from "../driveCommandTypes";
import { sparklinePath } from "../driveChartModel";
import { seriesColor, useIsDark } from "../chartTheme";
import ChartFrame, { Note } from "./ChartFrame";
import { ShapeGlyph } from "./TypePatterns";
import { CREDIT_NOTE, UNTRACKED_NOTE, kpiView, liveWindowNote } from "./summaryView";
import { COST_TITLE, costNoteFor, costTiles } from "./costView";

const SPARK_W = 96;
const SPARK_H = 28;
const ICON = { "arrow-up": ArrowUp, "arrow-down": ArrowDown, minus: Minus } as const;

/** `only` shows that drive type's tile alone (zeros stay visible, with their reason given by the caller) and leaves out the cost tile. */
export default function KpiStrip({ analytics, only }: { analytics: DriveAnalytics; only?: SourceType }) {
  const dark = useIsDark();
  const v = kpiView(analytics, only);
  const cost = only ? null : costTiles(analytics);
  const note = costNoteFor(analytics) || "Cost per source arrives with Plan 5";
  const grid = only ? "grid gap-3" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-4";
  const windowNote = liveWindowNote(analytics, only);
  return (
    <ChartFrame
      title={only ? "At a glance" : "Drive types at a glance"}
      subtitle={`${analytics?.window?.from ?? ""} to ${analytics?.window?.to ?? ""}, change in arrivals against the previous period of the same length`}
      table={v.table} empty={only ? false : v.empty} aria={v.table.caption} kind="grid"
      note={<div className="space-y-1">{windowNote && <Note>{windowNote}</Note>}{v.untracked && <Note>{UNTRACKED_NOTE}</Note>}<Note>{CREDIT_NOTE}</Note></div>}
    >
      <div className={grid}>
        {v.tiles.map((t) => {
          const Icon = ICON[t.arrivalsChange.icon];
          const path = sparklinePath(t.sparkline, SPARK_W, SPARK_H);
          return (
            <article key={t.sourceType} data-kpi-tile={t.sourceType} className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <header className="flex flex-wrap items-center gap-2">
                <ShapeGlyph type={t.sourceType} dark={dark} />
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.label}</h4>
                {!t.present && <span className="rounded border border-slate-300 px-1.5 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-200">No activity in this range</span>}
              </header>
              <dl className={only ? "grid grid-cols-4 gap-x-2 gap-y-2 sm:grid-cols-7" : "grid grid-cols-4 gap-x-2 gap-y-1"}>
                {t.values.map((s) => (
                  <div key={s.stage} className="min-w-0">
                    <dt className="truncate text-xs text-slate-600 dark:text-slate-300">{s.label}</dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100" data-stage={`${t.sourceType}-${s.stage}`}>{s.text}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <svg role="img" aria-label={t.sparkLabel} width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="shrink-0">
                  {path ? <path d={path} fill="none" stroke={seriesColor(t.sourceType, dark)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    : <line x1="0" y1={SPARK_H - 1} x2={SPARK_W} y2={SPARK_H - 1} stroke={dark ? "#475569" : "#cbd5e1"} strokeDasharray="3 3" />}
                </svg>
                <p className="flex items-center gap-1 text-xs font-medium text-slate-800 dark:text-slate-100">
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{t.arrivalsChange.text}</span>
                </p>
              </div>
            </article>
          );
        })}
        {cost ? (
          <article data-cost-tile className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3 sm:col-span-2 xl:col-span-4 dark:border-slate-700">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100"><Coins className="h-4 w-4 shrink-0" aria-hidden /> {COST_TITLE}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {cost.map((c) => (
                <section key={c.sourceType} aria-label={`${c.label} cost`} className="min-w-0">
                  <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">{c.label}</h5>
                  <dl className="grid grid-cols-4 gap-x-2 sm:grid-cols-2 xl:grid-cols-4">
                    {c.rows.map((r) => (
                      <div key={r.label} className="min-w-0">
                        <dt className="truncate text-xs text-slate-600 dark:text-slate-300">{r.label}</dt>
                        <dd className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100" data-cost={`${c.sourceType}-${r.label}`}>{r.text}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">{costNoteFor(analytics)}</p>
          </article>
        ) : only ? null : (
          <article className="flex min-w-0 flex-col justify-center gap-1 rounded-lg border border-dashed border-slate-300 p-3 text-slate-600 dark:border-slate-600 dark:text-slate-300">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Coins className="h-4 w-4 shrink-0" aria-hidden /> Cost per source</p>
            <p className="text-xs">{note}</p>
          </article>
        )}
      </div>
    </ChartFrame>
  );
}
