import { AlertTriangle, Inbox } from "lucide-react";
import type { SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import { GradientKpi, KpiCell, KpiGrid, type KpiHue } from "../look";
import { BarList, ChartFrame, DataTable, barListTable, type BarListProps, type TableSpec } from "../viz";
import { SectionError } from "../SectionPanels";
import { Fold } from "./shared";

const HUES: KpiHue[] = ["navy", "emerald", "violet", "cyan", "orange", "teal", "indigo"];
import { num } from "./OpsHeatGrid";

type Part = SectionResult<unknown> | undefined;
interface Parts { kpis?: Part; qualityTrend?: Part; cx?: Part; fatal?: SectionResult<{ totalFatalCalls: number; agentsWithFatals: number; truncated: boolean }> }

/** Column keys that could carry a person or agent identity are never rendered. */
const IDENTITY_WORDS = ["agent", "name", "user", "employee", "code", "email", "manager"];
const hidden = (k: string): boolean => IDENTITY_WORDS.some((w) => k.toLowerCase().includes(w));

export function humanLabel(k: string): string {
  let out = "";
  for (const ch of k) {
    if (ch === "_") out += " ";
    else out += ch >= "A" && ch <= "Z" && out.length > 0 ? ` ${ch}` : ch;
  }
  return out.length > 0 ? out[0].toUpperCase() + out.slice(1) : out;
}
const cellText = (v: unknown): string => (v == null ? "—" : typeof v === "number" ? num(v) : String(v));

function scalars(o: unknown): Array<[string, unknown]> {
  if (o == null || typeof o !== "object" || Array.isArray(o)) return [];
  return Object.entries(o as Record<string, unknown>).filter(([k, v]) => (typeof v !== "object" || v === null) && !hidden(k));
}

function rowsTable(caption: string, data: unknown): TableSpec | null {
  const rows = (Array.isArray(data) ? data : []).filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>;
  const cols = rows.length ? scalars(rows[0]).map(([k]) => k) : [];
  if (!cols.length) return null;
  return { caption, columns: cols.map(humanLabel), rows: rows.slice(0, 31).map((r) => cols.map((c) => cellText(r[c]))) };
}

function Sub({ title, part, children }: { title: string; part: Part; children: JSX.Element | null }) {
  return (
    <div className="mt-3">
      <h4 className="text-[13px] font-bold text-slate-900">{title}</h4>
      {!part || part.status === "error" ? <SectionError name={title} message={part?.message} />
        : children ?? <p className="text-[13px] text-slate-700">No data for this period</p>}
    </div>
  );
}

const okObj = (p: Part) => (p?.status === "ok" && p.data && typeof p.data === "object" ? p.data : null);

/** Callmaster: KPI tiles, CX parameters as bars, quality trend in a fold, fatal-call tiles and the truncation notice. */
export function CallmasterBlock({ section }: { section?: SectionResult<unknown> }) {
  if (!section) return null;
  if (section.status === "error") return <SectionError name="Callmaster" message={section.message} />;
  if (section.status === "empty" || !section.data) {
    return <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />No Callmaster client is mapped to this branch&apos;s processes</p>;
  }
  const p = section.data as Parts;
  const kd = (okObj(p.kpis) ?? {}) as Record<string, unknown>;
  const groups = ([["Inbound", scalars(kd.inbound)], ["Outbound", scalars(kd.outbound)]] as Array<[string, Array<[string, unknown]>]>).filter(([, f]) => f.length > 0);
  const cxd = okObj(p.cx) as { params?: Record<string, unknown>; definitions?: Array<{ key: string; label?: string }> } | null;
  const cx: BarListProps = {
    label: "CX parameter scores", format: num, max: 100,
    items: Object.entries(cxd?.params ?? {}).filter(([k, v]) => typeof v === "number" && !hidden(k))
      .map(([k, v]) => ({ id: k, label: cxd?.definitions?.find((d) => d.key === k)?.label ?? humanLabel(k), value: v as number })),
  };
  const trend = rowsTable("Quality trend by day", p.qualityTrend?.data);
  const fatal = p.fatal?.status === "ok" ? p.fatal.data : null;
  return (
    <div>
      <Sub title="KPIs" part={p.kpis}>
        {groups.length ? (
          <div className="space-y-2">
            {groups.map(([g, fields]) => (
              <div key={g}>
                <h5 className="mb-1 text-[12px] font-semibold uppercase text-slate-700">{g}</h5>
                <KpiGrid label={`${g} KPIs`} cols={5}>{fields.map(([k, v], i) => <KpiCell key={k}><GradientKpi hue={HUES[i % HUES.length]} label={humanLabel(k)} value={cellText(v)} /></KpiCell>)}</KpiGrid>
              </div>
            ))}
          </div>
        ) : null}
      </Sub>
      <Sub title="CX parameters" part={p.cx}>
        {cx.items.length ? <ChartFrame title="CX parameters" subtitle="Score %" table={barListTable(cx)} height={96}><BarList {...cx} /></ChartFrame> : null}
      </Sub>
      <Sub title="Quality trend" part={p.qualityTrend}>
        {trend ? <Fold title="Quality trend by day"><DataTable table={trend} /></Fold> : null}
      </Sub>
      <Sub title="Fatal calls" part={p.fatal}>
        {fatal ? (
          <div>
            <KpiGrid label="Fatal calls">
              <KpiCell><GradientKpi hue="rose" label="Total fatal calls" value={cellText(fatal.totalFatalCalls)} /></KpiCell>
              <KpiCell><GradientKpi hue="slate" label="Agents with fatals" value={cellText(fatal.agentsWithFatals)} /></KpiCell>
            </KpiGrid>
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
