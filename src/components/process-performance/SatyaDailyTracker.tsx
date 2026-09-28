import { Fragment, useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { SectionCard, formatINR } from "./DashboardKit";
import {
  buildGridBlocks, buildGridColumns, fmtInt, fmtRatio, type GridColumn, type GridRow, type SatyaReportData,
} from "./satyaReportModel";

const HEAD_CLASS: Record<GridColumn["kind"], string> = {
  mtd: "bg-orange-600 text-white",
  week: "bg-slate-700 text-white",
  day: "bg-slate-800 text-white",
};
const CELL_CLASS: Record<GridColumn["kind"], string> = {
  mtd: "bg-orange-100 font-bold text-slate-900",
  week: "bg-amber-50 text-slate-800",
  day: "bg-sky-50/70 text-slate-700",
};

function formatCell(row: GridRow, value: number | null): string {
  if (value === null) return "—";
  if (row.kind === "pct") return fmtRatio(value);
  if (row.kind === "money") return formatINR(value);
  return fmtInt(value);
}

/**
 * Daily tracker -- the Excel "Data | MTD | W-1..W-n | each date" grid. Weeks
 * are day-of-month buckets (1-7, 8-14, 15-21, ...), MTD is the whole selected
 * range. Every cell is derived from the same per-day counters the other
 * tabs use, so a week or MTD column always equals the sum of its days.
 */
export function SatyaDailyTracker({ data }: { data: SatyaReportData }) {
  const columns = useMemo(() => buildGridColumns(data), [data]);
  const blocks = useMemo(() => buildGridBlocks(columns), [columns]);

  return (
    <SectionCard
      icon={CalendarDays} title="Daily tracker — MTD, weekly & day-wise" tone="amber"
      footnote="W-1 = 1st–7th, W-2 = 8th–14th, W-3 = 15th–21st, W-4 = 22nd–28th, W-5 = 29th onward. Conversion % = orders ÷ calls made (allocation − pending); 'at connect' = orders from unique calls ÷ connected. Days with no upload show as zero."
    >
      <div className="max-h-[75vh] overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 min-w-[210px] bg-slate-900 px-3 py-2.5 text-left font-bold uppercase tracking-wide text-white">Data</th>
              {columns.map((c) => (
                <th key={c.key} className={`min-w-[74px] whitespace-nowrap px-2 py-2.5 text-center font-bold ${HEAD_CLASS[c.kind]}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => (
              <Fragment key={block.title}>
                <tr>
                  <td colSpan={columns.length + 1} className="sticky left-0 border-y border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {block.title}
                  </td>
                </tr>
                {block.rows.length === 0 && (
                  <tr><td colSpan={columns.length + 1} className="px-3 py-3 text-slate-400">No connected calls in this range.</td></tr>
                )}
                {block.rows.map((row, i) => (
                  <tr key={`${block.title}-${row.label}-${i}`} className="border-b border-white">
                    <td className={`sticky left-0 z-10 border-r border-slate-200 bg-amber-50 px-3 py-1.5 ${row.strong ? "font-bold text-slate-900" : "text-slate-700"}`}>{row.label}</td>
                    {columns.map((c) => {
                      const v = row.get(c.data);
                      const zero = v === 0 || v === null;
                      return (
                        <td key={c.key} className={`px-2 py-1.5 text-right tabular-nums ${CELL_CLASS[c.kind]} ${row.strong && c.kind !== "mtd" ? "font-semibold" : ""} ${zero && c.kind !== "mtd" ? "text-slate-400" : ""}`}>
                          {formatCell(row, v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
