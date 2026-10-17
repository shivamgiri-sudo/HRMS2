/**
 * The one rule for "this NOC case is still pending", shared by every screen that counts or lists
 * pending NOCs, so the Ops Control Tower NOC count and the Exit Command Center always show the same
 * people (WFM report 2026-10-17: August leavers counted as NOC-pending could not be found in the Exit
 * Command Center).
 *
 * A case is pending when:
 *   - it is still open ('invited' / 'employee_submitted' / 'in_progress') and the person is not an
 *     absconder still waiting for the Payroll Head's F&F exception (nobody can work that case yet), or
 *   - it is completed but still waiting for the Payroll Head's final approval, once that gate is
 *     switched on (noc_ph_final_approval_from), because F&F is locked behind it.
 *
 * The caller passes the date from nocFinalApprovalFrom() (null when the gate is off) and binds the
 * returned params in the order they appear in its own SQL.
 */
import { abscondedWithoutExceptionSql } from "../exit/ff-settlement-gate.service.js";
import { awaitingFinalApprovalSql } from "./noc-final-approval.service.js";

export const NOC_OPEN_STATUSES = ["invited", "employee_submitted", "in_progress"] as const;

export function nocPendingSql(
  caseAlias: string,
  erAlias: string,
  empAlias: string,
  finalApprovalFrom: string | null,
): { sql: string; params: string[] } {
  const open = `(${caseAlias}.status IN (${NOC_OPEN_STATUSES.map(() => "?").join(",")}) AND NOT ${abscondedWithoutExceptionSql(erAlias, empAlias)})`;
  if (!finalApprovalFrom) return { sql: `(${open})`, params: [...NOC_OPEN_STATUSES] };
  return {
    sql: `(${open} OR ${awaitingFinalApprovalSql(caseAlias)})`,
    params: [...NOC_OPEN_STATUSES, finalApprovalFrom],
  };
}
