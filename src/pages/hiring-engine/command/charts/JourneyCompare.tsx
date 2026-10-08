/**
 * The three drives side by side, stage by stage: people, step conversion (heat tint plus the number, and a Highest / Lowest marker with
 * an icon and a word), conversion from the start. The table is its own text alternative; Export CSV writes the same numbers.
 */
import { useId } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import type { DriveAnalytics } from "../driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL } from "../driveCommandModel";
import { useIsDark } from "../chartTheme";
import { BTN, EmptyBlock, Note } from "./ChartFrame";
import { download } from "./download";
import { ShapeGlyph } from "./TypePatterns";
import { JOURNEY_DEFINITIONS, SAMPLE_NOTE, SUBSET_NOTE, heatBucket, journeyCompare, journeyCsv, journeyCsvName, type CompareCell } from "./journeyModel";

const HEAT = [
  "bg-slate-50 dark:bg-slate-900",
  "bg-blue-50 dark:bg-blue-950",
  "bg-blue-100 dark:bg-blue-900",
  "bg-blue-200 dark:bg-blue-800",
] as const;

function RateCell({ c }: { c: CompareCell }) {
  if (c.count === null) return <td colSpan={3} className="px-2 py-2 text-center text-slate-600 dark:text-slate-300">n/a</td>;
  const b = heatBucket(c.rate);
  const Icon = c.level === "high" ? ArrowUp : c.level === "low" ? ArrowDown : null;
  return (
    <>
      <td className="px-2 py-2 text-right font-semibold tabular-nums">{c.countText}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${b === null ? "" : HEAT[b]}`} data-level={c.level ?? "none"}>
        <span className="inline-flex items-center justify-end gap-1">
          {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
          <span>{c.rateText}</span>
        </span>
        {c.levelText && <span className="block text-[11px] font-semibold">{c.levelText}</span>}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{c.startText}</td>
    </>
  );
}

export default function JourneyCompare({ analytics }: { analytics: DriveAnalytics }) {
  const dark = useIsDark();
  const titleId = `journey-compare-title-${useId().replaceAll(":", "")}`;
  const v = journeyCompare(analytics);
  const range = `${analytics?.window?.from ?? ""} to ${analytics?.window?.to ?? ""}`;
  const notes = [...new Set(SOURCE_TYPES.flatMap((t) => v.journeys[t].notes))].filter((n) => n !== SAMPLE_NOTE && n !== SUBSET_NOTE);
  const anySmall = SOURCE_TYPES.some((t) => v.journeys[t].notes.includes(SAMPLE_NOTE));
  const anyOdd = SOURCE_TYPES.some((t) => v.journeys[t].notes.includes(SUBSET_NOTE));
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-journey-compare>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-slate-100">Funnel comparison of all drives</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">{`${range}. For each stage: people, the share of the stage before (shaded darker when higher) and the share of the start.`}</p>
        </div>
        <button type="button" className={BTN} aria-label={`Export the funnel comparison as CSV for ${range}`} onClick={() => download(journeyCsvName(analytics), journeyCsv(analytics))}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </button>
      </div>
      <Note>{JOURNEY_DEFINITIONS}</Note>
      {notes.map((n) => <Note key={n}>{n}</Note>)}
      {anySmall && <Note>{SAMPLE_NOTE}</Note>}
      {anyOdd && <Note>{SUBSET_NOTE}</Note>}
      {v.empty ? <EmptyBlock text="No drive activity in this range" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-xs text-slate-800 dark:text-slate-100">
            <caption className="sr-only">{v.aria}</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th scope="col" rowSpan={2} className="px-2 py-1 text-left font-semibold">Stage</th>
                {SOURCE_TYPES.map((t) => (
                  <th key={t} scope="colgroup" colSpan={3} className="px-2 py-1 text-center font-semibold">
                    <span className="inline-flex items-center gap-1.5"><ShapeGlyph type={t} dark={dark} />{TYPE_LABEL[t]}</span>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                {SOURCE_TYPES.flatMap((t) => [
                  <th key={`${t}-p`} scope="col" className="px-2 py-1 text-right font-medium">People</th>,
                  <th key={`${t}-r`} scope="col" className="px-2 py-1 text-right font-medium">Of previous</th>,
                  <th key={`${t}-s`} scope="col" className="px-2 py-1 text-right font-medium">Of start</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800" data-compare-stage={r.key}>
                  <th scope="row" className="px-2 py-2 text-left font-semibold">{r.label}</th>
                  {SOURCE_TYPES.map((t) => <RateCell key={t} c={r.cells[t]} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
