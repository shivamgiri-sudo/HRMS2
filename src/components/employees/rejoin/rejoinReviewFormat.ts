/**
 * Pure display helpers for the rejoin review page. No React, no Date parsing of 'YYYY-MM-DD'
 * strings (new Date('2026-03-01') is UTC midnight and shows as the previous day west of UTC,
 * a bug this codebase has shipped before), so every date is formatted with string math.
 */
import type { AttendanceMonth, Rating, RehireStatus, Tone } from "./rejoinTypes";

export const DASH = "—";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Same as backend dossierTypes.round1, so the chart and the headline round identically. */
const round1 = (n: number): number => Math.round(n * 10 + Number.EPSILON * 10) / 10;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** '2026-03-07' (or an ISO timestamp) → '07 Mar 2026'. Anything unparseable → '—'. */
export function fmtDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!m) return DASH;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return DASH;
  return `${m[3]} ${month} ${m[1]}`;
}

/** '2026-03' → 'Mar 26' for chart axes; `long` gives 'Mar 2026'. */
export function fmtMonth(value: string | null | undefined, long = false): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(value ?? ""));
  if (!m) return DASH;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return DASH;
  return long ? `${month} ${m[1]}` : `${month} ${m[1].slice(2)}`;
}

/** A percentage, or '—' when the backend had nothing to divide. Never turns null into 0%. */
export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (!isNum(value)) return DASH;
  return `${Number(value.toFixed(digits))}%`;
}

/** Plain number with Indian grouping, '—' for null. */
export function fmtNum(value: number | null | undefined, digits = 1): string {
  if (!isNum(value)) return DASH;
  return Number(value.toFixed(digits)).toLocaleString("en-IN");
}

/** Rupees, no paise, Indian grouping; '-₹1,500' for negatives (never '-0'). '—' for null. */
export function fmtInr(value: number | null | undefined): string {
  if (!isNum(value)) return DASH;
  const rounded = Math.round(value);
  if (rounded === 0) return "₹0";
  return `${rounded < 0 ? "-" : ""}₹${Math.abs(rounded).toLocaleString("en-IN")}`;
}

/** 27 → '2 yr 3 mo'; 5 → '5 mo'; null → '—'. */
export function fmtTenure(months: number | null | undefined): string {
  if (!isNum(months) || months < 0) return DASH;
  const whole = Math.round(months);
  const y = Math.floor(whole / 12);
  const m = whole % 12;
  if (y === 0) return `${m} mo`;
  return m === 0 ? `${y} yr` : `${y} yr ${m} mo`;
}

/** 'termination_misconduct' → 'Termination misconduct'. Null/blank → '—'. */
export function humanize(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  if (!s) return DASH;
  const spaced = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/**
 * One month's attendance %, using the backend's total formula
 * ((present + 0.5 x half day + leave) / working days, capped at 100) so the chart and the headline agree.
 * null when the month had no working days on record.
 */
export function monthAttendancePct(m: AttendanceMonth): number | null {
  if (!(m.workingDays > 0)) return null;
  const pct = ((m.present + 0.5 * m.halfDay + m.leave) / m.workingDays) * 100;
  return Math.min(100, round1(pct));
}

export interface AttendancePoint {
  /** 'YYYY-MM' */
  month: string;
  /** Axis label, e.g. 'Mar 26'. */
  label: string;
  /** null = gap (no records, or no working days), never 0. */
  pct: number | null;
  /** null when the backend sent no row for this month. */
  row: AttendanceMonth | null;
}

/**
 * One point per month of the dossier window (the backend only returns months that have records, so a
 * month with nothing on file would otherwise vanish from the chart instead of showing as a gap).
 * Rows outside the window are kept, so nothing the backend sent is dropped.
 */
export function attendanceSeries(months: AttendanceMonth[], windowMonths: string[] = []): AttendancePoint[] {
  const byMonth = new Map(months.map((m) => [m.month.slice(0, 7), m]));
  const keys = [...new Set([...windowMonths.map((m) => m.slice(0, 7)), ...byMonth.keys()])].sort();
  return keys.map((key) => {
    const row = byMonth.get(key) ?? null;
    return { month: key, label: fmtMonth(key), pct: row ? monthAttendancePct(row) : null, row };
  });
}

export const RATING_LABEL: Record<Rating, string> = {
  strong: "Strong",
  average: "Average",
  weak: "Weak",
  insufficient_data: "Insufficient data",
};

export function ratingLabel(rating: string | null | undefined): string {
  return RATING_LABEL[rating as Rating] ?? humanize(rating);
}

export const ELIGIBILITY_LABEL: Record<RehireStatus, string> = {
  eligible: "Eligible",
  review: "Needs review",
  blocked: "Blocked",
};

export function eligibilityLabel(status: string | null | undefined): string {
  return ELIGIBILITY_LABEL[status as RehireStatus] ?? humanize(status);
}

const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "Pending branch head",
  approved: "Approved, employee active",
  rejected: "Rejected",
  cancelled: "Cancelled",
  // Old two-step rows only; nothing creates this status any more. The branch head makes the final decision.
  branch_head_approved: "Awaiting final decision (old process)",
};

export function requestStatusLabel(status: string | null | undefined): string {
  return REQUEST_STATUS_LABEL[String(status ?? "")] ?? humanize(status);
}

const ROLE_LABEL: Record<string, string> = {
  hr: "HR",
  admin: "Admin",
  super_admin: "Super admin",
  manager: "Reporting manager",
  branch_head: "Branch head",
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "Unknown role";
  return ROLE_LABEL[role] ?? humanize(role);
}

/**
 * Tailwind classes per tone. Each pairs a light and a dark variant so the page works in both themes;
 * the caller always renders an icon or text with it, so colour is never the only signal.
 */
export const TONE_CLASS: Record<Tone | "warn", string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  bad: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  neutral: "border-border bg-muted text-foreground",
};

export function ratingTone(rating: string | null | undefined): Tone | "warn" {
  if (rating === "strong") return "good";
  if (rating === "weak") return "bad";
  if (rating === "average") return "warn";
  return "neutral";
}

export function eligibilityTone(status: string | null | undefined): Tone | "warn" {
  if (status === "eligible") return "good";
  if (status === "blocked") return "bad";
  if (status === "review") return "warn";
  return "neutral";
}

/** Warning severity text → tone. Unknown severities stay neutral rather than guessing. */
export function severityTone(severity: string | null | undefined): Tone | "warn" {
  const s = String(severity ?? "").toLowerCase();
  if (/final|severe|high|critical|termination/.test(s)) return "bad";
  if (/written|medium|moderate|second/.test(s)) return "warn";
  return "neutral";
}
