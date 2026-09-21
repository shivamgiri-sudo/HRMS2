import type { ReactNode } from "react";
import { formatINR } from "./DashboardKit";
import { fmtN } from "./lpCallShared";

/** Shapes mirror backend/src/modules/process-performance/appreciate-wealth-dashboard.service.ts. */

export type Fmt = "count" | "pct" | "hrs" | "secs" | "inr" | "dec";
export interface PeriodColumn { key: string; label: string; kind: "total" | "week" | "day"; from: string; to: string }
export interface GridRow { label: string; fmt: Fmt; values: Array<number | null>; bold?: boolean }
export interface Grid { id: string; slide: string; title: string; rows: GridRow[]; note?: string; drill?: string }

export interface Filters {
  segment: string; billingType: string; inCallType: string; inCampaign: string; cdrCallType: string; cdrCampaign: string;
}
export const ALL = "All";
export const DEFAULT_FILTERS: Filters = { segment: ALL, billingType: ALL, inCallType: ALL, inCampaign: ALL, cdrCallType: ALL, cdrCampaign: ALL };

export interface Coverage {
  source: string; table: string; rangeRows: number; uniqueRows: number; duplicatesDropped: number; firstDate: string | null; lastDate: string | null;
  daysWithData: number; unparsedDates: number; serialDateRows: number; textDateRows: number; latestUpload: string | null;
}
export interface GroupRow { name: string; agents?: number; agentDays: number; calls: number; connected: number; connectPct: number; netHrs: number; acht: number | null; netOccPct: number | null; latePct: number; breakPct: number; attainPct: number | null; agentId?: string }
export interface CallGroupRow { name: string; calls: number; answered: number; unanswered: number; answerPct: number; avgTalk: number | null; avgHandling: number | null; talkHrs: number }
export interface CallLite { id: number; date: string; startS: number | null; callType: string; campaign: string; agent: string; status: string; disposition: string; talkS: number; callerNo: string }

export interface DashboardData {
  from: string; to: string; generatedAt: string;
  options: { segments: string[]; billingTypes: string[]; inCallTypes: string[]; inCampaigns: string[]; cdrCallTypes: string[]; cdrCampaigns: string[] };
  columns: PeriodColumn[]; dailyColumnsOmitted: boolean;
  overview: {
    kpis: {
      agentDays: number; agents: number; calls: number; connected: number; connectPct: number | null; netLoginHrs: number; acht: number | null; netOccPct: number | null; latePct: number | null;
      inboundOffered: number; inboundAnswered: number; inboundAnswerPct: number | null; dialerLegs: number; dialerAnswered: number; dialerConnectPct: number | null;
      lrsA: number; trA: number; mfA: number; salesTotal: number; contractValue: number; mandateMonths: number;
    };
    daily: Array<{ date: string; agentDays: number; calls: number; connected: number; inbound: number; outbound: number; sales: number; lrsA: number; trA: number; mfA: number }>;
    segmentMix: Array<{ segment: string; agentDays: number; agents: number; netHrs: number; calls: number }>;
    coverage: Coverage[];
  };
  billing: {
    kpis: {
      agentDays: number; agents: number; calls: number; connected: number; connectPct: number | null; talkHrs: number; netLoginHrs: number; loginHrs: number; acht: number | null;
      occupancyPct: number | null; netOccupancyPct: number | null; latePct: number | null; breakPct: number | null; callsPerNetHr: number | null; attainPct: number | null; breakExceedDays: number;
    };
    daily: Array<{ date: string; agentDays: number; calls: number; connected: number; netHrs: number; connectPct: number; bySegment: Record<string, number>; netBySegment: Record<string, number> }>;
    weekly: Array<{ week: string; from: string; to: string; agentDays: number; calls: number; connected: number; netHrs: number; connectPct: number; latePct: number }>;
    bySegment: GroupRow[]; byBillingType: GroupRow[]; byAgent: GroupRow[];
    aux: Array<{ code: string; label: string; hours: number }>;
    days: Array<{ id: number; date: string; agentId: string; agent: string; segment: string; billingType: string; calls: number; connected: number; netHrs: number; late: boolean }>;
    daysTruncated: boolean;
  };
  mandate: {
    table: Array<{
      id: number; month: string; billingType: string; mandate: number; rate: number; hoursPerFte: number | null; contractValue: number; mandatedHrs: number | null; deliveredHrs: number;
      hoursDeliveredPct: number | null; fteEq: number | null; agents: number; agentDays: number; daysWithData: number; daysInRange: number; daysInMonth: number;
    }>;
    totals: { mandate: number; contractValue: number; mandatedHrs: number; deliveredHrs: number };
    noMandateMonths: string[];
    history: Array<{ id: number; month: string; monthRaw: string; billingType: string; mandate: number; rate: number; hoursRaw: string; superseded: boolean; insertedAt: string }>;
    deliveredNoMandate: Array<{ month: string; billingType: string; deliveredHrs: number; agentDays: number }>;
  };
  inbound: {
    kpis: {
      calls: number; answered: number; unanswered: number; answerPct: number | null; talkHrs: number; avgTalk: number | null; avgHandling: number | null;
      inboundOffered: number; inboundAnswered: number; inboundAnswerPct: number | null; inboundNoAgent: number; avgQueue: number | null; queueN: number; avgTta: number | null; ttaN: number; uniqueCallers: number;
      repeatCalls: number; repeatPct: number | null;
    };
    daily: Array<{ date: string; calls: number; answered: number; unanswered: number }>;
    byHour: Array<{ hour: number; calls: number; answered: number; answerPct: number }>; hourUnknown: number;
    byCallType: CallGroupRow[]; byCampaign: CallGroupRow[]; bySkill: CallGroupRow[]; byDisposition: CallGroupRow[]; byAgent: CallGroupRow[]; byHangup: CallGroupRow[];
    recent: CallLite[]; recentTruncated: boolean;
  };
  dialer: {
    kpis: {
      legs: number; answered: number; connectPct: number | null; uniqueNumbers: number; uniqueAnswered: number; talkHrs: number; avgTalk: number | null;
      successDispositions: number; callbackDispositions: number; lostDispositions: number; noDispositionLegs: number;
      repeatLegs: number; repeatPct: number | null;
    };
    daily: Array<{ date: string; legs: number; answered: number }>;
    byHour: Array<{ hour: number; legs: number; answered: number; connectPct: number }>; hourUnknown: number;
    byCallType: CallGroupRow[]; byCampaign: CallGroupRow[]; byAgent: CallGroupRow[]; byDisposition: CallGroupRow[]; byHangup: CallGroupRow[];
    byCategory: Array<{ name: string; legs: number; answered: number; sharePct: number }>;
    byReason: Array<{ name: string; legs: number; answered: number }>;
    recent: CallLite[]; recentTruncated: boolean;
  };
  sales: {
    kpis: {
      agentDays: number; agents: number; lrsA: number; lrsC: number; trA: number; trC: number; mfA: number; mfC: number; total: number;
      lrsAttain: number | null; trAttain: number | null; mfAttain: number | null; productivePct: number | null; targetAgentDays: number;
      lrsAov: number | null; trAov: number | null; mfAov: number | null;
    };
    daily: Array<{ date: string; lrsA: number; trA: number; mfA: number; total: number; agentDays: number }>;
    byAgent: Array<{ agentId: string; name: string; agentDays: number; lrsA: number; lrsC: number; trA: number; trC: number; mfA: number; mfC: number; total: number; lrsAttain: number | null; trAttain: number | null; mfAttain: number | null; calls: number; connected: number }>;
    rows: Array<{ id: number; date: string; agentId: string; agent: string; lrsA: number; lrsC: number; trA: number; trC: number; mfA: number; mfC: number; hasTarget: boolean; complete: boolean }>;
    rowsTruncated: boolean; conflicts: number;
  };
  agents: {
    rows: Array<{ agentId: string; name: string; empId: string; segments: string; agentDays: number; calls: number; connected: number; connectPct: number | null; netHrs: number; acht: number | null; netOccPct: number | null; latePct: number | null; lateDays: number; salesTotal: number; salesDays: number }>;
    withoutBilling: number;
  };
  health: {
    coverage: Coverage[];
    duplicates: Array<{ source: string; key: string; raw: number; kept: number; dropped: number }>;
    conflicts: Array<{ date: string; agentId: string; agentName: string; field: string; values: string }>; conflictCount: number;
    reconciliation: Array<{ date: string; outboundReportCalls: number; dialerCdrLegs: number; dialerCoveragePct: number | null; inboundReportCalls: number; inboundCdrLegs: number; inboundCoveragePct: number | null }>;
    multiLegCallIds: { inbound: number; dialer: number }; blankDisposition: { inbound: number; dialer: number }; missingDays: number; notes: string[];
  };
  grids: Grid[];
}

/* ------------------------------ formatting ------------------------------- */

export const fmtInr = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : formatINR(v));
export const fmtPct = (v: number | null | undefined, d = 1): string => (v === null || v === undefined ? "—" : `${(Math.round(v * 10 ** d) / 10 ** d).toFixed(d)}%`);
export const fmtNum = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : fmtN(v));
export const fmtSecs = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${Math.round(v)}s`);
export const fmtHrs = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("en-IN")} h`);
export const hms = (s: number | null | undefined): string => {
  if (s === null || s === undefined) return "—";
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.round(s % 60)).padStart(2, "0")}`;
};
/** ISO timestamp / "YYYY-MM-DD HH:mm:ss" -> DD/MM/YYYY HH:mm (the drill-down mandate's date format). */
export const fmtStamp = (v: string | null | undefined): string => {
  if (!v) return "—";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  const d = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return d ? `${d[3]}/${d[2]}/${d[1]}` : String(v);
};

export function fmtCell(v: number | null, fmt: Fmt): string {
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "count": return fmtN(v);
    case "pct": return `${(Math.round(v * 10) / 10).toFixed(1)}%`;
    case "hrs": return `${(Math.round(v * 10) / 10).toLocaleString("en-IN")}`;
    case "secs": return `${Math.round(v)}`;
    case "inr": return formatINR(v);
    case "dec": return (Math.round(v * 100) / 100).toLocaleString("en-IN");
  }
}

/* ------------------------------- small UI -------------------------------- */

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </section>
  );
}
export const None = () => <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>;

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight text-slate-800">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

export function Note({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" }) {
  return (
    <p className={`rounded-xl border p-3 text-[11px] leading-relaxed ${tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-100 bg-slate-50 text-slate-500"}`}>
      {children}
    </p>
  );
}

export interface Col<T> { key: string; header: string; align?: "left" | "right"; render: (r: T) => ReactNode; className?: string }

/** Every row is clickable (drill-down mandate); rows without a target pass onRow = undefined only for read-only totals. */
export function DataTable<T>({
  cols, rows, onRow, rowKey, empty = "No rows for this selection.", maxHeight = "max-h-[420px]",
}: {
  cols: Array<Col<T>>; rows: T[]; onRow?: (r: T) => void; rowKey: (r: T, i: number) => string; empty?: string; maxHeight?: string;
}) {
  if (rows.length === 0) return <None />;
  return (
    <div className={`overflow-auto rounded-xl border border-slate-100 ${maxHeight}`}>
      <table className="w-full min-w-max border-collapse text-xs tabular-nums">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>{cols.map((c) => <th key={c.key} className={`px-3 py-2 font-semibold ${c.align === "right" ? "text-right" : "text-left"}`}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={onRow ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRow(r); } } : undefined}
              tabIndex={onRow ? 0 : undefined}
              className={`border-t border-slate-50 ${onRow ? "cursor-pointer hover:bg-sky-50/60 focus:bg-sky-50/60 focus:outline-none" : ""}`}
            >
              {cols.map((c) => <td key={c.key} className={`px-3 py-2 text-slate-700 ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">{empty}</span>
    </div>
  );
}
