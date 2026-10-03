import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { qualityPctStyle } from "../onfidoReportShared";

/**
 * Quality tab bodies for the Overall / Internal / External scopes.
 * Internal numbers come only from the internal audit tables and external numbers only
 * from the external ones (backend: onfido-quality-pages.service.ts); only "overall"
 * renders the two sides together. A stage with no source for a side shows N/A, never 0.
 */

export type QualityPageScope = "overall" | "internal" | "external";
type Side = "internal" | "external";
type Gran = "daily" | "weekly" | "monthly";

interface StageCell {
  key: string; label: string; available: boolean;
  errors: number | null; audits: number | null; errorPct: number | null;
}
interface SideSummary {
  audits: number; errors: number; errorPct: number | null;
  poaAudits: number; poaErrors: number; stages: StageCell[];
}
interface TrendPoint { bucket: string; audits: number; errors: number; pct: Record<string, number | null> }
interface BreakdownRow { label: string; audits: number; errors: number; errorPct: number | null }
interface AnalystRow { analyst: string; tlName: string; group: string; audits: number; errors: number; errorPct: number | null }

export interface QualityPageProps {
  scope: QualityPageScope;
  range: { from: string; to: string };
  tlFilter: string;
  amFilter: string;
  analystFilter?: string;
  /** Row click on an external breakdown whose dimension is a real column on the audit table. */
  onDrill?: (column: string, label: string) => void;
}

const EXTERNAL_DRILL_COLUMN: Record<string, string | undefined> = {
  client: "ims_client_name", documentType: "docupedia_document_name", tl: "tl_name", am: "am_name",
};

function qs(p: QualityPageProps): string {
  return `from=${p.range.from}&to=${p.range.to}`
    + (p.tlFilter ? `&tlName=${encodeURIComponent(p.tlFilter)}` : "")
    + (p.amFilter ? `&amName=${encodeURIComponent(p.amFilter)}` : "")
    + (p.analystFilter ? `&analystEmail=${encodeURIComponent(p.analystFilter)}` : "");
}
function key(p: QualityPageProps) { return [p.range.from, p.range.to, p.tlFilter, p.amFilter, p.analystFilter ?? ""]; }

const fmtInt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-IN"));
const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);

function PctCell({ cell }: { cell?: StageCell }) {
  if (!cell || !cell.available) return <td className="oc-right" style={{ color: "var(--muted)" }}>N/A</td>;
  return <td className="oc-right" style={qualityPctStyle(cell.errorPct)}>{fmtPct(cell.errorPct)}</td>;
}

function Pills<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="oc-pillbar">
      {options.map((o) => (
        <button key={o.key} className={o.key === value ? "oc-pill-btn active" : "oc-pill-btn"} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

function Card({ title, sub, right, hc, children }: { title: string; sub?: string; right?: ReactNode; hc?: string; children: ReactNode }) {
  return (
    <div className="oc-card" style={{ "--hc": hc ?? "var(--purple)" } as CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 style={{ marginBottom: 0 }}>{title}</h3>
          {sub && <div className="oc-card-sub">{sub}</div>}
        </div>
        {right}
      </div>
      <div style={{ overflowX: "auto", marginTop: 8 }}>{children}</div>
    </div>
  );
}

/** Compact KPI tile: small label and value, no oversized cells. */
function QKpi({ label, value, pct, note, kc }: { label: string; value: string; pct?: number | null; note?: string; kc: string }) {
  const fill = pct !== undefined && pct !== null ? qualityPctStyle(pct) : undefined;
  return (
    <div className="kpi" style={{ "--kc": kc, padding: "8px 12px", minHeight: 0 } as CSSProperties}>
      <label style={{ fontSize: 11 }}>{label}</label>
      <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
        {fill ? <span style={{ ...fill, display: "inline-block", padding: "0 8px", borderRadius: 4 }}>{value}</span> : value}
      </div>
      {note && <div style={{ fontSize: 10, color: "var(--muted)" }}>{note}</div>}
    </div>
  );
}

function KpiGrid({ children, cols }: { children: ReactNode; cols: number }) {
  return <div className="kr" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>{children}</div>;
}

function useSummary(side: Side, p: QualityPageProps, enabled: boolean) {
  return useQuery({
    queryKey: ["onfido-process", "qp-summary", side, ...key(p)],
    enabled,
    queryFn: () => hrmsApi.get<{ data: SideSummary }>(`/api/onfido-process/quality-pages/summary/${side}?${qs(p)}`),
  });
}

const stageOf = (s: SideSummary | undefined, k: string) => s?.stages.find((c) => c.key === k);
const pctOf = (s: SideSummary | undefined, k: string) => stageOf(s, k)?.errorPct ?? null;
const errNote = (e: number | null | undefined, a: number | null | undefined) => (e === null || e === undefined || a === null || a === undefined ? undefined : `${fmtInt(e)} of ${fmtInt(a)}`);

// ── Scorecards ──────────────────────────────────────────────────────────────

function ScorecardOverall({ internal, external }: { internal?: SideSummary; external?: SideSummary }) {
  const rows = (internal ?? external)?.stages ?? [];
  return (
    <Card title="Quality Scorecard — Internal vs External" sub="Same stage side by side; N/A = that side has no data source for the stage." hc="var(--red)">
      <table className="oc-table">
        <thead>
          <tr>
            <th rowSpan={2}>Stage</th>
            <th colSpan={3} className="oc-right">Internal</th>
            <th colSpan={3} className="oc-right">External</th>
          </tr>
          <tr>
            <th className="oc-right">Errors</th><th className="oc-right">Audits</th><th className="oc-right">Error %</th>
            <th className="oc-right">Errors</th><th className="oc-right">Audits</th><th className="oc-right">Error %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const i = stageOf(internal, r.key);
            const e = stageOf(external, r.key);
            return (
              <tr key={r.key}>
                <td style={{ fontWeight: 600 }}>{r.label}</td>
                <td className="oc-right">{i?.available ? fmtInt(i.errors) : "N/A"}</td>
                <td className="oc-right">{i?.available ? fmtInt(i.audits) : "N/A"}</td>
                <PctCell cell={i} />
                <td className="oc-right">{e?.available ? fmtInt(e.errors) : "N/A"}</td>
                <td className="oc-right">{e?.available ? fmtInt(e.audits) : "N/A"}</td>
                <PctCell cell={e} />
              </tr>
            );
          })}
          {rows.length === 0 && <tr className="oc-empty-row"><td colSpan={7}>No data</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

function ScorecardSide({ side, summary }: { side: Side; summary?: SideSummary }) {
  const label = side === "internal" ? "Internal" : "External";
  return (
    <Card title={`Quality Scorecard — ${label} Error by Stage`} sub={`${label} audit data only. N/A = no ${side} data source for the stage.`} hc="var(--red)">
      <table className="oc-table">
        <thead><tr><th>Stage</th><th className="oc-right">Errors</th><th className="oc-right">Audits</th><th className="oc-right">{label} Error %</th></tr></thead>
        <tbody>
          {(summary?.stages ?? []).map((c) => (
            <tr key={c.key}>
              <td style={{ fontWeight: 600 }}>{c.label}</td>
              <td className="oc-right">{c.available ? fmtInt(c.errors) : "N/A"}</td>
              <td className="oc-right">{c.available ? fmtInt(c.audits) : "N/A"}</td>
              <PctCell cell={c} />
            </tr>
          ))}
          {!summary && <tr className="oc-empty-row"><td colSpan={4}>No data</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

// ── Monthly trend (one independent section per side) ────────────────────────

const TREND_ROWS: { key: string; label: string }[] = [
  { key: "overall", label: "Overall Error %" },
  { key: "extraction", label: "Extraction Error %" },
  { key: "rawExtraction", label: "Raw / EWS Extraction Error %" },
  { key: "labelling", label: "Labeling Error %" },
  { key: "classification", label: "Classification Error %" },
];

function SideTrend({ side, p }: { side: Side; p: QualityPageProps }) {
  const [gran, setGran] = useState<Gran>("monthly");
  const label = side === "internal" ? "Internal" : "External";
  const q = useQuery({
    queryKey: ["onfido-process", "qp-trend", side, gran, ...key(p)],
    queryFn: () => hrmsApi.get<{ data: TrendPoint[] }>(`/api/onfido-process/quality-pages/trend/${side}?${qs(p)}&granularity=${gran}`),
  });
  const pts = q.data?.data ?? [];
  const rows = TREND_ROWS.filter((r) => !(side === "external" && r.key === "labelling"));
  return (
    <Card
      title={`${label} ${gran[0].toUpperCase()}${gran.slice(1)} Trend`}
      sub={`${label} audits only.`}
      right={<Pills<Gran> value={gran} onChange={setGran} options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]} />}
    >
      {pts.length === 0 ? (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>{q.isLoading ? "Loading…" : "No data in this range."}</div>
      ) : (
        <table className="oc-table">
          <thead><tr><th style={{ minWidth: 180 }}>Metric</th>{pts.map((x) => <th key={x.bucket} className="oc-right">{x.bucket}</th>)}</tr></thead>
          <tbody>
            <tr><td style={{ fontWeight: 600 }}>Audits</td>{pts.map((x) => <td key={x.bucket} className="oc-right">{fmtInt(x.audits)}</td>)}</tr>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ fontWeight: 600 }}>{r.label}</td>
                {pts.map((x) => <td key={x.bucket} className="oc-right" style={qualityPctStyle(x.pct[r.key])}>{fmtPct(x.pct[r.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Breakdown ───────────────────────────────────────────────────────────────

type Dim = "client" | "documentType" | "taskType" | "tl" | "am";
const DIM_LABEL: Record<Dim, string> = { client: "Client", documentType: "Document Type", taskType: "Task Type", tl: "TL", am: "AM" };

function SideBreakdown({ side, p, dims }: { side: Side; p: QualityPageProps; dims: Dim[] }) {
  const [dim, setDim] = useState<Dim>(dims[0]);
  const q = useQuery({
    queryKey: ["onfido-process", "qp-breakdown", side, dim, ...key(p)],
    queryFn: () => hrmsApi.get<{ data: BreakdownRow[] }>(`/api/onfido-process/quality-pages/breakdown/${side}/${dim}?${qs(p)}`),
  });
  const rows = q.data?.data ?? [];
  const drillCol = side === "external" ? EXTERNAL_DRILL_COLUMN[dim] : undefined;
  const unit = side === "internal" ? "Audits" : "Tasks / Audits";
  return (
    <Card
      title="Breakdown"
      sub={`${side === "internal" ? "Internal" : "External"} audits only. Top 100 by volume.`}
      hc="var(--teal)"
      right={<Pills<Dim> value={dim} onChange={setDim} options={dims.map((d) => ({ key: d, label: `${DIM_LABEL[d]} Wise` }))} />}
    >
      <table className="oc-table">
        <thead><tr><th>{DIM_LABEL[dim]}</th><th className="oc-right">{unit}</th><th className="oc-right">Errors</th><th className="oc-right">Error %</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>{q.isLoading ? "Loading…" : "No data"}</td></tr>}
          {rows.map((r) => (
            <tr key={r.label} className={drillCol && p.onDrill ? "oc-row-click" : undefined} onClick={drillCol && p.onDrill ? () => p.onDrill!(drillCol, r.label) : undefined}>
              <td>{r.label}</td>
              <td className="oc-right">{fmtInt(r.audits)}</td>
              <td className="oc-right">{fmtInt(r.errors)}</td>
              <td className="oc-right" style={qualityPctStyle(r.errorPct)}>{fmtPct(r.errorPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Internal analyst quality score ──────────────────────────────────────────

type AMode = "daily" | "weekly" | "monthly" | "document" | "client" | "documentType" | "taskType";
const AMODE_LABEL: Record<AMode, string> = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly", document: "Document Wise",
  client: "Client Wise", documentType: "Document Type Wise", taskType: "Task Type Wise",
};
const AMODE_COL: Record<AMode, string> = {
  daily: "Date", weekly: "Week", monthly: "Month", document: "Document (task URL)",
  client: "Client", documentType: "Document Type", taskType: "Task Type",
};

function InternalAnalystScore({ p }: { p: QualityPageProps }) {
  const [mode, setMode] = useState<AMode>("monthly");
  const q = useQuery({
    queryKey: ["onfido-process", "qp-int-analyst", mode, ...key(p)],
    queryFn: () => hrmsApi.get<{ data: AnalystRow[] }>(`/api/onfido-process/quality-pages/internal-analyst?${qs(p)}&mode=${mode}`),
  });
  const rows = q.data?.data ?? [];
  return (
    <Card
      title="Analyst Quality Score"
      sub="Internal audits only. Up to 1,000 rows."
      right={<Pills<AMode> value={mode} onChange={setMode} options={(Object.keys(AMODE_LABEL) as AMode[]).map((k) => ({ key: k, label: AMODE_LABEL[k] }))} />}
    >
      <table className="oc-table">
        <thead>
          <tr><th>Analyst</th><th>TL</th><th>{AMODE_COL[mode]}</th><th className="oc-right">Audits</th><th className="oc-right">Errors</th><th className="oc-right">Error %</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr className="oc-empty-row"><td colSpan={6}>{q.isLoading ? "Loading…" : "No data in this range"}</td></tr>}
          {rows.map((r, i) => (
            <tr key={`${r.analyst}|${r.group}|${i}`}>
              <td>{r.analyst}</td><td>{r.tlName}</td>
              <td style={mode === "document" ? { maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : undefined}>{r.group}</td>
              <td className="oc-right">{fmtInt(r.audits)}</td>
              <td className="oc-right">{fmtInt(r.errors)}</td>
              <td className="oc-right" style={qualityPctStyle(r.errorPct)}>{fmtPct(r.errorPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--muted)" }}>
        Conditional formatting: Green = ≤0.75% · Amber = 0.75–1% · Red = &gt;1%
      </div>
    </Card>
  );
}

// ── Page bodies ─────────────────────────────────────────────────────────────

export function QualityPagesBody(p: QualityPageProps) {
  const wantInt = p.scope !== "external";
  const wantExt = p.scope !== "internal";
  const intQ = useSummary("internal", p, wantInt);
  const extQ = useSummary("external", p, wantExt);
  const i = intQ.data?.data;
  const e = extQ.data?.data;

  if (p.scope === "overall") {
    return (
      <div className="space-y-4">
        <KpiGrid cols={6}>
          <QKpi kc="var(--purple)" label="Internal Audits" value={fmtInt(i?.audits)} note={i ? `${fmtInt(i.errors)} errors` : undefined} />
          <QKpi kc="var(--blue)" label="External Audits" value={fmtInt(e?.audits)} note={e ? `${fmtInt(e.errors)} errors` : undefined} />
          <QKpi kc="var(--purple)" label="Internal Overall Error" value={fmtPct(i?.errorPct)} pct={i?.errorPct} note={errNote(i?.errors, i?.audits)} />
          <QKpi kc="var(--red)" label="External Overall Error" value={fmtPct(e?.errorPct)} pct={e?.errorPct} note={errNote(e?.errors, e?.audits)} />
          <QKpi kc="var(--orange)" label="External Extraction Error" value={fmtPct(pctOf(e, "extraction"))} pct={pctOf(e, "extraction")} note={errNote(stageOf(e, "extraction")?.errors, stageOf(e, "extraction")?.audits)} />
          <QKpi kc="var(--teal)" label="External Raw/EWS Extraction Error" value={fmtPct(pctOf(e, "rawExtraction"))} pct={pctOf(e, "rawExtraction")} note={errNote(stageOf(e, "rawExtraction")?.errors, stageOf(e, "rawExtraction")?.audits)} />
        </KpiGrid>
        <ScorecardOverall internal={i} external={e} />
        <SideTrend side="internal" p={p} />
        <SideTrend side="external" p={p} />
      </div>
    );
  }

  if (p.scope === "internal") {
    return (
      <div className="space-y-4">
        <KpiGrid cols={6}>
          <QKpi kc="var(--purple)" label="Total Internal Audits" value={fmtInt(i?.audits)} />
          <QKpi kc="var(--red)" label="Total Internal Errors" value={fmtInt(i?.errors)} pct={undefined} note={i ? `${fmtPct(i.errorPct)} error` : undefined} />
          <QKpi kc="var(--teal)" label="Internal POA Audits" value={fmtInt(i?.poaAudits)} />
          <QKpi kc="var(--orange)" label="Internal POA Errors" value={fmtInt(i?.poaErrors)} />
          <QKpi kc="var(--blue)" label="Internal Extraction Error" value={fmtPct(pctOf(i, "extraction"))} pct={pctOf(i, "extraction")} note={errNote(stageOf(i, "extraction")?.errors, stageOf(i, "extraction")?.audits)} />
          <QKpi kc="var(--pink, var(--purple))" label="Internal Raw Extraction Error" value={fmtPct(pctOf(i, "rawExtraction"))} pct={pctOf(i, "rawExtraction")} note={errNote(stageOf(i, "rawExtraction")?.errors, stageOf(i, "rawExtraction")?.audits)} />
        </KpiGrid>
        <ScorecardSide side="internal" summary={i} />
        <SideTrend side="internal" p={p} />
        <InternalAnalystScore p={p} />
        <SideBreakdown side="internal" p={p} dims={["client", "documentType", "taskType", "tl", "am"]} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <KpiGrid cols={4}>
        <QKpi kc="var(--blue)" label="Total Audited" value={fmtInt(e?.audits)} />
        <QKpi kc="var(--red)" label="Overall Error" value={fmtPct(e?.errorPct)} pct={e?.errorPct} note={errNote(e?.errors, e?.audits)} />
        <QKpi kc="var(--orange)" label="Extraction Error %" value={fmtPct(pctOf(e, "extraction"))} pct={pctOf(e, "extraction")} note={errNote(stageOf(e, "extraction")?.errors, stageOf(e, "extraction")?.audits)} />
        <QKpi kc="var(--teal)" label="EWS / Raw Extraction Error %" value={fmtPct(pctOf(e, "rawExtraction"))} pct={pctOf(e, "rawExtraction")} note={errNote(stageOf(e, "rawExtraction")?.errors, stageOf(e, "rawExtraction")?.audits)} />
      </KpiGrid>
      <ScorecardSide side="external" summary={e} />
      <SideTrend side="external" p={p} />
      <SideBreakdown side="external" p={p} dims={["client", "documentType", "tl", "am", "taskType"]} />
    </div>
  );
}
