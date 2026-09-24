/**
 * Shared constants, types and small pure helpers for the Team Roster submission workflow
 * (managers propose roster cells; manager step, then WFM step, then apply). See
 * docs/superpowers/specs/2026-09-24-team-roster-submission-design.md.
 */
import { getIstDateString } from "../../utils/dateUtils.js";

export const NEW_ASSIGNMENT_TYPES = ["SHIFT", "WEEK_OFF", "TRAINING", "UNSCHEDULED"] as const;
export type NewAssignmentType = (typeof NEW_ASSIGNMENT_TYPES)[number];

export type LineKind = "FILL_BLANK" | "CHANGE";
export type LineStatus = "pending" | "applied" | "skipped" | "failed";

export const SUBMISSION_STATUS = {
  DRAFT: "draft",
  PENDING_MANAGER: "pending_manager",
  PENDING_WFM: "pending_wfm",
  APPLIED: "applied",
  PARTIALLY_APPLIED: "partially_applied",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[keyof typeof SUBMISSION_STATUS];

/** Statuses in which a submission's cells are locked in roster_team_pending_cell. */
export const PENDING_STATUSES: readonly SubmissionStatus[] = ["pending_manager", "pending_wfm"];

export const WFM_APPROVER_ROLES = ["wfm", "wfm_spoc", "wfm_analyst", "branch_wfm", "ho_wfm"] as const;
export const GLOBAL_APPROVER_ROLES = ["admin", "super_admin"] as const;

export const MAX_RANGE_DAYS = 31;
export const MAX_GRID_PAGE = 500;
export const DEFAULT_GRID_PAGE = 100;
export const MAX_LINES_PER_SUBMISSION = 5000;
export const MIN_REASON_LENGTH = 8;
export const MAX_REASON_LENGTH = 500;
export const MAX_REMARKS_LENGTH = 1000;
export const MAX_NOTE_LENGTH = 500;

export type Actor = { id: string; role?: string; roles?: string[]; isDemo?: boolean };

export class TeamRosterError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = "TEAM_ROSTER_ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Anything with execute(): the pool, or a transaction / named-lock connection. */
export type SqlExecutor = { execute: (sql: string, params?: any[]) => Promise<any> };

export const rowsOf = <T = any>(result: any): T[] => (Array.isArray(result) ? (result[0] as T[]) : []);
export const placeholders = (n: number) => Array(n).fill("?").join(",");

export function todayIst(): string {
  return getIstDateString(0);
}

export function ymdOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

const DAY_MS = 86_400_000;
const utcMs = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export function isValidYmd(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(utcMs(value)).toISOString().slice(0, 10) === value;
}

/** Inclusive number of days between two valid YYYY-MM-DD dates. */
export function spanDays(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / DAY_MS) + 1;
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = utcMs(from); t <= utcMs(to); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

export function formatDmy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** The caller's role list, lower-cased, from whichever of roles[] / role the auth layer set. */
export function rolesOf(actor: Actor): string[] {
  const list = actor.roles && actor.roles.length ? actor.roles : actor.role ? [actor.role] : [];
  return list.map((r) => String(r).toLowerCase());
}

export const isGlobalApprover = (actor: Actor) => rolesOf(actor).some((r) => (GLOBAL_APPROVER_ROLES as readonly string[]).includes(r));
export const isWfmApprover = (actor: Actor) =>
  isGlobalApprover(actor) || rolesOf(actor).some((r) => (WFM_APPROVER_ROLES as readonly string[]).includes(r));

export interface OldCellSnapshot {
  assignmentId: string | null;
  assignmentType: string | null;
  isWeekOff: boolean;
  shiftTemplateId: string | null;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
}

const hhmm = (t: unknown) => (t == null || t === "" ? null : String(t).slice(0, 5));

/**
 * The type a stored roster row effectively is. Rows written by the manual assign path have no
 * assignment_type at all, so the week-off flag and the shift times decide.
 */
export function effectiveType(row: { assignment_type?: unknown; is_week_off?: unknown; shift_start_time?: unknown; shift_end_time?: unknown; shift_template_id?: unknown }): string {
  if (Number(row.is_week_off) === 1) return "WEEK_OFF";
  const t = String(row.assignment_type ?? "").toUpperCase();
  if (t && t !== "REGULAR") return t;
  if (row.shift_start_time || row.shift_end_time || row.shift_template_id) return "SHIFT";
  return t || "UNASSIGNED";
}

export function snapshotOf(row: Record<string, any>): OldCellSnapshot {
  return {
    assignmentId: row.id ? String(row.id) : null,
    assignmentType: effectiveType(row),
    isWeekOff: Number(row.is_week_off) === 1,
    shiftTemplateId: row.shift_template_id ? String(row.shift_template_id) : null,
    shiftStartTime: hhmm(row.shift_start_time),
    shiftEndTime: hhmm(row.shift_end_time),
  };
}

/** True when the stored row still equals the snapshot the manager saw. */
export function snapshotMatches(current: OldCellSnapshot | null, old: OldCellSnapshot): boolean {
  if (!current || !old.assignmentId) return false;
  return (
    current.assignmentId === old.assignmentId &&
    current.assignmentType === old.assignmentType &&
    current.isWeekOff === old.isWeekOff &&
    current.shiftTemplateId === old.shiftTemplateId &&
    current.shiftStartTime === old.shiftStartTime &&
    current.shiftEndTime === old.shiftEndTime
  );
}

export function parseWarnings(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function assertReason(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (text.length < MIN_REASON_LENGTH) {
    throw new TeamRosterError(400, `${label} must be at least ${MIN_REASON_LENGTH} characters.`, "REASON_REQUIRED");
  }
  return text.slice(0, MAX_REMARKS_LENGTH);
}
