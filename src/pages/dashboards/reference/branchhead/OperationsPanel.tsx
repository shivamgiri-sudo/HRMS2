import { Clock3, Inbox } from "lucide-react";
import { Panel } from "../../kit";
import type { OpsProcessRow, QualityRow } from "../../../../../backend/src/modules/branch-head-health/ops";
import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { CoverageBadge } from "./ProcessCoveragePanel";
import { SectionError } from "./SectionPanels";

export function StaleBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-900">
      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Stale
    </span>
  );
}

const num = (v: number | null | undefined): string => (v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));

const COLS: Array<[string, string]> = [
  ["AHT", "AHT"], ["INBOUND_SL_PCT", "SL %"], ["INBOUND_AL_PCT", "AL %"],
  ["QA_QUALITY_PCT", "QA %"], ["SHRINKAGE_PCT", "Shrinkage %"], ["FUNNEL_SALE_PCT", "Sale conversion %"],
];

function Shell({ title, section, emptyText, children }: { title: string; section: SectionResult<unknown> | undefined; emptyText: string; children: (rows: never[]) => JSX.Element }) {
  let body: JSX.Element;
  if (!section) return null;
  if (section.status === "error") body = <SectionError name={title} message={section.message} />;
  else if (!Array.isArray(section.data) || section.data.length === 0) {
    body = <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />{emptyText}</p>;
  } else body = <div className="overflow-x-auto">{children(section.data as never[])}</div>;
  return <Panel title={title} subtitle={section.status === "ok" ? `As of ${section.asOf}` : undefined}>{body}</Panel>;
}

export function OperationsPanel({ section }: { section?: SectionResult<unknown> }) {
  return (
    <Shell title="Operations" section={section} emptyText="No operational metrics for this branch">
      {(rows) => (
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <caption className="sr-only">Latest operational metrics per process</caption>
          <thead>
            <tr className="text-slate-700">
              <th className="py-1 pr-2">Process</th><th className="py-1 pr-2">Coverage</th>
              {COLS.map(([, l]) => <th key={l} className="py-1 pr-2 text-right">{l}</th>)}
              <th className="py-1 pr-2">Latest</th><th className="py-1">Freshness</th>
            </tr>
          </thead>
          <tbody>
            {(rows as OpsProcessRow[]).map((r) => (
              <tr key={r.processCode} className="border-t border-slate-100">
                <td className="py-2 pr-2 font-semibold text-slate-900">{r.processName}</td>
                <td className="py-2 pr-2"><CoverageBadge tier={r.tier} /></td>
                {COLS.map(([k, l]) => <td key={l} className="py-2 pr-2 text-right">{num(r.metrics[k])}</td>)}
                <td className="py-2 pr-2">{r.latestDate ?? "—"}</td>
                <td className="py-2">{r.stale ? <StaleBadge /> : "Current"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

export function QualityPanel({ section }: { section?: SectionResult<unknown> }) {
  return (
    <Shell title="Lowest quality processes" section={section} emptyText="No quality scores for this branch">
      {(rows) => (
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">Ten lowest QA quality processes, lowest first</caption>
          <thead><tr className="text-slate-700"><th className="py-1 pr-2">Process</th><th className="py-1 pr-2 text-right">QA quality %</th><th className="py-1 pr-2">Latest</th><th className="py-1">Freshness</th></tr></thead>
          <tbody>
            {(rows as QualityRow[]).map((r) => (
              <tr key={r.processCode} className="border-t border-slate-100">
                <td className="py-2 pr-2 font-semibold text-slate-900">{r.processName}</td>
                <td className="py-2 pr-2 text-right">{num(r.QA_QUALITY_PCT)}</td>
                <td className="py-2 pr-2">{r.latestDate ?? "—"}</td>
                <td className="py-2">{r.stale ? <StaleBadge /> : "Current"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
