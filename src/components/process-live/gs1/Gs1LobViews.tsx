// Email / Data Card / Approval sections. `compact` = overview section (mini KPIs + trend +
// status chart); full = the per-LOB drill-down with productivity, reasons and analyst tables.
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Box, Donut, Empty, Grid, HBars, Kpi, Note, SimpleTable } from "./Gs1Ui";
import { chartValue, fmtCount, fmtDayShort, fmtDec, fmtMinutes, fmtPct } from "./gs1Format";
import { LOB_COLOR } from "./gs1Format";
import type { Gs1AnalystStat, Gs1ApprovalDetail, Gs1DataCardDetail, Gs1EmailDetail, Gs1Labelled } from "./gs1Types";

const axis = { tick: { fontSize: 10 } };

function productivityBars(rows: Gs1AnalystStat[]): Gs1Labelled[] {
  return rows.slice(0, 15).map(r => ({ label: r.analyst, count: r.items }));
}

function AnalystTable({ rows, unit, extra }: { rows: Gs1AnalystStat[]; unit: string; extra: "sla" | "tat" | "error" }) {
  return (
    <SimpleTable rows={rows} cols={[
      { h: "Analyst", get: r => r.analyst, left: true },
      { h: `Items (${unit})`, get: r => fmtCount(r.items) },
      { h: "Processed", get: r => fmtCount(r.processed) },
      { h: "Active days", get: r => fmtCount(r.days) },
      { h: "Per day", get: r => fmtDec(r.perDay) },
      ...(extra === "error"
        ? [{ h: "Error % (of processed)", get: (r: Gs1AnalystStat) => fmtPct(r.errorPct) }]
        : [
            { h: "GTIN", get: (r: Gs1AnalystStat) => fmtCount(r.gtin) },
            { h: extra === "sla" ? "Within 15-min SLA %" : "Within TAT %", get: (r: Gs1AnalystStat) => fmtPct(r.slaPct) },
          ]),
    ]} />
  );
}

// ── Email ────────────────────────────────────────────────────────────────────
export function EmailView({ d, compact, tatNote }: { d: Gs1EmailDetail; compact?: boolean; tatNote: string }) {
  const s = d.summary; const has = s.hasData;
  const statusMissing = has && d.statusCoverage === 0;
  return (
    <div>
      <Grid min={140}>
        <Kpi accent={LOB_COLOR.email} label="Received" value={fmtCount(s.received, has)} sub="Tickets, by work date" />
        <Kpi accent={LOB_COLOR.email} label="Closed" value={fmtCount(s.processed, has)} sub="From ticket status" />
        <Kpi accent={LOB_COLOR.email} label="Pending" value={fmtCount(s.pending, has)} sub="Open status at upload" />
        <Kpi accent={LOB_COLOR.email} label="Closure %" value={fmtPct(s.closurePct, has)} sub="Closed / received" />
        <Kpi accent={LOB_COLOR.email} label="Within 15-min SLA" value={fmtPct(s.withinSlaPct, has)} sub="Ticket-weighted" tone={s.withinSlaPct === null ? undefined : s.withinSlaPct >= 80 ? "good" : "bad"} />
        <Kpi accent={LOB_COLOR.email} label="Avg handling time" value={fmtMinutes(s.avgTatMin, has)} sub="Source Duration" />
        <Kpi accent={LOB_COLOR.email} label="Productivity" value={fmtDec(s.productivity, has)} sub="Tickets / analyst-day" />
        {!compact && <Kpi accent={LOB_COLOR.email} label="GTIN processed" value={fmtCount(s.gtin, has)} />}
        {!compact && <Kpi accent={LOB_COLOR.email} label="Images" value={fmtCount(d.images, has)} />}
      </Grid>
      {statusMissing && <Note tone="warn">Ticket status was not captured for this period (uploaded before status capture). Re-upload the Email sheet to fill Closed / Pending / Closure %.</Note>}
      <Grid min={300} style={{ marginTop: 10 }}>
        <Box title="Received vs closed" sub="Basis: work date of the ticket (both series)">
          {d.daily.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={d.daily.map(x => ({ ...x, closed: chartValue(x.closed) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={fmtDayShort} {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip labelFormatter={l => fmtDayShort(String(l))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="received" name="Received" fill={LOB_COLOR.email} radius={3} />
                <Line dataKey="closed" name="Closed" stroke="#10b981" strokeWidth={2} dot={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Box>
        <Box title="Status mix" sub={`${fmtCount(d.statusCoverage)} tickets with status`}>
          <Donut data={d.statusMix} />
        </Box>
      </Grid>
      {!compact && (
        <>
          <Grid min={300} style={{ marginTop: 10 }}>
            <Box title="SLA bucket (source labels)" sub="Ticket count per SLA bucket in the upload"><HBars data={d.slaBuckets} color={LOB_COLOR.email} valueLabel="Tickets" /></Box>
            <Box title="Agent productivity" sub="Tickets per analyst (top 15)"><HBars data={productivityBars(d.byAnalyst)} color={LOB_COLOR.email} valueLabel="Tickets" /></Box>
            <Box title="Query type" sub="Type Of Query"><HBars data={d.queryTypes} color="#64748b" valueLabel="Tickets" /></Box>
            <Box title="Status labels as uploaded" sub="Mapped to closed / pending / rejected">
              <SimpleTable rows={d.statusLabels} cols={[{ h: "Status", get: r => r.label, left: true }, { h: "Tickets", get: r => fmtCount(r.count) }]} max={240} />
            </Box>
          </Grid>
          <Box title="Analyst-wise" sub={`${d.byAnalyst.length} analysts`} style={{ marginTop: 10 }}>
            <AnalystTable rows={d.byAnalyst} unit="tickets" extra="sla" />
          </Box>
          <Note>{tatNote}</Note>
        </>
      )}
    </div>
  );
}

// ── Data Card ────────────────────────────────────────────────────────────────
export function DataCardView({ d, compact, tatNote }: { d: Gs1DataCardDetail; compact?: boolean; tatNote: string }) {
  const s = d.summary; const has = s.hasData;
  return (
    <div>
      <Grid min={140}>
        <Kpi accent={LOB_COLOR.dataCard} label="Received" value={fmtCount(s.received, has)} sub="Tasks, by task date" />
        <Kpi accent={LOB_COLOR.dataCard} label="Completed" value={fmtCount(s.processed, has)} sub="Completion date filled" />
        <Kpi accent={LOB_COLOR.dataCard} label="Pending" value={fmtCount(s.pending, has)} sub="No completion date" />
        <Kpi accent={LOB_COLOR.dataCard} label="Completion %" value={fmtPct(s.closurePct, has)} sub="Completed / received" />
        <Kpi accent={LOB_COLOR.dataCard} label="Within TAT %" value={fmtPct(s.withinSlaPct, has)} sub={s.withinSlaPct === null ? "Source TAT is blank" : "Task-weighted"} />
        <Kpi accent={LOB_COLOR.dataCard} label="Avg duration" value={fmtMinutes(s.avgTatMin, has)} sub="Source Duration" />
        <Kpi accent={LOB_COLOR.dataCard} label="Productivity" value={fmtDec(s.productivity, has)} sub="Tasks / analyst-day" />
        {!compact && <Kpi accent={LOB_COLOR.dataCard} label="GTIN count" value={fmtCount(s.gtin, has)} />}
        {!compact && <Kpi accent={LOB_COLOR.dataCard} label="Avg GTIN / task" value={fmtDec(d.avgGtinPerTask, has)} />}
      </Grid>
      {has && d.completionCoverage === 0 && <Note tone="warn">Completion was not captured for this period (uploaded before completion capture). Re-upload the Data Card sheet to fill Completed / Pending.</Note>}
      <Grid min={300} style={{ marginTop: 10 }}>
        <Box title="Received vs completed" sub="Basis: task date (both series)">
          {d.daily.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={d.daily.map(x => ({ ...x, completed: chartValue(x.completed) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={fmtDayShort} {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip labelFormatter={l => fmtDayShort(String(l))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="received" name="Received" fill={LOB_COLOR.dataCard} radius={3} />
                <Line dataKey="completed" name="Completed" stroke="#10b981" strokeWidth={2} dot={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Box>
        {compact
          ? <Box title="Completion status"><Donut data={d.statusMix} /></Box>
          : <Box title="Category" sub="Category column"><HBars data={d.categories} color={LOB_COLOR.dataCard} valueLabel="Tasks" /></Box>}
      </Grid>
      {!compact && (
        <>
          <Grid min={300} style={{ marginTop: 10 }}>
            <Box title="Completion status"><Donut data={d.statusMix} /></Box>
            <Box title="Agent productivity" sub="Tasks per analyst (top 15)"><HBars data={productivityBars(d.byAnalyst)} color={LOB_COLOR.dataCard} valueLabel="Tasks" /></Box>
          </Grid>
          <Box title="Analyst-wise" sub={`${d.byAnalyst.length} analysts`} style={{ marginTop: 10 }}>
            <AnalystTable rows={d.byAnalyst} unit="tasks" extra="tat" />
          </Box>
          <Note>{tatNote}</Note>
        </>
      )}
    </div>
  );
}

// ── Approval ─────────────────────────────────────────────────────────────────
export function ApprovalView({ d, compact, tatNote }: { d: Gs1ApprovalDetail; compact?: boolean; tatNote: string }) {
  const s = d.summary; const has = s.hasData;
  return (
    <div>
      <Grid min={140}>
        <Kpi accent={LOB_COLOR.approval} label="Received" value={fmtCount(s.received, has)} sub="Audited products, by audit date" />
        <Kpi accent={LOB_COLOR.approval} label="Approved" value={fmtCount(d.approved, has)} />
        <Kpi accent={LOB_COLOR.approval} label="Rejected" value={fmtCount(s.rejected, has)} />
        <Kpi accent={LOB_COLOR.approval} label="Pending" value={fmtCount(s.pending, has)} sub="Not counted as processed" />
        <Kpi accent={LOB_COLOR.approval} label="Approval %" value={fmtPct(d.approvalPct, has)} sub="Approved / processed" />
        <Kpi accent={LOB_COLOR.approval} label="Rejection %" value={fmtPct(d.rejectionPct, has)} sub="Rejected / processed" />
        <Kpi accent={LOB_COLOR.approval} label="Error %" value={fmtPct(d.errorPct, has)} sub="Errors / processed" tone={d.errorPct === null ? undefined : d.errorPct < 5 ? "good" : "bad"} />
        {!compact && <Kpi accent={LOB_COLOR.approval} label="Processed %" value={fmtPct(s.closurePct, has)} sub="(Approved + rejected) / received" />}
        {!compact && <Kpi accent={LOB_COLOR.approval} label="Productivity" value={fmtDec(s.productivity, has)} sub="Products / auditee-day" />}
        {!compact && <Kpi accent={LOB_COLOR.approval} label="SKU" value={fmtCount(d.sku, has)} />}
      </Grid>
      <Grid min={300} style={{ marginTop: 10 }}>
        <Box title="Approved vs rejected vs pending" sub="Basis: audit date">
          {d.daily.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={fmtDayShort} {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip labelFormatter={l => fmtDayShort(String(l))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="approved" name="Approved" stackId="a" fill="#10b981" />
                <Bar dataKey="rejected" name="Rejected" stackId="a" fill="#f43f5e" />
                <Bar dataKey="pending" name="Pending" stackId="a" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Box>
        <Box title="Approval status"><Donut data={d.statusMix} /></Box>
        {!compact && <Box title="Rejection / error reasons" sub="Processed items only"><HBars data={d.reasons} color="#f43f5e" valueLabel="Items" /></Box>}
      </Grid>
      {!compact && (
        <>
          <Box title="Agent productivity" sub="Audited products per auditee (top 15)" style={{ marginTop: 10 }}>
            <HBars data={productivityBars(d.byAnalyst)} color={LOB_COLOR.approval} valueLabel="Products" />
          </Box>
          <Box title="Auditee-wise" sub={`${d.byAnalyst.length} auditees`} style={{ marginTop: 10 }}>
            <AnalystTable rows={d.byAnalyst} unit="products" extra="error" />
          </Box>
          <Note>{tatNote}</Note>
        </>
      )}
    </div>
  );
}
