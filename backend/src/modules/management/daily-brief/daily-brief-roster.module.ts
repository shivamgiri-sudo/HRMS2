/**
 * Roster / Staffing "Looking Ahead" module for the D-1 Daily Manager Briefing Engine.
 *
 * Unlike the other daily-brief modules this one is forward-looking (next 1-7 days,
 * not D-1) because staffing coverage is a planning signal, not a hygiene one. It is
 * scoped by process/branch (WFM/Operations/Branch Head are process- or branch-level
 * roles, not per-employee), not by a teamEmployeeIds list.
 *
 * Reuses:
 *  - `wfm_slot_requirement` (migration 233) for scheduled-vs-required HC. Confirmed
 *    columns used: process_id, branch_id, requirement_date, required_planned_hc,
 *    roster_scheduled_hc, coverage_delta, is_active. NOTE: the governing prompt for
 *    this module claimed `wfm_slot_requirement` has no branch_id column — the live
 *    schema (backend/sql/233_wfm_slot_requirement.sql) DOES have a nullable
 *    branch_id with an FK to branch_master, so branch-scoped filtering is honoured
 *    directly instead of being skipped.
 *  - The exact shortage-severity thresholds already live in
 *    business-actions.signal-sync.ts's `syncRosterShortages` (verified by reading
 *    that file directly, not by trusting this comment): shortage > 10 => critical,
 *    shortage > 5 => high, else medium. Reused verbatim, not reinvented.
 *  - `wfm_roster_assignment.final_roster_status` / `.employee_ack_status` (verified
 *    live in modules/wfm/wfm.routes.ts) for pending roster acknowledgement/rejection.
 *    That table links to process/branch via `process_name`/`branch_name` string
 *    columns (not process_id/branch_id), so this module resolves scope through
 *    `process_master`/`branch_master` name joins to stay consistent with how
 *    wfm.routes.ts itself scopes the same table.
 *
 * Explicitly NOT done: attributing a shortage to "N employees on leave". The reused
 * `syncRosterShortages` query does not join roster shortages back to individual leave
 * approvals (coverage_delta already trusts roster_scheduled_hc as leave-adjusted), and
 * no other live join was found. Per the governing spec, that claim is omitted rather
 * than guessed.
 *
 * EDITORIAL DEFAULTS (not sourced from an existing convention — flagged for review):
 *  - The "Looking Ahead" window is CURDATE() .. CURDATE()+7 days for both the slot
 *    forecast and the pending-acknowledgement count. The prompt says "next 1-7 day"
 *    for the forecast; the same window was reused for pending-ack for consistency,
 *    but nothing in the existing code ties pending-ack specifically to a 7-day
 *    window.
 *  - When both processIds and branchIds are supplied, scope is the INTERSECTION
 *    (AND), not the union. This was a judgment call — no existing caller was found
 *    that passes both simultaneously to compare against.
 *  - Module-level severity is taken from the single worst (largest) per-slot
 *    shortage in the scoped window, mirroring how syncRosterShortages assigns
 *    severity per-row; there is no existing convention for rolling many rows'
 *    severities into one module-level severity.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { BriefSignal, SourceHealth } from "./daily-brief.types.js";
import { ROSTER_LOOK_AHEAD_DAYS } from "./daily-brief-editorial-constants.js";

export type RosterShortageSeverity = "critical" | "high" | "medium";

export interface RosterScopeIds {
  processIds?: string[];
  branchIds?: string[];
}

export interface RosterSlotForecast {
  requirementDate: string;
  processId: string | null;
  processName: string | null;
  requiredHc: number;
  scheduledHc: number;
  /** roster_scheduled_hc - required_planned_hc (negative = shortage), as stored. */
  coverageDelta: number | null;
  /** Only set when this slot is short-staffed (required > scheduled). */
  severity: RosterShortageSeverity | null;
}

export interface RosterModuleResult {
  lookingAhead: RosterSlotForecast[];
  uncoveredHc: BriefSignal;
  /** Worst severity across all shortage slots in scope for the window; null if no shortage. */
  worstSeverity: RosterShortageSeverity | null;
  /** Count of roster rows awaiting employee ack or manager action in the window; null if not applicable. */
  pendingAcknowledgement: BriefSignal | null;
  /** Subset of pendingAcknowledgement specifically rejected-by-employee and needing manager action. */
  pendingRejectedByEmployee: BriefSignal | null;
  sourceHealth: SourceHealth[];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Reused verbatim from business-actions.signal-sync.ts's syncRosterShortages. Do not invent new bands. */
export function classifyShortageSeverity(shortage: number): RosterShortageSeverity {
  if (shortage > 10) return "critical";
  if (shortage > 5) return "high";
  return "medium";
}

function severityRank(severity: RosterShortageSeverity | null): number {
  if (severity === "critical") return 3;
  if (severity === "high") return 2;
  if (severity === "medium") return 1;
  return 0;
}

function hasScope(scopeIds: RosterScopeIds): boolean {
  return Boolean(scopeIds.processIds?.length) || Boolean(scopeIds.branchIds?.length);
}

function buildSlotScopeClause(scopeIds: RosterScopeIds, alias: string): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scopeIds.processIds?.length) {
    clauses.push(`${alias}.process_id IN (${scopeIds.processIds.map(() => "?").join(",")})`);
    params.push(...scopeIds.processIds);
  }
  if (scopeIds.branchIds?.length) {
    clauses.push(`${alias}.branch_id IN (${scopeIds.branchIds.map(() => "?").join(",")})`);
    params.push(...scopeIds.branchIds);
  }
  return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", params };
}

async function buildLookingAheadForecast(
  scopeIds: RosterScopeIds,
): Promise<{
  lookingAhead: RosterSlotForecast[];
  uncoveredHc: number;
  worstSeverity: RosterShortageSeverity | null;
  health: SourceHealth;
}> {
  if (!hasScope(scopeIds)) {
    return {
      lookingAhead: [],
      uncoveredHc: 0,
      worstSeverity: null,
      health: { module: "roster_forecast", state: "NOT_APPLICABLE", detail: "No process/branch scope supplied" },
    };
  }
  const scope = buildSlotScopeClause(scopeIds, "wsr");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT wsr.requirement_date, wsr.process_id, pm.process_name,
              wsr.required_planned_hc AS required_hc,
              COALESCE(wsr.roster_scheduled_hc, 0) AS scheduled_hc,
              wsr.coverage_delta
         FROM wfm_slot_requirement wsr
         LEFT JOIN process_master pm ON pm.id = wsr.process_id
        WHERE wsr.is_active = 1
          AND wsr.requirement_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ${ROSTER_LOOK_AHEAD_DAYS} DAY)
          ${scope.sql}
        ORDER BY wsr.requirement_date ASC, wsr.coverage_delta ASC
        LIMIT 100`,
      scope.params,
    );
    let uncoveredHc = 0;
    let worstSeverity: RosterShortageSeverity | null = null;
    const lookingAhead: RosterSlotForecast[] = (rows as RowDataPacket[]).map((r) => {
      const requiredHc = numberValue(r.required_hc);
      const scheduledHc = numberValue(r.scheduled_hc);
      const shortage = requiredHc - scheduledHc;
      let severity: RosterShortageSeverity | null = null;
      if (shortage > 0) {
        severity = classifyShortageSeverity(shortage);
        uncoveredHc += shortage;
        if (severityRank(severity) > severityRank(worstSeverity)) worstSeverity = severity;
      }
      return {
        requirementDate: String(r.requirement_date),
        processId: r.process_id ? String(r.process_id) : null,
        processName: r.process_name ? String(r.process_name) : null,
        requiredHc,
        scheduledHc,
        coverageDelta: r.coverage_delta === null || r.coverage_delta === undefined ? null : numberValue(r.coverage_delta),
        severity,
      };
    });
    return {
      lookingAhead,
      uncoveredHc,
      worstSeverity,
      health: { module: "roster_forecast", state: lookingAhead.length > 0 ? "AVAILABLE" : "NO_DATA" },
    };
  } catch (err) {
    return {
      lookingAhead: [],
      uncoveredHc: 0,
      worstSeverity: null,
      health: {
        module: "roster_forecast",
        state: "ERROR",
        detail: `Roster slot-requirement query failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

async function buildPendingAcknowledgement(
  scopeIds: RosterScopeIds,
): Promise<{
  pending: BriefSignal | null;
  rejected: BriefSignal | null;
  health: SourceHealth;
}> {
  if (!hasScope(scopeIds)) {
    return {
      pending: null,
      rejected: null,
      health: { module: "roster_acknowledgement", state: "NOT_APPLICABLE", detail: "No process/branch scope supplied" },
    };
  }
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scopeIds.processIds?.length) {
    clauses.push(`pm.id IN (${scopeIds.processIds.map(() => "?").join(",")})`);
    params.push(...scopeIds.processIds);
  }
  if (scopeIds.branchIds?.length) {
    clauses.push(`bm.id IN (${scopeIds.branchIds.map(() => "?").join(",")})`);
    params.push(...scopeIds.branchIds);
  }
  const scopeSql = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(wra.final_roster_status IN ('pending_employee_ack', 'pending_manager_action')) AS pending_count,
         SUM(wra.final_roster_status = 'pending_manager_action' AND wra.employee_ack_status = 'rejected') AS rejected_count
       FROM wfm_roster_assignment wra
       LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       LEFT JOIN branch_master bm ON bm.branch_name = wra.branch_name
       WHERE wra.roster_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ${ROSTER_LOOK_AHEAD_DAYS} DAY)
         ${scopeSql}`,
      params,
    );
    const row = rows[0] ?? {};
    const pendingCount = numberValue(row.pending_count);
    const rejectedCount = numberValue(row.rejected_count);
    return {
      pending: { key: "roster_pending_ack", label: "Pending roster acknowledgement/rejection (next 7 days)", value: pendingCount, unit: "count" },
      rejected: { key: "roster_rejected_by_employee", label: "Rejected by employee, needs manager action", value: rejectedCount, unit: "count" },
      health: { module: "roster_acknowledgement", state: pendingCount > 0 ? "AVAILABLE" : "NO_DATA" },
    };
  } catch (err) {
    return {
      pending: null,
      rejected: null,
      health: {
        module: "roster_acknowledgement",
        state: "ERROR",
        detail: `Roster acknowledgement query failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

export async function buildRosterModule(
  scopeIds: RosterScopeIds,
  reportingDate: string,
): Promise<RosterModuleResult> {
  const [forecastResult, ackResult] = await Promise.all([
    buildLookingAheadForecast(scopeIds),
    buildPendingAcknowledgement(scopeIds),
  ]);

  // reportingDate is the D-1 business date this brief run is generated for. This module's
  // own data is forward-looking (next 1-7 days from *today*, not from reportingDate), but
  // the parameter is threaded through and stamped onto sourceHealth.asOfDate so the health
  // block reads consistently with the other daily-brief modules' convention.
  const sourceHealth: SourceHealth[] = [forecastResult.health, ackResult.health].map((h) => ({
    ...h,
    asOfDate: h.asOfDate ?? reportingDate,
  }));

  return {
    lookingAhead: forecastResult.lookingAhead,
    uncoveredHc: { key: "roster_uncovered_hc", label: "Uncovered HC (next 7 days)", value: forecastResult.uncoveredHc, unit: "count" },
    worstSeverity: forecastResult.worstSeverity,
    pendingAcknowledgement: ackResult.pending,
    pendingRejectedByEmployee: ackResult.rejected,
    sourceHealth,
  };
}
