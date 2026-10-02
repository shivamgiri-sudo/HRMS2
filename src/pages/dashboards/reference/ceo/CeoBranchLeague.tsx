import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Panel, formatUnit, type InsightTable } from "../../kit";

const cell = (v: unknown, unit?: "percent" | "inr") => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number" && unit) { const f = formatUnit(v, unit); return `${f.text}${f.suffix}`; }
  return typeof v === "number" ? v.toLocaleString("en-IN") : String(v);
};
const att = (v: unknown) => (typeof v !== "number" ? "text-slate-400" : v >= 90 ? "text-emerald-700" : v >= 80 ? "text-amber-700" : "text-rose-700");
const exitTone = (v: unknown) => (typeof v !== "number" ? "text-slate-400" : v >= 30 ? "text-rose-700" : v >= 15 ? "text-amber-700" : "text-emerald-700");

/**
 * Branch league: headcount, latest processed attendance, 90-day exits, and revenue from the P&L rows (matched on
 * branch name — "—" when the P&L has no row for the branch, never a made-up 0). Each row drills to that branch's roster.
 */
export function CeoBranchLeague({ table, revenue, loading }: { table?: InsightTable; revenue: Map<string, number>; loading?: boolean }) {
  const rows: Array<Record<string, string | number | null | undefined>> = (table?.rows ?? []).map((r) => ({ ...r, revenue: revenue.get(String(r.branch ?? "").trim().toLowerCase()) ?? null }));
  return (
    <Panel title="Branch league table" subtitle="Headcount · attendance · exits · revenue — click a branch for its people" bodyClassName="p-0">
      {loading && !table ? <div className="kit-shimmer m-4 h-40 rounded-xl" /> : table?.unavailable ? <p className="p-4 text-[12px] text-amber-700">{table.unavailable}</p> : !rows.length ? <p className="p-4 text-[12px] text-slate-400">No branches in scope</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="px-4 py-2 font-semibold">Branch</th><th className="px-2 py-2 text-right font-semibold">Headcount</th>
              <th className="px-2 py-2 text-right font-semibold">{table?.columns.find((c) => c.key === "attendance")?.label ?? "Attendance"}</th>
              <th className="px-2 py-2 text-right font-semibold">Exits 90d</th><th className="px-2 py-2 text-right font-semibold">Exit rate 90d</th><th className="px-4 py-2 text-right font-semibold">Revenue MTD</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={String(r.branchId ?? i)} className="transition hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{r.href ? <Link to={String(r.href)} className="text-blue-700 hover:underline">{String(r.branch)}</Link> : String(r.branch)}</td>
                  <td className="kit-num px-2 py-2.5 text-right font-semibold text-slate-900">{cell(r.headcount)}</td>
                  <td className={cn("kit-num px-2 py-2.5 text-right font-semibold", att(r.attendance))}>{cell(r.attendance, "percent")}</td>
                  <td className="kit-num px-2 py-2.5 text-right text-slate-700">{cell(r.exits90)}</td>
                  <td className={cn("kit-num px-2 py-2.5 text-right font-semibold", exitTone(r.exitRate90))}>{cell(r.exitRate90, "percent")}</td>
                  <td className="kit-num px-4 py-2.5 text-right text-slate-700">{cell(r.revenue, "inr")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
