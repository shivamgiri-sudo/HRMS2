/** Conversion heatmap (drive type x stage step) as an HTML table grid: every cell prints its rate, with an arrow and words for above / below average. */
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { DriveAnalytics } from "../driveCommandTypes";
import { TYPE_LABEL, pctText } from "../driveCommandModel";
import { divergingColor, useIsDark } from "../chartTheme";
import ChartFrame, { Note } from "./ChartFrame";
import { ShapeGlyph } from "./TypePatterns";
import { UNTRACKED_NOTE, cellInk, conversionView } from "./summaryView";

const WORDS = { above: "above average", below: "below average", even: "near average" } as const;
const ICONS = { above: ArrowUp, below: ArrowDown, even: Minus } as const;

export default function ConversionHeatmap({ analytics }: { analytics: DriveAnalytics }) {
  const dark = useIsDark();
  const v = conversionView(analytics);
  const averages = v.columns.map((_, k) => v.rows.find((r) => r.cells[k].average !== null)?.cells[k].average ?? null);
  return (
    <ChartFrame
      title="Conversion by stage"
      subtitle="Share of people who moved from one stage to the next, per drive type. Blue cells beat all types combined, red cells fall behind (grey within 5 points)."
      table={v.table} empty={v.empty} aria={v.aria} kind="grid"
      note={v.untracked ? <Note>{UNTRACKED_NOTE}</Note> : null}
    >
      <div className="relative overflow-x-auto">
        <table aria-label={v.aria} className="w-full min-w-max border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-semibold text-slate-700 dark:text-slate-200">Drive type</th>
              {v.columns.map((c) => <th key={c} scope="col" className="px-2 py-1 text-left font-semibold text-slate-700 dark:text-slate-200">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.sourceType}>
                <th scope="row" className="px-2 py-1 text-left font-semibold text-slate-900 dark:text-slate-100">
                  <span className="inline-flex items-center gap-1.5"><ShapeGlyph type={r.sourceType} dark={dark} />{TYPE_LABEL[r.sourceType]}</span>
                </th>
                {r.cells.map((c, k) => {
                  const bg = c.rate === null ? null : divergingColor(c.delta ?? 0, dark);
                  const Icon = c.direction ? ICONS[c.direction] : null;
                  const ink = bg ? cellInk(bg) : null;
                  return (
                    <td key={k} className="rounded px-2 py-2 font-semibold tabular-nums text-slate-700 dark:text-slate-300" style={bg && ink ? { background: bg, color: ink.color } : undefined}>
                      <span className={ink?.plate ? "inline-flex items-center gap-1 rounded bg-white px-1" : "inline-flex items-center gap-1"}>{c.text}{Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}</span>
                      {c.direction && <span className="sr-only"> {WORDS[c.direction]}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="px-2 py-1 text-left font-medium text-slate-700 dark:text-slate-200">All types combined</th>
              {averages.map((avg, k) => <td key={k} className="px-2 py-1 tabular-nums text-slate-700 dark:text-slate-200">{v.rows.every((r) => r.cells[k].rate === null) ? "–" : pctText(avg)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </ChartFrame>
  );
}
