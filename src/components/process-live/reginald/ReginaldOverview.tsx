/**
 * Reginald Cart — executive overview (REG-01) and CDR visual analysis (REG-02).
 * Every card, chart and the campaign table come from one filtered request.
 */
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS_TICK, GRID, Grid2, KpiGrid, Loading, Failed, Note, RegFilterBar, RegKpi, RegPanel, RegTable, SERIES,
  fmtDate, fmtN, fmtRs, scrollToId, useInsight, type DayRow, type Overview, type RegRange,
} from "./reginaldShared";
import { fmtDur, fmtPctNA } from "./reginaldMetrics";

const CONTACTED_NA = "N/A (source has no contact disposition)";

export default function ReginaldOverview({ range }: { range: RegRange }) {
  const q = useInsight<Overview>("overview", range);
  const dayQ = useInsight<DayRow[]>("daily", range);
  return (
    <div>
      <RegFilterBar range={range} />
      {q.isLoading ? <Loading /> : q.error || !q.data ? <Failed msg="Could not load the Reginald overview" /> : <Body d={q.data} days={dayQ.data ?? []} />}
    </div>
  );
}

function Body({ d, days }: { d: Overview; days: DayRow[] }) {
  const { cdr, apr, sales } = d;
  const toTable = () => scrollToId("reg-campaign-table");
  const funnel = [
    { stage: "Unique Dialed", value: cdr.uniqueDialed, na: false },
    { stage: "Unique Contacted", value: 0, na: true },
    { stage: "Unique Connect", value: cdr.uniqueConnected, na: false },
    { stage: "Qualified (≥30s)", value: cdr.uniqueQualified, na: false },
  ].map(s => ({ ...s, text: s.na ? "N/A" : fmtN(s.value) }));
  const hourly = d.hourly.map(h => ({ ...h, label: `${String(h.hour).padStart(2, "0")}:00` }));
  return (
    <div>
      <KpiGrid>
        <RegKpi tone={0} label="Total CDR" value={fmtN(cdr.totalCdr)} sub="Every dial attempt" onClick={toTable} />
        <RegKpi tone={1} label="Unique Dialed" value={fmtN(cdr.uniqueDialed)} sub="Distinct phone numbers" onClick={toTable} />
        <RegKpi tone={5} label="Unique Contacted" value="N/A" sub="Dial log has no contact disposition" title={CONTACTED_NA} />
        <RegKpi tone={2} label="Unique Connect" value={fmtN(cdr.uniqueConnected)} sub="Distinct phones with talk > 0s" onClick={toTable} />
        <RegKpi tone={2} label="Qualified Connect" value={fmtN(cdr.uniqueQualified)} sub={`Talk ≥ 30s · ${fmtPctNA(cdr.qualifiedPct)} of dialed`} onClick={toTable} />
        <RegKpi tone={3} label="Sales" value={fmtN(sales.orders)} sub={`${fmtRs(sales.revenue)} revenue · not split by campaign`} />
        <RegKpi tone={0} label="Connect %" value={fmtPctNA(cdr.connectPct)} sub="Unique Connect ÷ Unique Dialed" onClick={toTable} />
        <RegKpi tone={1} label="Avg Talk Time" value={fmtDur(cdr.avgTalkSec)} sub="Total talk ÷ connected calls" onClick={toTable} />
        <RegKpi tone={5} label="Net Login" value={fmtDur(apr.netLoginSec)} sub={`${apr.agents} agents · talk+wrap+wait+pause`} />
        <RegKpi tone={apr.utilization >= 70 ? 2 : 4} label="Utilization" value={fmtPctNA(apr.utilization)} sub="(Talk + Wait) ÷ Net Login" />
      </KpiGrid>
      {apr.invalidDurationRows > 0 && <Note tone="warn">{apr.invalidDurationRows} APR rows carried a negative duration; those values are excluded from the time totals.</Note>}

      <Grid2>
        <RegPanel title="Hourly volume" sub="Unique Dialed vs Unique Connect">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip formatter={(v: number) => fmtN(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="uniqueDialed" name="Unique Dialed" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="uniqueConnected" name="Unique Connect" fill={SERIES[2]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Connect % by hour" sub="Weak slots sit lowest">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={hourly} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line type="monotone" dataKey="connectPct" name="Connect %" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Campaign comparison" sub="Offered vs Unique Dialed vs Unique Connect">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={d.byCampaign} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="campaign" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip formatter={(v: number) => fmtN(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="totalCdr" name="Offered (Total CDR)" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="uniqueDialed" name="Unique Dialed" fill={SERIES[1]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="uniqueConnected" name="Unique Connect" fill={SERIES[2]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Connect % by day">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={days} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={fmtDate} />
              <YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip labelFormatter={(v: string) => fmtDate(v)} formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line type="monotone" dataKey="connectPct" name="Connect %" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Conversion funnel" sub="Unique phones">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 80, left: 20, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="stage" tick={AXIS_TICK} width={110} />
              <Tooltip formatter={(v: number, _n, p) => ((p?.payload as { na?: boolean })?.na ? CONTACTED_NA : fmtN(v))} />
              <Bar dataKey="value" name="Unique phones" fill={SERIES[0]} radius={[0, 4, 4, 0]}>
                <LabelList dataKey="text" position="right" style={{ fontSize: 10, fontWeight: 800, fill: "#0b0b0b" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#52514e" }}>
            Contact rate: N/A — the dial log records only connected / not connected. Connect %: {fmtPctNA(cdr.connectPct)} · Qualified: {fmtPctNA(cdr.qualifiedPct)}.
          </div>
        </RegPanel>
        <RegPanel title="Avg talk time by campaign" sub="Talk ÷ connected calls">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.byCampaign} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="campaign" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip formatter={(v: number) => fmtDur(v)} />
              <Bar dataKey="avgTalkSec" name="Avg talk" fill={SERIES[6]} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="avgTalkSec" position="top" style={{ fontSize: 10, fontWeight: 800, fill: "#0b0b0b" }} formatter={(v: number) => fmtDur(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
      </Grid2>

      <RegPanel id="reg-campaign-table" title="By campaign" sub={`${d.byCampaign.length} campaigns`}>
        <RegTable<Overview["byCampaign"][number]>
          rows={d.byCampaign}
          cols={[
            { h: "Campaign", left: true, get: r => r.campaign },
            { h: "Offered", get: r => fmtN(r.totalCdr) },
            { h: "Connected calls", get: r => fmtN(r.connected) },
            { h: "Unique Dialed", get: r => fmtN(r.uniqueDialed) },
            { h: "Unique Contacted", get: () => "N/A", title: CONTACTED_NA },
            { h: "Unique Connect", get: r => fmtN(r.uniqueConnected) },
            { h: "Qualified (≥30s)", get: r => fmtN(r.uniqueQualified) },
            { h: "Connect %", get: r => fmtPctNA(r.connectPct) },
            { h: "Avg Talk", get: r => fmtDur(r.avgTalkSec) },
          ]}
          foot={["All (distinct across campaigns)", fmtN(cdr.totalCdr), fmtN(cdr.connected), fmtN(cdr.uniqueDialed), "N/A", fmtN(cdr.uniqueConnected), fmtN(cdr.uniqueQualified), fmtPctNA(cdr.connectPct), fmtDur(cdr.avgTalkSec)]}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
          A phone dialled on two campaigns counts once in the total, so campaign uniques can add up to more than the total.
        </div>
      </RegPanel>
    </div>
  );
}
