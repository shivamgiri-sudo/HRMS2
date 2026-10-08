/**
 * Requisition criteria and end date (WS3 A3), a thin adapter over the selection engine (plan 2026-10-09 "Changes needed to the
 * WS3 plan"): criteriaOf = compileCriteria, criteriaSummary = completeness (labels complete / partial / incomplete). The end date
 * (requisition_validity, decision O1) and seats left live here. Pure, except loadEndDateEnforced (one keyed policy read).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { compileCriteria, type RequisitionCriteriaRow } from "../selection/compile-criteria.js";
import type { CompiledCriteria, Completeness } from "../selection/selection-types.js";

export interface RequisitionRow extends RequisitionCriteriaRow {
  validity: string | Date | null; activeStatus: number | null; closedAt: string | null;
  requestedHeadcount: number | null; fulfilledHeadcount: number | null; bmiUrlPresent: boolean;
}
export type CriteriaSummary = Completeness;

export const END_DATE_KEY = "policy.req_end_date_enforced";

export const criteriaOf = (r: RequisitionCriteriaRow): CompiledCriteria => compileCriteria(r);
export const criteriaSummary = (c: CompiledCriteria): CriteriaSummary => c.completeness;

const istDay = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
/** The end date as an IST calendar day (a DATE column comes back as a Date at IST midnight, or as text). */
export function endDateOf(r: Pick<RequisitionRow, "validity">): string | null {
  const v = r.validity;
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : istDay(v);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** True when the end date is before today (the end date itself is still open). */
export const endDatePassed = (r: Pick<RequisitionRow, "validity">, todayIst: string): boolean => {
  const d = endDateOf(r);
  return !!d && d < todayIst;
};

/** The refusal text when the end date is enforced and has passed; null otherwise (decision C8). */
export function requisitionEndedReason(r: Pick<RequisitionRow, "validity">, todayIst: string, enforced: boolean): string | null {
  if (!enforced || !endDatePassed(r, todayIst)) return null;
  return `requisition end date passed (${endDateOf(r)})`;
}

export const seatsLeft = (r: Pick<RequisitionRow, "requestedHeadcount" | "fulfilledHeadcount">): number =>
  Math.max(0, Math.floor((Number(r.requestedHeadcount) || 0) - (Number(r.fulfilledHeadcount) || 0)));

/** policy.req_end_date_enforced (he_model_param); absent, unreadable or anything but 1 means off. */
export async function loadEndDateEnforced(): Promise<boolean> {
  try {
    const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = ? LIMIT 1", [END_DATE_KEY]);
    return r[0] ? Number(r[0].value) === 1 : false;
  } catch { return false; }
}
