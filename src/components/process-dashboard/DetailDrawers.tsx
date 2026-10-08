import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import type { UseQueryResult } from "@tanstack/react-query";
import { Drawer } from "./Drawer";
import { DASH, formatValue, humanize } from "./format";
import { Empty, ErrorBox, Panel, SERIES_COLORS, Skeleton, reduceMotion } from "./ui";
import { SimpleTable, type SimpleCol } from "./SimpleTable";
import type { AgentDetail, DayDetail, Kpi } from "./types";
import { WhyButton } from "./rootcause/WhyButton";

const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const cell = (v: unknown) => (typeof v === "number" ? formatValue(v) : v == null || v === "" ? DASH : String(v));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Could not load details.");

function KeyValues({ data, units }: { data?: Record<string, unknown> | null; units?: Record<string, string | undefined> }) {
  const entries = Object.entries(data ?? {}).filter(([, v]) => scalar(v));
  if (!entries.length) return <p className="text-xs text-slate-600">{DASH}</p>;
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">{entries.map(([k, v]) => (
    <div key={k}><dt className="text-slate-600">{humanize(k)}</dt><dd className="font-semibold tabular-nums text-slate-900">{typeof v === "number" ? formatValue(v, units?.[k]) : String(v)}</dd></div>))}</dl>;
}

export function AgentDrawer({ code, query, kpis, focusKey, onClose, onDay }: { code: string; query: UseQueryResult<AgentDetail>; kpis: Kpi[]; focusKey: string; onClose: () => void; onDay: (d: string) => void }) {
  const d = query.data;
  const units = useMemo(() => Object.fromEntries(kpis.map((k) => [k.key, k.unit])), [kpis]);
  const numericKeys = useMemo(() => kpis.filter((k) => d?.daily?.some((r) => typeof r[k.key] === "number")), [kpis, d?.daily]);
  const [metric, setMetric] = useState("");
  const m = numericKeys.find((k) => k.key === (metric || focusKey)) ?? numericKeys[0];
  const series = useMemo(() => {
    if (!m || !d?.daily) return [];
    const team = d.vsTeam?.team?.metrics?.[m.key];
    return d.daily.map((r) => ({ date: r.date, agent: r[m.key] as number | null, team: typeof team === "number" ? team : undefined }));
  }, [d, m]);
  const name = String(d?.profile?.name ?? d?.profile?.agent_name ?? d?.profile?.agentName ?? code);
  return (
    <Drawer title={name} subtitle={`Agent ${code}${d?.rank?.position ? ` · rank #${d.rank.position} of ${d.rank.of ?? "?"}${d.rank.metric ? ` by ${humanize(d.rank.metric)}` : ""}` : ""}`} onClose={onClose}>
      {query.isLoading ? <><Skeleton className="h-24" /><Skeleton className="h-64" /></> : query.isError ? <ErrorBox message={errMsg(query.error)} onRetry={() => void query.refetch()} /> : !d ? <Empty>No data for this agent in the range.</Empty> : (
        <>
          <Panel title="Profile"><KeyValues data={d.profile as Record<string, unknown>} /></Panel>
          <Panel title="Totals for range"><KeyValues data={d.totals as Record<string, unknown>} units={units} /></Panel>
          {d.vsTeam && numericKeys.length > 0 && (
            <Panel title={`Versus team${d.vsTeam.team?.tl ? ` (${d.vsTeam.team.tl}, ${d.vsTeam.team.agents ?? "?"} agents)` : ""}`}>
              <SimpleTable caption="Agent totals compared with team and process" rows={kpis.filter((k) => d.totals?.[k.key] != null).map((k) => ({
                metric: k.label, agent: d.totals?.[k.key], team: d.vsTeam?.team?.metrics?.[k.key], process: d.vsTeam?.process?.metrics?.[k.key], dTeam: d.vsTeam?.deltaVsTeamPct?.[k.key], unit: k.unit }))}
                cols={[{ key: "metric", label: "Metric", align: "left" },
                  { key: "agent", label: "Agent", render: (r) => formatValue(r.agent as number, r.unit as string) },
                  { key: "team", label: "Team", render: (r) => formatValue(r.team as number, r.unit as string) },
                  { key: "process", label: "Process", render: (r) => formatValue(r.process as number, r.unit as string) },
                  { key: "dTeam", label: "Vs team", render: (r) => (typeof r.dTeam === "number" ? `${r.dTeam > 0 ? "+" : ""}${r.dTeam.toFixed(1)}%` : DASH) }]} />
            </Panel>)}
          <Panel title="Daily trend vs team average" action={numericKeys.length > 1 ? (
            <select aria-label="Metric" value={m?.key} onChange={(e) => setMetric(e.target.value)} className="min-h-[32px] cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900">
              {numericKeys.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>) : undefined}>
            {series.length === 0 ? <Empty>No daily rows.</Empty> : (
              <div role="img" aria-label={`${m?.label} per day for this agent against the team average`} className="h-56">
                <ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => formatValue(v as number, m?.unit)} />
                  <Tooltip formatter={(v) => formatValue(typeof v === "number" ? v : null, m?.unit)} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="agent" name="Agent" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} isAnimationActive={!reduceMotion()} connectNulls />
                  <Line type="monotone" dataKey="team" name="Team average (range)" stroke={SERIES_COLORS[2]} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={!reduceMotion()} connectNulls />
                </LineChart></ResponsiveContainer>
              </div>)}
            {d.daily?.length ? <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-slate-800">View as table</summary><div className="mt-2">
              <SimpleTable caption="Agent daily values" maxHeight="max-h-64" onRow={(r) => onDay(String(r.date))} rowLabel={(r) => `Open day ${r.date}`}
                cols={[{ key: "date", label: "Date", align: "left" }, ...numericKeys.map((k) => ({ key: k.key, label: k.label, unit: k.unit }))]} rows={d.daily} /></div></details> : null}
          </Panel>
          <Panel title={`QA audits${d.qa?.length ? ` (${d.qa.length})` : ""}`}>
            {!d.qa?.length ? <Empty>No QA audits in this range.</Empty> : <SimpleTable caption="QA audits" maxHeight="max-h-56" rows={d.qa as unknown as Array<Record<string, unknown>>}
              cols={[{ key: "auditDate", label: "Date", align: "left" }, { key: "score", label: "Score", unit: "pct" }, { key: "fatal", label: "Fatal", render: (r) => (r.fatal ? "Yes" : "No") }, { key: "status", label: "Status", align: "left" }]} />}
          </Panel>
          <Panel title="Raw source rows">
            {!d.rawRows?.length ? <Empty>No raw rows.</Empty> : (() => {
              const keys = Object.keys(d.rawRows[0]).filter((k) => scalar(d.rawRows![0][k])).slice(0, 12);
              const cols: SimpleCol[] = keys.map((k, i) => ({ key: k, label: humanize(k), align: i === 0 ? "left" : "right", render: (r) => cell(r[k]) }));
              return <SimpleTable caption="Raw source rows" cols={cols} rows={d.rawRows.slice(0, 100)} maxHeight="max-h-64" />;
            })()}
          </Panel>
        </>
      )}
    </Drawer>
  );
}

export function DayDrawer({ day, query, kpis, onClose, onAgent, onWhy }: { day: string; query: UseQueryResult<DayDetail>; kpis: Kpi[]; onClose: () => void; onAgent: (c: string) => void; onWhy?: (metric: string) => void }) {
  const d = query.data;
  const rows = (d?.agents ?? []) as Array<Record<string, unknown>>;
  const hourlyRaw = d?.hourly ?? [];
  const metricCols = kpis.filter((k) => rows.some((r) => typeof r[k.key] === "number")).slice(0, 8);
  const hourly = hourlyRaw;
  const hourKeys = metricCols.length ? metricCols.filter((k) => hourly.some((h) => typeof h[k.key] === "number")).slice(0, 2) : [];
  return (
    <Drawer title={`Day breakdown: ${day}`} subtitle="Per-agent performance for the selected day" onClose={onClose}>
      {query.isLoading ? <Skeleton className="h-64" /> : query.isError ? <ErrorBox message={errMsg(query.error)} onRetry={() => void query.refetch()} /> : rows.length === 0 ? <Empty>No activity recorded on this day.</Empty> : (
        <>
          {onWhy && metricCols.length > 0 && <Panel title="Why did it change? (vs the same weekday last week)"><div className="flex flex-wrap gap-2">{metricCols.map((k) => <WhyButton key={k.key} label={`${k.label} on ${day}`} text={`Why ${k.label}?`} onClick={() => onWhy(k.key)} />)}</div></Panel>}
          {hourKeys.length > 0 && <Panel title="Hourly"><div role="img" aria-label="Hourly breakdown" className="h-48"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={hourly}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="hour" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={44} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
              {hourKeys.map((k, i) => <Line key={k.key} type="monotone" dataKey={k.key} name={k.label} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={false} isAnimationActive={!reduceMotion()} />)}</LineChart></ResponsiveContainer></div></Panel>}
          <Panel title={`Agents (${rows.length})`}>
            <SimpleTable caption={`Agent breakdown for ${day}`} rows={rows} maxHeight="max-h-[60vh]" onRow={(r) => onAgent(String(r.agentCode))} rowLabel={(r) => `Open agent ${r.name ?? r.agentCode}`}
              cols={[{ key: "name", label: "Agent", align: "left", render: (r) => String(r.name ?? r.agentCode ?? DASH) }, ...metricCols.map((k) => ({ key: k.key, label: k.label, unit: k.unit }))]} />
          </Panel>
        </>
      )}
    </Drawer>
  );
}
