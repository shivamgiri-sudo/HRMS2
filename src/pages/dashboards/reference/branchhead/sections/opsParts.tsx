import { Activity, Clock3, Gauge, ShieldCheck, Timer, TrendingUp } from "lucide-react";
import type { OpsProcessRow, QualityRow } from "../../../../../../backend/src/modules/branch-head-health/ops";
import type { SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { BarListProps, TableSpec } from "../viz";
import { formatCount, formatPct } from "../format";
import { BarCell, ChartCard, Chip, GradientKpi, KpiCell, KpiGrid, NavyTable, type ChipTone } from "../look";
import type { DrillTarget } from "../drill";
import { num } from "./OpsHeatGrid";

/** QA quality bands for the severity colour and chip (no per-process target exists in the payload). */
export const QA_TARGET = 85;
export const QA_FLOOR = 75;

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const okRows = <T,>(s?: SectionResult<unknown>): T[] => (s?.status === "ok" && Array.isArray(s.data) ? (s.data as T[]) : []);

export type QaBand = { word: "On target" | "Below target" | "Critical" | "No score"; tone: ChipTone; color: string };

/** Severity of one QA score: green at or above target, amber to the floor, red below it. */
export function qaBand(v: number | null | undefined): QaBand {
  if (!fin(v)) return { word: "No score", tone: "mute", color: "#898781" };
  if (v >= QA_TARGET) return { word: "On target", tone: "ok", color: "#0ca30c" };
  if (v >= QA_FLOOR) return { word: "Below target", tone: "warn", color: "#fab219" };
  return { word: "Critical", tone: "crit", color: "#d03b3b" };
}

/** Lowest score first; a missing score sorts last (never as 0). */
export function sortQuality(rows: QualityRow[]): QualityRow[] {
  return [...rows].sort((a, b) => (fin(a.QA_QUALITY_PCT) ? a.QA_QUALITY_PCT : Infinity) - (fin(b.QA_QUALITY_PCT) ? b.QA_QUALITY_PCT : Infinity));
}

/** Quality as BarList props (the process drawer's compact view). A missing score stays NaN (no bar, "—"), never 0. */
export function qualityBars(rows: QualityRow[]): BarListProps {
  return {
    label: "Lowest QA quality processes, lowest first",
    format: formatPct,
    max: 100,
    items: rows.map((r, i) => ({
      id: `r${i}`, label: r.processName, value: fin(r.QA_QUALITY_PCT) ? r.QA_QUALITY_PCT : Number.NaN,
      note: r.stale ? `Stale, latest ${r.latestDate ?? "—"}` : `Latest ${r.latestDate ?? "—"}`,
    })),
  };
}

/** Table twin of the quality table: the same rows, as text. */
export function qualityTable(rows: QualityRow[]): TableSpec {
  return {
    caption: "Lowest QA quality processes, lowest first",
    columns: ["Process", "QA quality %", "Status", "Latest", "Freshness"],
    rows: sortQuality(rows).map((r) => [r.processName, formatPct(r.QA_QUALITY_PCT), qaBand(r.QA_QUALITY_PCT).word, r.latestDate ?? "—", r.stale ? "Stale" : "Current"]),
  };
}

export const FreshChip = ({ date, stale }: { date: string | null; stale: boolean }) => (
  <Chip tone={stale ? "warn" : "mute"}>{stale ? <Clock3 className="h-3 w-3" aria-hidden="true" /> : null}{stale ? `Stale · ${date ?? "—"}` : date ?? "No data"}</Chip>
);

/** Quality per process as a navy table with a severity-coloured bar and the status as words. */
export function QualityCard({ rows, asOf, onProcess }: { rows: QualityRow[]; asOf?: string; onProcess: (name: string) => void }) {
  const sorted = sortQuality(rows);
  const below = sorted.filter((r) => fin(r.QA_QUALITY_PCT) && r.QA_QUALITY_PCT < QA_TARGET).length;
  return (
    <ChartCard title="Lowest quality processes" accent="violet" table={qualityTable(rows)}
      chip={`${formatCount(below)} of ${formatCount(sorted.length)} below ${QA_TARGET}%${asOf ? ` · As of ${asOf}` : ""}`}>
      <NavyTable<QualityRow> caption={`QA quality %, lowest first; target ${QA_TARGET}%, critical below ${QA_FLOOR}%`} rows={sorted} limit={10}
        onRowClick={(r) => onProcess(r.processName)} rowLabel={(r) => r.processName}
        columns={[
          { key: "p", label: "Process", render: (r) => <span className="font-semibold">{r.processName}</span> },
          { key: "q", label: "QA quality %", render: (r) => <BarCell pct={fin(r.QA_QUALITY_PCT) ? r.QA_QUALITY_PCT : null} text={formatPct(r.QA_QUALITY_PCT)} color={qaBand(r.QA_QUALITY_PCT).color} /> },
          { key: "s", label: "Status", render: (r) => { const b = qaBand(r.QA_QUALITY_PCT); return <Chip tone={b.tone}>{b.word}</Chip>; } },
          { key: "d", label: "Latest data", render: (r) => <FreshChip date={r.latestDate} stale={r.stale} /> },
        ]} />
      <p className="bhl-note">Green at or above {QA_TARGET}%, amber {QA_FLOOR} to {QA_TARGET}%, red below {QA_FLOOR}%.</p>
    </ChartCard>
  );
}

/** Headline numbers for the Operations tab, from operations rows (quality rows as the QA fallback) and Callmaster. */
export function opsKpis(operations?: SectionResult<unknown>, quality?: SectionResult<unknown>) {
  const ops = okRows<OpsProcessRow>(operations);
  const reporting = ops.filter((r) => Object.values(r.metrics ?? {}).some(fin));
  const qaOps = ops.map((r) => r.metrics?.QA_QUALITY_PCT).filter(fin);
  const qa = mean(qaOps.length ? qaOps : okRows<QualityRow>(quality).map((r) => r.QA_QUALITY_PCT).filter(fin));
  return {
    total: ops.length,
    reporting: reporting.length,
    avgQa: qa,
    avgAht: mean(ops.map((r) => r.metrics?.AHT).filter(fin)),
    stale: ops.filter((r) => r.stale).length,
    baseline: ops.filter((r) => r.tier === "baseline").length,
  };
}

/** Row of gradient tiles; each opens the operations drill. Warnings are words + icon on the tile. */
export function OpsKpiTiles({ k, onSelect }: { k: ReturnType<typeof opsKpis>; onSelect: (t: DrillTarget) => void }) {
  const open = () => onSelect({ kind: "metric", id: "ops" });
  const qa = qaBand(k.avgQa);
  return (
    <KpiGrid label="Operations summary" cols={5}>
      <KpiCell><GradientKpi icon={Activity} hue="navy" label="Processes reporting" value={formatCount(k.reporting)} sub={`of ${formatCount(k.total)} processes with metrics`} onClick={open} /></KpiCell>
      <KpiCell><GradientKpi icon={ShieldCheck} hue="emerald" label="Average QA %" value={formatPct(k.avgQa)} sub={k.avgQa == null ? "No QA scores yet" : `${qa.word} (target ${QA_TARGET}%)`}
        status={qa.tone === "crit" ? "critical" : qa.tone === "warn" ? "warning" : null} onClick={open} /></KpiCell>
      <KpiCell><GradientKpi icon={Timer} hue="cyan" label="Average AHT" value={num(k.avgAht)} sub="Mean across reporting processes" onClick={open} /></KpiCell>
      <KpiCell><GradientKpi icon={Clock3} hue="amber" label="Stale data" value={formatCount(k.stale)} sub={k.stale ? "No new data in 14+ days" : "All processes current"}
        status={k.stale > 0 ? "warning" : null} onClick={open} /></KpiCell>
      <KpiCell><GradientKpi icon={k.baseline ? Gauge : TrendingUp} hue="violet" label="Baseline only" value={formatCount(k.baseline)} sub={k.baseline ? "Headcount only, no quality or sales feed" : "Every process has a feed"}
        status={k.baseline > 0 ? "warning" : null} onClick={open} /></KpiCell>
    </KpiGrid>
  );
}
