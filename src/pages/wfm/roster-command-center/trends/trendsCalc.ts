/**
 * Pure helpers for the Trends & Publish panel (no React) — formatting, thresholds, insight
 * ordering and sorting live here so they are unit-testable and identical across sections.
 */
import type { Funnel, LatenessOverview, PublishOverview, ShrinkageTrend } from "./trendsTypes";

const NUM = new Intl.NumberFormat("en-IN");

export const fmtNum = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? "—" : NUM.format(v));
export const fmtPct = (v: number | null | undefined, digits = 1): string => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`);

/** "2026-09-30" -> "30/09/2026" */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

/** "2026-09-30" -> "30/09" (chart axes) */
export function fmtDayMonth(d: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[2]}/${m[1]}` : d;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO timestamp -> "DD/MM/YYYY HH:mm" in the viewer's timezone. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/* Shrinkage thresholds — one set for every section (the panel used 8/15 in one place and 10/20 in
 * another). Aligned with the RTA alert policy defaults (operations.shrinkage warning 15, critical 25). */
export const SHRINK_WARN = 15;
export const SHRINK_CRIT = 25;

export type Tone = "green" | "amber" | "red" | "neutral";
export function shrinkTone(pct: number | null | undefined): Tone {
  if (pct == null || !Number.isFinite(pct)) return "neutral";
  return pct >= SHRINK_CRIT ? "red" : pct >= SHRINK_WARN ? "amber" : "green";
}

export const STAGE_LABEL: Record<string, string> = {
  generated: "Not yet published",
  pending_employee_ack: "Published, awaiting acknowledgement",
  acknowledged: "Acknowledged",
  rejected_by_employee: "Rejected by employee",
  pending_manager_action: "With manager (disputed)",
  realigned_by_manager: "Realigned by manager",
  force_approved_by_manager: "Force-approved by manager",
  escalated_to_hr: "Escalated to HR",
  approved_final: "Approved (final)",
  published_to_rta: "Published to RTA",
  manager_rejected_employee_request: "Manager rejected request",
};
export const stageLabel = (s: string) => STAGE_LABEL[s] ?? s.replace(/_/g, " ");

export type PillTone = "neutral" | "green" | "amber" | "red" | "blue" | "violet";
export function stageTone(s: string): PillTone {
  if (s === "generated") return "neutral";
  if (s === "pending_employee_ack") return "amber";
  if (["rejected_by_employee", "pending_manager_action", "escalated_to_hr", "manager_rejected_employee_request"].includes(s)) return "red";
  return "green";
}

export function cycleTone(status: string): PillTone {
  if (["draft", "submitted", "reviewed"].includes(status)) return "neutral";
  if (status === "published") return "amber";
  if (status === "variance_review") return "red";
  return "green";
}

/** "1 assignment" / "2 assignments" */
export const plural = (n: number, word: string): string => `${fmtNum(n)} ${word}${n === 1 ? "" : "s"}`;

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ── Insights ──────────────────────────────────────────────────────────────── */

export type Severity = "critical" | "warning" | "info";
export type SectionKey = "shrinkage" | "team-shrinkage" | "publish" | "attrition" | "lateness";
export interface Insight { id: string; severity: Severity; label: string; count?: number; section: SectionKey }

const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function buildInsights(input: {
  shrink?: Pick<ShrinkageTrend, "summary" | "missingDates" | "futureOnly"> | null;
  publish?: Pick<PublishOverview, "funnel" | "upcomingUnpublished"> | null;
  late?: Pick<LatenessOverview, "totals"> | null;
}): Insight[] {
  const out: Insight[] = [];
  const s = input.shrink;
  if (s && !s.futureOnly && s.summary.scheduled > 0) {
    const p = s.summary.shrinkagePct;
    if (p >= SHRINK_CRIT) out.push({ id: "shrink-crit", severity: "critical", label: `Shrinkage ${fmtPct(p)} is at or above the ${SHRINK_CRIT}% critical line`, section: "shrinkage" });
    else if (p >= SHRINK_WARN) out.push({ id: "shrink-warn", severity: "warning", label: `Shrinkage ${fmtPct(p)} is above the ${SHRINK_WARN}% warning line`, section: "shrinkage" });
  }
  const gaps = s?.missingDates?.length ?? 0;
  if (gaps > 0 && !s?.futureOnly) out.push({ id: "gaps", severity: "info", label: `${plural(gaps, "day")} in range ${gaps === 1 ? "has" : "have"} no roster/attendance data`, count: gaps, section: "shrinkage" });
  const f = input.publish?.funnel;
  if (f) {
    if (f.disputed > 0) out.push({ id: "disputed", severity: "critical", label: `${plural(f.disputed, "assignment")} rejected or escalated and unresolved`, count: f.disputed, section: "publish" });
    if ((input.publish?.upcomingUnpublished ?? 0) > 0) out.push({ id: "upcoming-unpub", severity: "warning", label: `${plural(input.publish!.upcomingUnpublished, "working shift")} in the next 7 days ${input.publish!.upcomingUnpublished === 1 ? "is" : "are"} not published`, count: input.publish!.upcomingUnpublished, section: "publish" });
    if (f.awaitingAck > 0) out.push({ id: "await-ack", severity: "warning", label: `${plural(f.awaitingAck, "published assignment")} awaiting employee acknowledgement`, count: f.awaitingAck, section: "publish" });
  }
  const l = input.late?.totals;
  if (l) {
    if (l.severe > 0) out.push({ id: "late-severe", severity: "warning", label: `${plural(l.severe, "severe late arrival")} (over 60 min)`, count: l.severe, section: "lateness" });
    if (l.habitualEmployees > 0) out.push({ id: "late-habitual", severity: "warning", label: `${plural(l.habitualEmployees, "habitual latecomer")}`, count: l.habitualEmployees, section: "lateness" });
  }
  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

/* ── Sorting ───────────────────────────────────────────────────────────────── */

export type SortDir = "asc" | "desc";

/** Stable sort; nulls always last regardless of direction; strings compared case-insensitively. */
export function sortRows<T>(rows: T[], value: (r: T) => number | string | null | undefined, dir: SortDir): T[] {
  const idx = rows.map((r, i) => [r, i] as const);
  idx.sort(([a, ai], [b, bi]) => {
    const va = value(a), vb = value(b);
    const an = va == null || (typeof va === "number" && Number.isNaN(va));
    const bn = vb == null || (typeof vb === "number" && Number.isNaN(vb));
    if (an && bn) return ai - bi;
    if (an) return 1;
    if (bn) return -1;
    const cmp = typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { sensitivity: "base", numeric: true });
    return cmp !== 0 ? (dir === "asc" ? cmp : -cmp) : ai - bi;
  });
  return idx.map(([r]) => r);
}

/** Percentage-point delta vs a previous value; undefined when either side is unknown. */
export function deltaOf(cur: number | null | undefined, prev: number | null | undefined): number | undefined {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return undefined;
  return Math.round((cur - prev) * 10) / 10;
}

/** Attrition % — exits / (headcount + exits), the aon-bucket-attrition report's own stated denominator. */
export function attritionRate(exits: number, headcount: number): number | null {
  const d = headcount + exits;
  return d > 0 ? Math.round((exits / d) * 1000) / 10 : null;
}

export const AON_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;

export function bucketAonRows(hc: Array<{ aon_bucket?: unknown; headcount?: unknown }>, ex: Array<{ aon_bucket?: unknown; exits?: unknown }>) {
  const head: Record<string, number> = {};
  const exits: Record<string, number> = {};
  for (const r of hc) { const b = String(r.aon_bucket ?? ""); head[b] = (head[b] ?? 0) + (Number(r.headcount) || 0); }
  for (const r of ex) { const b = String(r.aon_bucket ?? ""); exits[b] = (exits[b] ?? 0) + (Number(r.exits) || 0); }
  return AON_BUCKETS.map((b) => ({ bucket: b, headcount: head[b] ?? 0, exits: exits[b] ?? 0, ratePct: attritionRate(exits[b] ?? 0, head[b] ?? 0) }));
}

export function funnelSpark(byWeek: Array<Funnel & { week: string }>, pick: (f: Funnel) => number): number[] {
  return byWeek.map((w) => pick(w));
}
