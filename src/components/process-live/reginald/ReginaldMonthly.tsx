/**
 * Reginald Cart — monthly performance (REG-03). Calendar months in the range
 * are always listed (an empty month shows zero, a future month is never
 * invented). MoM = (current − previous) ÷ previous × 100, N/A when previous is 0.
 */
import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS_TICK, GRID, Grid2, KpiGrid, Loading, Failed, Note, RegFilterBar, RegKpi, RegPanel, RegTable, SERIES,
  fmtN, fmtRs, useInsight, type MonthRow, type RegRange,
} from "./reginaldShared";
import { fmtDur, fmtPctNA, DAILY_ANALYST_TARGET } from "./reginaldMetrics";

/** At least the last three calendar months; an earlier "from" in the page filter still wins. */
export function monthlyRangeFrom(r: RegRange): string {
  const [y, m] = r.to.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 3, 1);
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  return start < r.from ? start : r.from;
}

function Mom({ v, pts }: { v: number | null; pts?: boolean }) {
  if (v === null) return <>MoM N/A</>;
  const arrow = v > 0 ? "▲" : v < 0 ? "▼" : "■";
  return <>{arrow} {v > 0 ? "+" : ""}{v.toFixed(1)}{pts ? " pts" : "%"} vs prev month</>;
}

export default function ReginaldMonthly({ range }: { range: RegRange }) {
  const r = { from: monthlyRangeFrom(range), to: range.to };
  const q = useInsight<MonthRow[]>("monthly", r);
  return (
    <div>
      <RegFilterBar range={r} note="monthly view always spans at least 3 months" />
      {q.isLoading
        ? <div><Loading /><div style={{ textAlign: "center", fontSize: 12, color: "#697586" }}>Totalling each month from the dialler's call log; a month not viewed recently can take a minute.</div></div>
        : q.error || !q.data ? <Failed msg="Could not load monthly data" /> : <Body rows={q.data} />}
    </div>
  );
}

function Body({ rows }: { rows: MonthRow[] }) {
  const [sel, setSel] = useState<string>("");
  if (rows.length === 0) return <Note>No months in the selected range.</Note>;
  const cur = rows.find(r => r.month === sel) ?? rows[rows.length - 1];
  const chart = rows.map(r => ({
    label: r.monthLabel, totalCdr: r.cdr.totalCdr, uniqueDialed: r.cdr.uniqueDialed, uniqueConnected: r.cdr.uniqueConnected,
    connectPct: r.cdr.connectPct, orders: r.orders, revenue: r.revenue, target: r.target, actual: r.cdr.totalCdr,
    utilization: r.apr.utilization,
    ...Object.fromEntries(r.byCampaign.map(c => [`c_${c.campaign}`, c.totalCdr])),
  }));
  const campaigns = [...new Set(rows.flatMap(r => r.byCampaign.map(c => c.campaign)))].sort();
  const isCurrentMonth = cur.month === new Date().toISOString().slice(0, 7);
  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>Cards for</span>
        {rows.map(r => (
          <button key={r.month} type="button" onClick={() => setSel(r.month)} style={{ height: 26, borderRadius: 7, border: "1px solid #cbd5e1", padding: "0 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", background: r.month === cur.month ? "#153f69" : "#fff", color: r.month === cur.month ? "#fff" : "#334155" }}>{r.monthLabel}</button>
        ))}
      </div>
      {!cur.hasData && <Note>{cur.monthLabel} has no dialler, APR or sales data — shown as zero.</Note>}
      {isCurrentMonth && <Note>{cur.monthLabel} is month-to-date; MoM compares it with the full previous month.</Note>}
      <KpiGrid>
        <RegKpi tone={0} label={`Total CDR · ${cur.monthLabel}`} value={fmtN(cur.cdr.totalCdr)} sub={<Mom v={cur.mom.totalCdr} />} />
        <RegKpi tone={2} label="Unique Connect" value={fmtN(cur.cdr.uniqueConnected)} sub={<Mom v={cur.mom.uniqueConnected} />} />
        <RegKpi tone={1} label="Connect %" value={fmtPctNA(cur.cdr.connectPct)} sub={<Mom v={cur.mom.connectPctPts} pts />} />
        <RegKpi tone={3} label="Sales orders" value={fmtN(cur.orders)} sub={<Mom v={cur.mom.orders} />} />
        <RegKpi tone={3} label="Revenue" value={fmtRs(cur.revenue)} sub={<Mom v={cur.mom.revenue} />} />
        <RegKpi tone={4} label="Target achievement" value={fmtPctNA(cur.achievementPct)} sub={`${fmtN(cur.cdr.totalCdr)} dials of ${fmtN(cur.target)} target`} />
        <RegKpi tone={5} label="Utilization" value={fmtPctNA(cur.apr.utilization)} sub={`Net login ${fmtDur(cur.apr.netLoginSec)}`} />
      </KpiGrid>

      <Grid2>
        <RegPanel title="Volume trend" sub="Total CDR · Unique Dialed · Unique Connect">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} /><YAxis tick={AXIS_TICK} />
              <Tooltip formatter={(v: number) => fmtN(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="totalCdr" name="Total CDR" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="uniqueDialed" name="Unique Dialed" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="uniqueConnected" name="Unique Connect" stroke={SERIES[2]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Sales trend" sub="Orders per month">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} /><YAxis tick={AXIS_TICK} />
              <Tooltip formatter={(v: number, _n, p) => `${fmtN(v)} orders · ${fmtRs((p?.payload as { revenue: number }).revenue)}`} />
              <Line dataKey="orders" name="Orders" stroke={SERIES[3]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Target vs actual" sub={`${fmtN(DAILY_ANALYST_TARGET)} dials × eligible present days`}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={chart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} /><YAxis tick={AXIS_TICK} />
              <Tooltip formatter={(v: number) => fmtN(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="target" name="Target" fill={SERIES[5]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Actual (Total CDR)" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Connect % trend" sub="Unique Connect ÷ Unique Dialed">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} /><YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line dataKey="connectPct" name="Connect %" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Campaign mix" sub="Total CDR by campaign">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={chart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} /><YAxis tick={AXIS_TICK} />
              <Tooltip formatter={(v: number) => fmtN(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
              {campaigns.map((c, i) => <Bar key={c} dataKey={`c_${c}`} name={c} stackId="c" fill={SERIES[i % SERIES.length]} stroke="#fff" strokeWidth={1} />)}
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Utilization trend" sub="(Talk + Wait) ÷ Net Login">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} /><YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line dataKey="utilization" name="Utilization" stroke={SERIES[6]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </RegPanel>
      </Grid2>

      <RegPanel title="Monthly detail" sub={`${rows.length} months`}>
        <RegTable<MonthRow>
          rows={rows}
          cols={[
            { h: "Month", left: true, get: r => r.monthLabel },
            { h: "Total CDR", get: r => fmtN(r.cdr.totalCdr) },
            { h: "MoM", get: r => fmtPctNA(r.mom.totalCdr) },
            { h: "Unique Dialed", get: r => fmtN(r.cdr.uniqueDialed) },
            { h: "Unique Connect", get: r => fmtN(r.cdr.uniqueConnected) },
            { h: "Connect %", get: r => fmtPctNA(r.cdr.connectPct) },
            { h: "Avg Talk", get: r => fmtDur(r.cdr.avgTalkSec) },
            { h: "Orders", get: r => fmtN(r.orders) },
            { h: "Revenue", get: r => fmtRs(r.revenue) },
            { h: "Revenue MoM", get: r => fmtPctNA(r.mom.revenue) },
            { h: "Eligible days", get: r => fmtN(r.eligibleDays) },
            { h: "Target", get: r => fmtN(r.target) },
            { h: "Achievement", get: r => fmtPctNA(r.achievementPct) },
            { h: "Net Login", get: r => fmtDur(r.apr.netLoginSec) },
            { h: "Utilization", get: r => fmtPctNA(r.apr.utilization) },
          ]}
        />
      </RegPanel>
    </div>
  );
}
