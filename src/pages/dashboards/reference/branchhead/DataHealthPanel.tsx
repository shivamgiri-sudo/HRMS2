import { Panel } from "../../kit";
import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";

/** Data-quality counts across the selected branches (not per branch). */
export function DataHealthPanel({ section }: { section: BranchHeadHealthPayload["dataHealth"] }) {
  const subtitle = "Across the selected branches";
  if (!section || section.status === "error") {
    return <Panel title="Data health" subtitle={subtitle}><p className="text-[13px] text-slate-700">Data health could not be loaded.</p></Panel>;
  }
  const d = section.data;
  if (section.status === "empty" || !d) {
    return <Panel title="Data health" subtitle={subtitle}><p className="text-[13px] text-slate-700">No data health information for these branches.</p></Panel>;
  }
  const stats: Array<[string, number]> = [
    ["Unmapped processes", d.unmappedProcesses],
    ["Cost centres without a process", d.costCentresWithoutProcess],
    ["Stale processes", d.staleProcesses],
  ];
  return (
    <Panel title="Data health" subtitle={subtitle}>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map(([label, n]) => (
          <div key={label}><dt className="text-[12px] text-slate-700">{label}</dt><dd className="text-[20px] font-semibold text-slate-900">{n}</dd></div>
        ))}
      </dl>
      {d.overMandate.length > 0 ? (
        <table className="mt-4 w-full text-left text-[13px]">
          <caption className="mb-1 text-left text-[12px] font-semibold text-slate-800">Cost centres over mandate</caption>
          <thead><tr><th>Cost centre</th><th>Seats</th><th>Headcount</th><th>Over by</th></tr></thead>
          <tbody>
            {d.overMandate.map((r) => (
              <tr key={r.costCentre}><td>{r.costCentre}</td><td>{r.seats}</td><td>{r.headcount}</td><td>{r.headcount - r.seats}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Panel>
  );
}
