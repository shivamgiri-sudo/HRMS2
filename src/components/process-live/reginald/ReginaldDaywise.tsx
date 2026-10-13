/**
 * Reginald Cart — Day-wise view: analyst target (REG-04) and operational
 * metrics (REG-05). Totals are pooled sums; averages are pooled sum ÷ pooled
 * count, never an average of daily averages.
 */
import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS_TICK, GRID, Grid2, KpiGrid, Loading, Failed, Note, PctCell, RegFilterBar, RegKpi, RegPanel, RegTable, SERIES,
  fmtDate, fmtN, useInsight, type AnalystDayRow, type DayRow, type RegRange, type Targets,
} from "./reginaldShared";
import {
  ACTUAL_BASES, DAILY_ANALYST_TARGET, achievementPct, actualOf, fmtDur, fmtPctNA, fmtSigned,
  summarizeTargets, targetsByAgent, targetsByDate, weightedAvg, type ActualBasis,
} from "./reginaldMetrics";

export default function ReginaldDaywise({ range }: { range: RegRange }) {
  const dayQ = useInsight<DayRow[]>("daily", range);
  const tQ = useInsight<Targets>("targets", range);
  return (
    <div>
      <RegFilterBar range={range} />
      {tQ.isLoading ? <Loading /> : tQ.error || !tQ.data ? <Failed msg="Could not load analyst targets" /> : <TargetSection t={tQ.data} />}
      {dayQ.isLoading ? <Loading /> : dayQ.error || !dayQ.data ? <Failed msg="Could not load day-wise data" /> : <OpsSection days={dayQ.data} agentDays={tQ.data?.rows ?? []} />}
    </div>
  );
}

const actualLabel = (b: ActualBasis) => ACTUAL_BASES.find(x => x.key === b)?.label ?? b;
const fmtActual = (v: number, b: ActualBasis) => (b === "revenue" ? `₹${fmtN(v)}` : fmtN(v));

function heat(v: number | null): string {
  if (v === null) return "#f1f5f9";
  if (v >= 100) return "#bbf7d0";
  if (v >= 80) return "#fef08a";
  return "#fecaca";
}

function TargetSection({ t }: { t: Targets }) {
  const [basis, setBasis] = useState<ActualBasis>("totalCdr");
  const sum = summarizeTargets(t.rows, basis);
  const byDate = targetsByDate(t.rows, basis);
  const byAgent = targetsByAgent(t.rows, basis);
  const dates = byDate.map(d => d.date);
  const cell = new Map(t.rows.map(r => [`${r.agent}|${r.date}`, r]));
  return (
    <div>
      <RegPanel title="Analyst target" sub={`${fmtN(DAILY_ANALYST_TARGET)} per eligible present day`}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label htmlFor="reg-basis" style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>Actual measured as</label>
          <select id="reg-basis" value={basis} onChange={e => setBasis(e.target.value as ActualBasis)} style={{ height: 28, borderRadius: 7, border: "1px solid #cbd5e1", fontSize: 12, fontWeight: 700 }}>
            {ACTUAL_BASES.map(b => <option key={b.key} value={b.key}>{b.label}{b.key === "totalCdr" ? " — default" : ""}</option>)}
          </select>
        </div>
        <Note>
          Target is earned only on days HRMS attendance marks the analyst present or week-off-worked (a half day earns half).
          Absent, leave, holiday, week off, missing punch and days with no attendance record earn 0. Period target = {fmtN(DAILY_ANALYST_TARGET)} × eligible days.
          Achievement = Actual ÷ Target × 100 (N/A when target is 0). The target is per analyst, not per campaign.
        </Note>
        {t.activityWithoutAttendance > 0 && <Note tone="warn">{t.activityWithoutAttendance} analyst-days have dialler activity but no HRMS attendance record, so they carry no target.</Note>}
        <KpiGrid>
          <RegKpi tone={5} label="Total target" value={fmtActual(sum.target, basis)} sub={`${sum.eligibleDays} eligible days · ${sum.agents} analysts`} />
          <RegKpi tone={0} label="Actual" value={fmtActual(sum.actual, basis)} sub={actualLabel(basis)} />
          <RegKpi tone={sum.gap >= 0 ? 2 : 4} label="Gap" value={fmtSigned(sum.gap)} sub="Actual − Target" />
          <RegKpi tone={(sum.achievementPct ?? 0) >= 100 ? 2 : 4} label="Achievement %" value={fmtPctNA(sum.achievementPct)} sub="Actual ÷ Target" />
        </KpiGrid>
        <Grid2>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#102f4b", marginBottom: 4 }}>Target vs actual by date</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byDate} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={fmtDate} /><YAxis tick={AXIS_TICK} />
                <Tooltip labelFormatter={(v: string) => fmtDate(v)} formatter={(v: number) => fmtN(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="target" name="Target" fill={SERIES[5]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#102f4b", marginBottom: 4 }}>Target vs actual by analyst</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byAgent.map(a => ({ ...a, name: a.agentName ?? a.agent }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} /><YAxis tick={AXIS_TICK} />
                <Tooltip formatter={(v: number) => fmtN(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="target" name="Target" fill={SERIES[5]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Grid2>
      </RegPanel>

      <RegPanel title="Achievement % heatmap" sub="Analyst × date · green ≥100 · yellow ≥80 · red <80 · grey N/A">
        <RegTable<(typeof byAgent)[number]>
          rows={byAgent}
          cols={[
            { h: "Analyst", left: true, get: a => a.agentName ? `${a.agentName} (${a.agent})` : a.agent },
            ...dates.map(d => ({
              h: fmtDate(d),
              get: (a: (typeof byAgent)[number]) => {
                const r = cell.get(`${a.agent}|${d}`);
                if (!r) return "";
                const v = achievementPct(actualOf(r, basis), r.target);
                return <span title={`${r.attendanceStatus} · target ${fmtN(r.target)}`} style={{ display: "inline-block", minWidth: 46, padding: "2px 4px", borderRadius: 4, background: heat(v), color: "#0b0b0b", fontWeight: 700 }}>{fmtPctNA(v, 0)}</span>;
              },
            })),
            { h: "Period", get: a => <PctCell v={a.achievementPct} /> },
          ]}
        />
      </RegPanel>

      <RegPanel title="Analyst target detail" sub={`${byAgent.length} analysts`}>
        <RegTable<(typeof byAgent)[number]>
          rows={byAgent}
          cols={[
            { h: "Analyst", left: true, get: a => a.agentName ?? "Not in HRMS" },
            { h: "Code", left: true, get: a => a.agent },
            { h: "Eligible days", get: a => String(a.eligibleDays) },
            { h: "Period target", get: a => fmtN(a.target) },
            { h: "Actual", get: a => fmtActual(a.actual, basis) },
            { h: "Gap", get: a => <span style={{ color: a.gap < 0 ? "#b91c1c" : "#15803d", fontWeight: 800 }}>{fmtSigned(a.gap)}</span> },
            { h: "Achievement", get: a => <PctCell v={a.achievementPct} /> },
          ]}
          foot={["All analysts", "", String(sum.eligibleDays), fmtN(sum.target), fmtActual(sum.actual, basis), fmtSigned(sum.gap), fmtPctNA(sum.achievementPct)]}
        />
      </RegPanel>
    </div>
  );
}

function OpsSection({ days, agentDays }: { days: DayRow[]; agentDays: AnalystDayRow[] }) {
  const tot = days.reduce((s, d) => ({
    totalCdr: s.totalCdr + d.totalCdr, connected: s.connected + d.connected, talkSec: s.talkSec + d.talkSec,
    aprTalk: s.aprTalk + d.aprTalkSec, wrap: s.wrap + d.wrapSec, wait: s.wait + d.waitSec, pause: s.pause + d.pauseSec, net: s.net + d.netLoginSec,
    invalid: s.invalid + d.invalidDurationRows,
  }), { totalCdr: 0, connected: 0, talkSec: 0, aprTalk: 0, wrap: 0, wait: 0, pause: 0, net: 0, invalid: 0 });
  const util = tot.net > 0 ? Math.round(((tot.aprTalk + tot.wait) / tot.net) * 1000) / 10 : 0;
  const timeChart = days.map(d => ({ date: d.date, talk: Math.round(d.aprTalkSec / 60), wrap: Math.round(d.wrapSec / 60), wait: Math.round(d.waitSec / 60) }));
  const agentUtil = new Map<string, { name: string; talk: number; wait: number; net: number }>();
  for (const r of agentDays) {
    const x = agentUtil.get(r.agent) ?? { name: r.agentName ?? r.agent, talk: 0, wait: 0, net: 0 };
    x.talk += r.aprTalkSec; x.wait += r.waitSec; x.net += r.netLoginSec;
    agentUtil.set(r.agent, x);
  }
  const utilChart = [...agentUtil.values()].filter(a => a.net > 0)
    .map(a => ({ name: a.name, utilization: Math.round(((a.talk + a.wait) / a.net) * 1000) / 10 }))
    .sort((a, b) => b.utilization - a.utilization);
  return (
    <div>
      {tot.invalid > 0 && <Note tone="warn">{tot.invalid} APR rows had a negative duration and were excluded from the time totals.</Note>}
      <Grid2>
        <RegPanel title="Daily activity" sub="Total CDR · Unique Dialed · Unique Connect">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={days} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={fmtDate} /><YAxis tick={AXIS_TICK} />
              <Tooltip labelFormatter={(v: string) => fmtDate(v)} formatter={(v: number) => fmtN(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="totalCdr" name="Total CDR" stroke={SERIES[0]} strokeWidth={2} dot={false} />
              <Line dataKey="uniqueDialed" name="Unique Dialed" stroke={SERIES[1]} strokeWidth={2} dot={false} />
              <Line dataKey="uniqueConnected" name="Unique Connect" stroke={SERIES[2]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Connect % by day">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={days} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={fmtDate} /><YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip labelFormatter={(v: string) => fmtDate(v)} formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line dataKey="connectPct" name="Connect %" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Time usage" sub="Talk / Wrap / Wait, minutes">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={timeChart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={fmtDate} /><YAxis tick={AXIS_TICK} />
              <Tooltip labelFormatter={(v: string) => fmtDate(v)} formatter={(v: number) => `${fmtN(v)} min`} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="talk" name="Talk" stackId="t" fill={SERIES[0]} stroke="#fff" strokeWidth={1} />
              <Bar dataKey="wrap" name="Wrap" stackId="t" fill={SERIES[1]} stroke="#fff" strokeWidth={1} />
              <Bar dataKey="wait" name="Wait" stackId="t" fill={SERIES[2]} stroke="#fff" strokeWidth={1} />
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Utilization by analyst" sub="(Talk + Wait) ÷ Net Login">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={utilChart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} /><YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Bar dataKey="utilization" name="Utilization" fill={SERIES[6]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
      </Grid2>
      <RegPanel title="Day-wise detail" sub={`${days.length} days`}>
        <RegTable<DayRow>
          rows={days}
          cols={[
            { h: "Date", left: true, get: d => fmtDate(d.date) },
            { h: "Total CDR", get: d => fmtN(d.totalCdr) },
            { h: "Unique Dialed", get: d => fmtN(d.uniqueDialed) },
            { h: "Unique Connect", get: d => fmtN(d.uniqueConnected) },
            { h: "Connect %", get: d => fmtPctNA(d.connectPct) },
            { h: "Agents", get: d => String(d.agents) },
            { h: "Avg Talk", get: d => fmtDur(d.avgTalkSec), title: "CDR talk ÷ connected calls" },
            { h: "Talk", get: d => fmtDur(d.aprTalkSec) },
            { h: "Wrap", get: d => fmtDur(d.wrapSec) },
            { h: "Wait", get: d => fmtDur(d.waitSec) },
            { h: "Pause", get: d => fmtDur(d.pauseSec) },
            { h: "Net Login", get: d => fmtDur(d.netLoginSec) },
            { h: "Utilization", get: d => fmtPctNA(d.utilization) },
            { h: "Orders", get: d => fmtN(d.orders) },
            { h: "Target", get: d => fmtN(d.target) },
            { h: "Achievement", get: d => <PctCell v={d.achievementPct} />, title: "Total CDR ÷ target" },
          ]}
          foot={[
            "Total", fmtN(tot.totalCdr), "—", "—", "—", "—", fmtDur(weightedAvg(tot.talkSec, tot.connected)),
            fmtDur(tot.aprTalk), fmtDur(tot.wrap), fmtDur(tot.wait), fmtDur(tot.pause), fmtDur(tot.net), fmtPctNA(util),
            fmtN(days.reduce((s, d) => s + d.orders, 0)), fmtN(days.reduce((s, d) => s + d.target, 0)),
            fmtPctNA(achievementPct(tot.totalCdr, days.reduce((s, d) => s + d.target, 0))),
          ]}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
          Unique counts are distinct per day, so they are not totalled across days — the Overview tab carries the period-distinct figures.
          Net Login = Talk + Wrap + Wait + Pause from the APR log.
        </div>
      </RegPanel>
    </div>
  );
}
