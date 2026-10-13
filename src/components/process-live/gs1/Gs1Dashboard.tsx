// GS1 India consolidated dashboard (GS1-01..05): overall summary, Email / Data Card /
// Approval sections, cross-LOB comparison, reconciliation and data-quality exceptions,
// with per-LOB drill-down views. Data: GET /api/process-live/gs1/dashboard.
import { useState } from "react";
import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getAuthToken } from "@/lib/hrmsApi";
import { Box, Grid, Kpi, Note, Section, SimpleTable } from "./Gs1Ui";
import { ApprovalView, DataCardView, EmailView } from "./Gs1LobViews";
import { chartValue, fmtCount, fmtDec, fmtMinutes, fmtPct, fmtStamp } from "./gs1Format";
import { LOB_COLOR } from "./gs1Format";
import type { Gs1ComparisonRow, Gs1DashboardData, Gs1DqRow, Gs1LobKey, Gs1ReconRow } from "./gs1Types";

type View = "overview" | Gs1LobKey;
const VIEWS: Array<{ key: View; label: string }> = [
  { key: "overview", label: "Overview" }, { key: "email", label: "Email" },
  { key: "dataCard", label: "Data Card" }, { key: "approval", label: "Approval" },
];

async function fetchGs1(params: Record<string, string>): Promise<Gs1DashboardData> {
  const qs = new URLSearchParams(params).toString();
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`/api/process-live/gs1/dashboard?${qs}`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = (await r.json()) as { ok: boolean; data: Gs1DashboardData };
  if (!d.ok) throw new Error("API error");
  return d.data;
}

const selectStyle: React.CSSProperties = { height: 30, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 8px", fontSize: 12, fontWeight: 700, color: "#1e293b", background: "#fff", maxWidth: 220 };
const SEV_COLOR: Record<Gs1DqRow["severity"], string> = { ok: "#047857", info: "#0369a1", warn: "#b45309", error: "#be123c" };

function lobAxisLabel(r: Gs1ComparisonRow) {
  return `${r.label} (${r.unit})`;
}

function Comparison({ rows, highlights }: Gs1DashboardData["comparison"]) {
  const data = rows.map(r => ({
    name: lobAxisLabel(r), received: r.received, processed: chartValue(r.processed), pending: chartValue(r.pending),
    closurePct: chartValue(r.closurePct), withinSlaPct: chartValue(r.withinSlaPct), avgTatMin: chartValue(r.avgTatMin),
  }));
  const chips: Array<[string, string | null]> = [
    ["Highest inflow", highlights.highestInflow], ["Highest backlog", highlights.highestBacklog],
    ["Lowest closure", highlights.lowestClosure], ["Worst SLA / TAT", highlights.worstSla], ["Slowest handling", highlights.slowestTat],
  ];
  const chart = (title: string, sub: string, keys: Array<[string, string, string]>, unit = "") => (
    <Box title={title} sub={sub}>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
          <YAxis tick={{ fontSize: 10 }} unit={unit} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {keys.map(([k, label, color]) => <Bar key={k} dataKey={k} name={label} fill={color} radius={3} />)}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {chips.map(([k, v]) => (
          <span key={k} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#fff", border: "1px solid #e2e8f0", color: "#334155" }}>
            {k}: <strong>{v ?? "N/A"}</strong>
          </span>
        ))}
      </div>
      <Grid min={300}>
        {chart("Received vs processed by LOB", "Each LOB in its own unit", [["received", "Received", "#2f6fed"], ["processed", "Processed / closed", "#10b981"]])}
        {chart("Closure / completion %", "N/A bars are left empty", [["closurePct", "Closure %", "#0ea5b7"]], "%")}
        {chart("Within SLA / TAT %", "Email 15-min SLA, Data Card TAT; Approval N/A", [["withinSlaPct", "Within SLA %", "#7c5ce5"]], "%")}
        {chart("Pending backlog", "Open items where status is captured", [["pending", "Pending", "#f59e0b"]])}
        {chart("Avg handling time", "Minutes, from source Duration", [["avgTatMin", "Avg minutes", "#64748b"]])}
      </Grid>
      <Box title="LOB comparison table" sub="Same period and filters as each LOB section" style={{ marginTop: 10 }}>
        <SimpleTable rows={rows} cols={[
          { h: "LOB", get: r => r.label, left: true },
          { h: "Unit", get: r => r.unit, left: true },
          { h: "Received", get: r => fmtCount(r.received) },
          { h: "Processed", get: r => fmtCount(r.processed) },
          { h: "Pending", get: r => fmtCount(r.pending) },
          { h: "Closure %", get: r => fmtPct(r.closurePct) },
          { h: "Within SLA %", get: r => fmtPct(r.withinSlaPct) },
          { h: "Avg TAT", get: r => fmtMinutes(r.avgTatMin) },
          { h: "Per analyst-day", get: r => fmtDec(r.productivity) },
        ]} />
      </Box>
    </div>
  );
}

function Reconciliation({ rows }: { rows: Gs1ReconRow[] }) {
  const ok = rows.every(r => r.ok);
  return (
    <Box title="Reconciliation" sub={ok ? "All checks match" : "Mismatch found"}>
      <SimpleTable rows={rows} cols={[
        { h: "Check", get: r => r.check, left: true },
        { h: "Expected", get: r => fmtCount(r.expected) },
        { h: "Actual", get: r => fmtCount(r.actual) },
        { h: "Difference", get: r => fmtCount(r.diff) },
        { h: "Result", get: r => <strong style={{ color: r.ok ? "#047857" : "#be123c" }}>{r.ok ? "Match" : "Mismatch"}</strong> },
      ]} />
    </Box>
  );
}

function DataQuality({ rows }: { rows: Gs1DqRow[] }) {
  const issues = rows.filter(r => r.severity === "error" || r.severity === "warn").length;
  return (
    <Box title="Data quality exceptions" sub={issues ? `${issues} check(s) need attention` : "No exceptions"}>
      <SimpleTable rows={rows} cols={[
        { h: "LOB", get: r => r.lob, left: true },
        { h: "Check", get: r => r.check, left: true },
        { h: "Items", get: r => fmtCount(r.count) },
        { h: "Status", get: r => <strong style={{ color: SEV_COLOR[r.severity] }}>{r.severity === "ok" ? "OK" : r.severity.toUpperCase()}</strong> },
        { h: "Note", get: r => <span style={{ whiteSpace: "normal", display: "inline-block", maxWidth: 360, textAlign: "left" }}>{r.note}</span>, left: true },
      ]} />
    </Box>
  );
}

export function Gs1Dashboard({ from, to }: { from: string; to: string }) {
  const [view, setView] = useState<View>("overview");
  const [analyst, setAnalyst] = useState("");
  const [lob, setLob] = useState<"" | Gs1LobKey>("");
  const params: Record<string, string> = { from, to };
  if (analyst) params.analyst = analyst;
  if (lob) params.lob = lob;
  const q = useQuery({ queryKey: ["pld", "gs1", "dashboard", params], queryFn: () => fetchGs1(params), staleTime: 2 * 60 * 1000 });

  const pickView = (v: View) => { setView(v); if (v !== "overview") setLob(""); };
  const d = q.data;
  const o = d?.overall;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {VIEWS.map(v => (
          <button key={v.key} onClick={() => pickView(v.key)} style={{ height: 30, border: "none", borderRadius: 8, padding: "0 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", background: view === v.key ? "linear-gradient(135deg,#153f69,#2673a0)" : "#edf3f9", color: view === v.key ? "#fff" : "#334155" }}>{v.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        {view === "overview" && (
          <label style={{ fontSize: 11, fontWeight: 700, color: "#52667a" }}>LOB{" "}
            <select aria-label="LOB filter" value={lob} onChange={e => setLob(e.target.value as "" | Gs1LobKey)} style={selectStyle}>
              <option value="">All LOBs</option>
              <option value="email">Email</option>
              <option value="dataCard">Data Card</option>
              <option value="approval">Approval</option>
            </select>
          </label>
        )}
        <label style={{ fontSize: 11, fontWeight: 700, color: "#52667a" }}>Agent / analyst{" "}
          <select aria-label="Analyst filter" value={analyst} onChange={e => setAnalyst(e.target.value)} style={selectStyle}>
            <option value="">All analysts</option>
            {analyst && !d?.filterOptions.analysts.includes(analyst) && <option value={analyst}>{analyst}</option>}
            {(d?.filterOptions.analysts ?? []).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <span title={d?.teamFilter.reason} style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>Team: N/A</span>
      </div>

      {q.isLoading ? <Note>Loading GS1 dashboard...</Note>
        : q.error || !d || !o ? <Note tone="warn">Failed to load the GS1 dashboard. Try refreshing.</Note>
        : (
          <div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "#52667a", fontWeight: 700, marginBottom: 8 }}>
              <span>Last Refresh (latest import): <strong style={{ color: "#102f4b" }}>{fmtStamp(d.lastRefresh.latest)}</strong></span>
              <span>Email {fmtStamp(d.lastRefresh.email)} | Data Card {fmtStamp(d.lastRefresh.dataCard)} | Approval {fmtStamp(d.lastRefresh.approval)}</span>
              <span>Generated {fmtStamp(d.generatedAt)}</span>
            </div>

            {view === "overview" && (
              <div>
                <Grid min={150}>
                  <Kpi label="Total work items" value={fmtCount(o.received, o.hasData)} sub="Email + Data Card + Approval" />
                  <Kpi label="Processed / closed" value={fmtCount(o.processed, o.hasData)} sub="LOBs with status data" />
                  <Kpi label="Pending" value={fmtCount(o.pending, o.hasData)} />
                  <Kpi label="Closure %" value={fmtPct(o.closurePct, o.hasData)} sub={o.closureBasis} />
                  <Kpi label="LOBs with data" value={o.hasData ? String(o.lobsWithData) : "No Data"} />
                  <Kpi label="Analysts" value={fmtCount(o.analysts, o.hasData)} />
                </Grid>
                <Note>{o.unitNote}</Note>
                {!o.hasData && <Note tone="warn">No GS1 data for {d.period.from} to {d.period.to}. Upload via Bulk Upload Hub: GS1_EMAIL_DAILY, GS1_DATAKART_DAILY, GS1_APPROVAL_AUDIT.</Note>}
                {d.lobs.email && <Section title="Email" color={LOB_COLOR.email} right={<button onClick={() => pickView("email")} style={linkBtn}>Open Email detail</button>}><EmailView d={d.lobs.email} compact tatNote={d.tatBucketNote} /></Section>}
                {d.lobs.dataCard && <Section title="Data Card" color={LOB_COLOR.dataCard} right={<button onClick={() => pickView("dataCard")} style={linkBtn}>Open Data Card detail</button>}><DataCardView d={d.lobs.dataCard} compact tatNote={d.tatBucketNote} /></Section>}
                {d.lobs.approval && <Section title="Approval" color={LOB_COLOR.approval} right={<button onClick={() => pickView("approval")} style={linkBtn}>Open Approval detail</button>}><ApprovalView d={d.lobs.approval} compact tatNote={d.tatBucketNote} /></Section>}
                <Section title="LOB comparison" color="#334155"><Comparison {...d.comparison} /></Section>
                <Grid min={420}>
                  <Reconciliation rows={d.reconciliation} />
                  <DataQuality rows={d.dataQuality} />
                </Grid>
                <Note>{d.tatBucketNote}</Note>
              </div>
            )}
            {view === "email" && (d.lobs.email ? <EmailView d={d.lobs.email} tatNote={d.tatBucketNote} /> : <Note>Email is filtered out.</Note>)}
            {view === "dataCard" && (d.lobs.dataCard ? <DataCardView d={d.lobs.dataCard} tatNote={d.tatBucketNote} /> : <Note>Data Card is filtered out.</Note>)}
            {view === "approval" && (d.lobs.approval ? <ApprovalView d={d.lobs.approval} tatNote={d.tatBucketNote} /> : <Note>Approval is filtered out.</Note>)}
            {view !== "overview" && <div style={{ marginTop: 12 }}><DataQuality rows={d.dataQuality.filter(r => r.lob === VIEWS.find(v => v.key === view)?.label || r.lob === "All")} /></div>}
          </div>
        )}
    </div>
  );
}

const linkBtn: React.CSSProperties = { height: 26, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", background: "#fff", color: "#153f69" };
