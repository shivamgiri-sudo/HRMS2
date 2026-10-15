import { AlertTriangle, Inbox } from "lucide-react";
import { Panel } from "../../kit";
import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { SectionError } from "./SectionPanels";

type Part = SectionResult<unknown> | undefined;
interface Parts { kpis?: Part; qualityTrend?: Part; cx?: Part; fatal?: SectionResult<{ totalFatalCalls: number; agentsWithFatals: number; truncated: boolean }> }

/** Column keys that could carry a person or agent identity are never rendered. */
const IDENTITY_WORDS = ["agent", "name", "user", "employee", "code", "email", "manager"];
const hidden = (k: string): boolean => IDENTITY_WORDS.some((w) => k.toLowerCase().includes(w));

function label(k: string): string {
  let out = "";
  for (const ch of k) {
    if (ch === "_") out += " ";
    else out += ch >= "A" && ch <= "Z" && out.length > 0 ? ` ${ch}` : ch;
  }
  return out.length > 0 ? out[0].toUpperCase() + out.slice(1) : out;
}
const cell = (v: unknown): string => (v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v));

function scalars(o: unknown): Array<[string, unknown]> {
  if (o == null || typeof o !== "object" || Array.isArray(o)) return [];
  return Object.entries(o as Record<string, unknown>).filter(([k, v]) => (typeof v !== "object" || v === null) && !hidden(k));
}

function Sub({ title, part, children }: { title: string; part: Part; children: JSX.Element | null }) {
  return (
    <div className="mt-3">
      <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
      {!part || part.status === "error" ? <SectionError name={title} message={part?.message} />
        : children ?? <p className="text-[13px] text-slate-700">No data for this period</p>}
    </div>
  );
}

function RowsTable({ title, data }: { title: string; data: unknown }) {
  const rows = (Array.isArray(data) ? data : []).filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const cols = scalars(rows[0]).map(([k]) => k);
  if (cols.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">{title}</caption>
        <thead><tr className="text-slate-700">{cols.map((c) => <th key={c} className="py-1 pr-2">{label(c)}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 31).map((r, i) => (
            <tr key={i} className="border-t border-slate-100">{cols.map((c) => <td key={c} className="py-1.5 pr-2">{cell(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CallmasterPanel({ section }: { section?: SectionResult<unknown> }) {
  if (!section) return null;
  let body: JSX.Element;
  if (section.status === "error") body = <SectionError name="Callmaster" message={section.message} />;
  else if (section.status === "empty" || !section.data) {
    body = <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />No Callmaster client is mapped to this branch&apos;s processes</p>;
  } else {
    const p = section.data as Parts;
    const kd = p.kpis?.status === "ok" && p.kpis.data && typeof p.kpis.data === "object" ? (p.kpis.data as Record<string, unknown>) : {};
    const groups: Array<[string, Array<[string, unknown]>]> = [
      ["Inbound", scalars(kd.inbound)],
      ["Outbound", scalars(kd.outbound)],
    ];
    const hasKpis = groups.some(([, f]) => f.length > 0);
    const cxd = p.cx?.status === "ok" && p.cx.data && typeof p.cx.data === "object" ? (p.cx.data as { params?: Record<string, unknown>; definitions?: Array<{ key: string; label?: string }> }) : null;
    const cxRows = Object.entries(cxd?.params ?? {})
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => [cxd?.definitions?.find((d) => d.key === k)?.label ?? label(k), v as number] as const);
    const fatal = p.fatal?.status === "ok" ? p.fatal.data : null;
    body = (
      <div>
        <Sub title="KPIs" part={p.kpis}>
          {!hasKpis ? null : (
            <div>
              {groups.filter(([, f]) => f.length > 0).map(([g, fields]) => (
                <div key={g} className="mt-2">
                  <h4 className="text-[12px] font-semibold uppercase text-slate-700">{g}</h4>
                  <dl className="mt-1 grid grid-cols-2 gap-3 md:grid-cols-4">
                    {fields.map(([k, v]) => <div key={k}><dt className="text-[12px] text-slate-700">{label(k)}</dt><dd className="text-[18px] font-bold text-slate-900">{cell(v)}</dd></div>)}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </Sub>
        <Sub title="Quality trend" part={p.qualityTrend}><RowsTable title="Quality trend by day" data={p.qualityTrend?.data} /></Sub>
        <Sub title="CX parameters" part={p.cx}>
          {cxRows.length === 0 ? null : (
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">CX parameters</caption>
              <thead><tr className="text-slate-700"><th className="py-1 pr-2">Parameter</th><th className="py-1 pr-2">Score %</th></tr></thead>
              <tbody>{cxRows.map(([l, v]) => <tr key={l} className="border-t border-slate-100"><td className="py-1.5 pr-2">{l}</td><td className="py-1.5 pr-2">{cell(v)}</td></tr>)}</tbody>
            </table>
          )}
        </Sub>
        <Sub title="Fatal calls" part={p.fatal}>
          {fatal ? (
            <div>
              <dl className="mt-1 grid grid-cols-2 gap-3">
                <div><dt className="text-[12px] text-slate-700">Total fatal calls</dt><dd className="text-[18px] font-bold text-slate-900">{fatal.totalFatalCalls}</dd></div>
                <div><dt className="text-[12px] text-slate-700">Agents with fatals</dt><dd className="text-[18px] font-bold text-slate-900">{fatal.agentsWithFatals}</dd></div>
              </dl>
              {fatal.truncated ? (
                <p role="status" className="mt-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />Showing the most recent 5,000 audit rows - counts are partial
                </p>
              ) : null}
            </div>
          ) : null}
        </Sub>
      </div>
    );
  }
  return <Panel title="Callmaster" subtitle={section.status === "ok" ? `As of ${section.asOf}` : undefined}>{body}</Panel>;
}
