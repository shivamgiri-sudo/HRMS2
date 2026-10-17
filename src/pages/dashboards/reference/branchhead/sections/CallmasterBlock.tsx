import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, Headphones, PhoneIncoming, PhoneOff, PhoneOutgoing, Users } from "lucide-react";
import type { SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import { AccentCard, BarsChart, ChartCard, Chip, EmptyLine, GradientKpi, KpiCell, KpiGrid, NavyTable, PAL, type Accent, type KpiHue } from "../look";
import { SectionError } from "../SectionPanels";
import { formatCount } from "../format";
import { cellText, cxItems, humanLabel, okObj, rowsTable, scalars, trendChart, type CallmasterParts, type Part } from "./callmasterParts";
import { num } from "./OpsHeatGrid";

export { humanLabel } from "./callmasterParts";

const HUES: KpiHue[] = ["navy", "emerald", "violet", "cyan", "orange", "teal", "indigo"];

/** One Callmaster sub-part in an accent card: error inline, honest empty line, else the body. */
function PartCard({ title, part, chip, accent, children }: { title: string; part: Part; chip?: ReactNode; accent: Accent; children: ReactNode | null }) {
  const body = !part || part.status === "error" ? <SectionError name={title} message={part?.message} /> : children ?? <EmptyLine text="No data for this period" />;
  return <AccentCard title={title} accent={accent} chip={part?.status === "ok" ? chip : undefined}>{body}</AccentCard>;
}

/** No client mapped: icon, one line and what to do about it. */
export function CallmasterUnmapped() {
  return (
    <AccentCard title="Callmaster" accent="cyan">
      <div className="flex items-start gap-3 px-1 py-3">
        <PhoneOff className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />
        <div>
          <p className="text-[14px] font-semibold text-slate-900">No Callmaster client is mapped to this branch&apos;s processes</p>
          <p className="mt-1 text-[13px] text-slate-700">Ask the Callmaster admin to map a client to these processes; call quality, CX and fatal calls then appear here.</p>
        </div>
      </div>
    </AccentCard>
  );
}

/** Callmaster: KPI tiles, CX parameters as bars, the quality trend as a line chart, fatal-call tiles with a count table. */
export function CallmasterBlock({ section, compact }: { section?: SectionResult<unknown>; compact?: boolean }) {
  if (!section) return null;
  if (section.status === "error") return <AccentCard title="Callmaster" accent="cyan"><SectionError name="Callmaster" message={section.message} /></AccentCard>;
  if (section.status === "empty" || !section.data) return <CallmasterUnmapped />;
  const p = section.data as CallmasterParts;
  const kd = (okObj(p.kpis) ?? {}) as Record<string, unknown>;
  const groups = ([["Inbound", PhoneIncoming, scalars(kd.inbound)], ["Outbound", PhoneOutgoing, scalars(kd.outbound)]] as const).filter(([, , f]) => f.length > 0);
  const cx = cxItems(p.cx);
  const trendTable = rowsTable("Quality trend by day", p.qualityTrend?.data);
  const trend = trendChart(p.qualityTrend?.data);
  const fatal = p.fatal?.status === "ok" ? p.fatal.data : null;
  const perAgent = fatal && fatal.agentsWithFatals > 0 ? fatal.totalFatalCalls / fatal.agentsWithFatals : null;
  const calls = groups.map(([g, , f]) => `${g} ${cellText(f.find(([k]) => k.toLowerCase() === "total")?.[1])}`).join(" · ");
  return (
    <div className="space-y-4">
      <PartCard title="Callmaster KPIs" part={p.kpis} accent="cyan" chip={groups.length ? calls : undefined}>
        {groups.length ? (
          <div className="space-y-3">
            {groups.map(([g, Icon, fields]) => (
              <div key={g}>
                <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-700"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{g}</h4>
                <KpiGrid label={`${g} KPIs`} cols={5}>{fields.map(([k, v], i) => <KpiCell key={k}><GradientKpi hue={HUES[i % HUES.length]} label={humanLabel(k)} value={cellText(v)} /></KpiCell>)}</KpiGrid>
              </div>
            ))}
          </div>
        ) : null}
      </PartCard>
      <div className={compact ? "bhl-grid" : "bhl-grid bhl-grid-2"}>
        {p.cx?.status === "ok" && cx.length ? (
          <ChartCard title="CX parameters" accent="emerald" chip={`${cx.length} parameters · score %`}
            table={{ caption: "CX parameter scores", columns: ["Parameter", "Score %"], rows: cx.map((c) => [c.label, num(c.value)]) }}>
            <BarsChart label={`CX parameter scores: ${cx.map((c) => `${c.label} ${num(c.value)}`).join(", ")}`} xKey="label" horizontal height={Math.max(160, cx.length * 34 + 50)}
              format={num} data={cx.map((c) => ({ label: c.label, score: c.value }))} series={[{ key: "score", label: "Score %", color: PAL.s3 }]} />
          </ChartCard>
        ) : <PartCard title="CX parameters" part={p.cx} accent="emerald">{null}</PartCard>}
        {p.qualityTrend?.status === "ok" && trend && trendTable ? (
          <ChartCard title="Quality trend" accent="blue" chip={`${trend.rows.length} days`} table={trendTable}>
            <BarsChart label={`Quality trend by day: ${trend.rows.map((r) => `${r[trend.xKey]} ${trend.series.map((s) => `${s.label} ${cellText(r[s.key])}`).join(", ")}`).join("; ")}`}
              xKey={trend.xKey} height={260} format={num} data={trend.rows} series={trend.series} />
          </ChartCard>
        ) : <PartCard title="Quality trend" part={p.qualityTrend} accent="blue">{null}</PartCard>}
      </div>
      <PartCard title="Fatal calls" part={p.fatal} accent="rose" chip={fatal ? `${formatCount(fatal.totalFatalCalls)} fatal calls` : undefined}>
        {fatal ? (
          <div>
            <div className={compact ? "bhl-grid" : "bhl-grid bhl-grid-2"}>
              <ul aria-label="Fatal calls" className="grid list-none grid-cols-2 gap-2.5 p-0">
                <li className="flex min-w-0"><GradientKpi icon={AlertOctagon} hue="rose" label="Total fatal calls" value={formatCount(fatal.totalFatalCalls)} sub="Audited calls marked fatal"
                  status={fatal.totalFatalCalls > 0 ? "warning" : null} /></li>
                <li className="flex min-w-0"><GradientKpi icon={Users} hue="slate" label="Agents with fatals" value={formatCount(fatal.agentsWithFatals)} sub="Names are in the process drill-down" /></li>
              </ul>
              <NavyTable caption="Fatal call counts" limit={0} rows={[
                ["Total fatal calls", formatCount(fatal.totalFatalCalls)], ["Agents with fatals", formatCount(fatal.agentsWithFatals)],
                ["Fatal calls per agent", perAgent == null ? "—" : perAgent.toFixed(1)],
              ]} columns={[
                { key: "m", label: "Measure", render: (r) => <span className="font-semibold">{r[0]}</span> },
                { key: "v", label: "Count", num: true, render: (r) => r[1] },
              ]} />
            </div>
            {fatal.truncated ? (
              <p role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />Showing the most recent 5,000 audit rows - counts are partial
              </p>
            ) : <p className="bhl-note"><Chip tone="mute"><Headphones className="h-3 w-3" aria-hidden="true" />Counts only</Chip> Agent names are never shown at branch level.</p>}
          </div>
        ) : null}
      </PartCard>
    </div>
  );
}
