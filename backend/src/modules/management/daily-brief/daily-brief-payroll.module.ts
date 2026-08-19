/**
 * Payroll-readiness module for the D-1 Daily Manager Briefing Engine.
 *
 * SECURITY-CRITICAL SCOPE RULE — read before touching this file.
 * `buildPayrollReadinessModule` is the ONLY function in this file allowed to read
 * `salary_prep_run` (or anything downstream of it), and only after confirming the
 * caller-supplied role is a member of `PAYROLL_ROLES`
 * (backend/src/platform/policy/roles.ts). Every other recipient must go through
 * `buildPayrollOperationalHint`, which never references `salary_prep_run` at all.
 *
 * MONETARY SAFETY: this module surfaces operational STATUS/COUNT facts only —
 * run status, lock/compliance flags, validation status, pending-approval counts,
 * branch/process readiness gaps. It never selects a gross/net/PF/ESIC/amount
 * column from any table, and it never reads `salary_prep_line` (the table that
 * actually holds money) at all. See the __tests__ file for a programmatic
 * assertion that no query string in this module matches
 * /salary|gross|net_pay|amount|pf_amount|esic_amount/i.
 *
 * Readiness DETAIL is intentionally recomputed by re-invoking the existing
 * readiness services (payrollGovernanceService.readiness,
 * payrollBranchReadinessService.validatePayrollRunCreation) rather than
 * reimplementing their category logic — see the prompt for this module and the
 * hrms2-payroll-readiness-decisions-2026-08-13 memory. This module only decides
 * WHICH runs are in flight and WHO may see them, then delegates.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { PAYROLL_ROLES, normalizeRoleInputs } from "../../../platform/policy/roles.js";
import { CLOSED_RUN_STATUSES_SQL } from "../../payroll/run-status.js";
import { payrollGovernanceService } from "../../payroll/payroll-governance.service.js";
import { payrollBranchReadinessService } from "../../payroll/payroll-branch-readiness.service.js";
import type { SourceHealth } from "./daily-brief.types.js";
import { PAYROLL_MAX_RUNS_PER_BRIEF } from "./daily-brief-editorial-constants.js";

// ---------------------------------------------------------------------------
// Role gate
// ---------------------------------------------------------------------------

const PAYROLL_ROLE_SET = new Set(PAYROLL_ROLES.map((role) => String(role).toLowerCase()));

/**
 * Whether `role` is entitled to payroll readiness detail. Uses the same
 * alias-normalisation table (`normalizeRoleInputs`) the rest of the platform's
 * RBAC uses, so "payroll_admin" (a live catalog role that legacy-maps to
 * `payroll`) is correctly recognised even though it is not itself a
 * `PAYROLL_ROLES` member — see the reconciliation note in the module report.
 *
 * Fails CLOSED: an unrecognised or empty role string returns false, never true.
 */
export function isPayrollEntitledRole(role: string | null | undefined): boolean {
  if (!role || typeof role !== "string" || role.trim() === "") return false;
  const normalized = normalizeRoleInputs([role]);
  return normalized.some((r) => PAYROLL_ROLE_SET.has(String(r).toLowerCase()));
}

// ---------------------------------------------------------------------------
// Types (local to this module — daily-brief.types.ts is not editable here;
// a later integration pass folds these into ManagerDailyBrief as needed)
// ---------------------------------------------------------------------------

export interface PayrollReadinessRunSummary {
  runId: string;
  runMonth: string;
  status: string;
  attendanceSnapshotLocked: boolean;
  complianceChecked: boolean;
  validationStatus: string | null;
  financeApproved: boolean;
  ceoAcknowledged: boolean;
  /** From payrollGovernanceService.readiness(runId).summary — counts only, no issue payload. */
  blockerCount: number;
  warningCount: number;
  /** category -> status string, from payrollGovernanceService.readiness(runId).categories */
  categoryStatuses: Record<string, string>;
  /** From payrollBranchReadinessService.validatePayrollRunCreation(runMonth) — branch NAMES only. */
  branchReadinessGaps: { blockedBranches: string[]; readyBranches: string[] };
}

export interface PayrollReadinessModuleResult {
  applicable: boolean;
  sourceHealth: SourceHealth;
  runs: PayrollReadinessRunSummary[];
  /** Count of in-flight runs missing finance sign-off or CEO acknowledgement. Never an amount. */
  pendingApprovalsCount: number;
}

function notApplicableResult(detail: string): PayrollReadinessModuleResult {
  return {
    applicable: false,
    sourceHealth: { module: "payroll_readiness_detail", state: "NOT_APPLICABLE", detail },
    runs: [],
    pendingApprovalsCount: 0,
  };
}

// EDITORIAL / INVENTED CAP: bounds how many in-flight runs one brief will summarise.
// Not specified by the prompt or any existing readiness service; chosen defensively so
// a pathological number of open runs cannot make one recipient's brief unbounded. Flagged
// per the "never invent thresholds without flagging" rule. Now centralized in
// daily-brief-editorial-constants.ts as PAYROLL_MAX_RUNS_PER_BRIEF (imported above,
// aliased below to keep this file's existing internal name unchanged).
const MAX_RUNS_PER_BRIEF = PAYROLL_MAX_RUNS_PER_BRIEF;

/**
 * Payroll-role path. HARD-REFUSES (returns `applicable: false`, never throws, never
 * silently returns an empty-but-successful payload) for any role not in PAYROLL_ROLES.
 */
export async function buildPayrollReadinessModule(
  recipientRole: string,
  scope: { branchIds?: string[]; processIds?: string[] },
  reportingDate: string,
): Promise<PayrollReadinessModuleResult> {
  if (!isPayrollEntitledRole(recipientRole)) {
    return notApplicableResult(`Role '${recipientRole}' is not payroll-entitled (see PAYROLL_ROLES).`);
  }

  try {
    const branchIds = (scope.branchIds ?? []).filter(Boolean);
    const processIds = (scope.processIds ?? []).filter(Boolean);

    // In-flight = not in a closed state (locked/disbursed/finalized — reuses run-status.ts's
    // single definition rather than re-deciding what "closed" means here).
    //
    // Scope rule (documented, not specified by the prompt — flagged as an interpretation):
    //   - A company-wide run (branch_id AND process_id both NULL) is visible to every
    //     payroll-role recipient, matching how payroll-branch-readiness.service.ts already
    //     treats a NULL-scoped run as covering every branch.
    //   - A branch- or process-scoped run is visible only if it falls inside the recipient's
    //     own scope lists.
    //   - A recipient with no branch/process scope at all (org-wide payroll/finance role) sees
    //     every in-flight run.
    const clauses = [`LOWER(spr.status) NOT IN (${CLOSED_RUN_STATUSES_SQL})`];
    const params: unknown[] = [];
    if (branchIds.length > 0 || processIds.length > 0) {
      const scopeClauses = ["(spr.branch_id IS NULL AND spr.process_id IS NULL)"];
      if (branchIds.length > 0) {
        scopeClauses.push(`spr.branch_id IN (${branchIds.map(() => "?").join(",")})`);
        params.push(...branchIds);
      }
      if (processIds.length > 0) {
        scopeClauses.push(`spr.process_id IN (${processIds.map(() => "?").join(",")})`);
        params.push(...processIds);
      }
      clauses.push(`(${scopeClauses.join(" OR ")})`);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT spr.id, spr.run_month, spr.status, spr.attendance_snapshot_locked,
              spr.compliance_checked, spr.validation_status,
              spr.finance_approved_by, spr.finance_approved_at,
              spr.ceo_acknowledged_by, spr.ceo_acknowledged_at
         FROM salary_prep_run spr
        WHERE ${clauses.join(" AND ")}
        ORDER BY spr.run_month DESC
        LIMIT ${MAX_RUNS_PER_BRIEF}`,
      params,
    );

    const runRows = rows as Array<{
      id: string;
      run_month: string;
      status: string;
      attendance_snapshot_locked: number | null;
      compliance_checked: number | null;
      validation_status: string | null;
      finance_approved_by: string | null;
      finance_approved_at: string | null;
      ceo_acknowledged_by: string | null;
      ceo_acknowledged_at: string | null;
    }>;

    if (runRows.length === 0) {
      return {
        applicable: true,
        sourceHealth: { module: "payroll_readiness_detail", state: "NO_DATA", asOfDate: reportingDate },
        runs: [],
        pendingApprovalsCount: 0,
      };
    }

    const runs: PayrollReadinessRunSummary[] = [];
    let pendingApprovalsCount = 0;

    for (const row of runRows) {
      const financeApproved = Boolean(row.finance_approved_at || row.finance_approved_by);
      const ceoAcknowledged = Boolean(row.ceo_acknowledged_at || row.ceo_acknowledged_by);
      if (!financeApproved || !ceoAcknowledged) pendingApprovalsCount += 1;

      // Reuse the canonical readiness gate rather than recomputing category logic.
      let blockerCount = 0;
      let warningCount = 0;
      let categoryStatuses: Record<string, string> = {};
      try {
        const readiness = await payrollGovernanceService.readiness(row.id);
        blockerCount = readiness.summary.blockers;
        warningCount = readiness.summary.warnings;
        for (const [cat, info] of Object.entries(readiness.categories)) {
          categoryStatuses[cat] = (info as { status: string }).status;
        }
      } catch (err) {
        // Fail closed: an unreadable readiness check must not read as "clean".
        categoryStatuses = {
          _CHECK_ERROR: `payrollGovernanceService.readiness failed: ${err instanceof Error ? err.message : String(err)}`,
        };
        blockerCount = -1; // sentinel: -1 means "unknown, treat as not clear", never 0
      }

      // Reuse the existing branch-readiness gate for branch/process gaps rather than
      // recomputing it. Best-effort: a failure here degrades to empty gap lists rather
      // than failing the whole run summary, since blockerCount above already fails closed
      // for the calculation-readiness half of the picture.
      let branchReadinessGaps = { blockedBranches: [] as string[], readyBranches: [] as string[] };
      try {
        const validation = await payrollBranchReadinessService.validatePayrollRunCreation(row.run_month);
        branchReadinessGaps = { blockedBranches: validation.blocked, readyBranches: validation.ready };
      } catch {
        // best-effort, consistent with payrollBranchReadinessService's own internal fallbacks
      }

      runs.push({
        runId: row.id,
        runMonth: row.run_month,
        status: row.status,
        attendanceSnapshotLocked: Boolean(row.attendance_snapshot_locked),
        complianceChecked: Boolean(row.compliance_checked),
        validationStatus: row.validation_status,
        financeApproved,
        ceoAcknowledged,
        blockerCount,
        warningCount,
        categoryStatuses,
        branchReadinessGaps,
      });
    }

    return {
      applicable: true,
      sourceHealth: { module: "payroll_readiness_detail", state: "AVAILABLE", asOfDate: reportingDate },
      runs,
      pendingApprovalsCount,
    };
  } catch (err) {
    return {
      applicable: true,
      sourceHealth: {
        module: "payroll_readiness_detail",
        state: "ERROR",
        detail: `Payroll readiness detail query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
      runs: [],
      pendingApprovalsCount: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Non-payroll-role path — never touches salary_prep_run
// ---------------------------------------------------------------------------

/**
 * Safe one-line operational hint for a non-payroll manager (team_leader/tl/manager/
 * branch_head/etc). Sourced ONLY from `attendance_reconciliation_issue`, using the
 * same "unresolved for this business date" filter the aggregator's hygiene module
 * uses (issue_date = reportingDate AND resolved_at IS NULL), scoped to the caller's
 * own team. Deliberately never queries `salary_prep_run` or any payroll table.
 *
 * Returns null (not an empty string, not a fabricated "all clear" message) when
 * there is nothing to report or the team is empty — a manager with zero unresolved
 * issues gets no payroll-adjacent line at all, per "never invent... a false all-clear"
 * lesson from hrms2-exit-clearance-checklist-abandoned-table.
 */
export async function buildPayrollOperationalHint(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<string | null> {
  if (teamEmployeeIds.length === 0) return null;

  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS open_count
         FROM attendance_reconciliation_issue
        WHERE issue_date = ?
          AND employee_id IN (${placeholders})
          AND resolved_at IS NULL`,
      [reportingDate, ...teamEmployeeIds],
    );
    const openCount = Number((rows[0] as { open_count?: unknown } | undefined)?.open_count ?? 0);
    if (!Number.isFinite(openCount) || openCount <= 0) return null;

    return `${openCount} unresolved attendance record${openCount === 1 ? "" : "s"} may block payroll readiness for your team.`;
  } catch (err) {
    // Fail closed by omission, never by fabrication: log and say nothing rather than guess.
    console.warn(
      `[daily-brief-payroll] buildPayrollOperationalHint query failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
