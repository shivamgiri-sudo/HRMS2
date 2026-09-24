import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { refuse } from "./finance-error.js";

/**
 * Per-employee cost centre override for P&L attribution (migration 1785).
 *
 * Business case, confirmed 2026-09-16: cost centre BSS/BO/NOIDA-2/577 is a back-office pool whose
 * staff work entirely on the BSS/BO/NOIDA-2/576 (Onfido) account. Their real HR cost centre is 577
 * — roster, attendance, leave all correctly key off it — but every rupee of their pay is really
 * Onfido's cost, so leaving it there understated 576's margin and made 577 look like pure
 * unattributed cost with no revenue. This lets Finance redirect a person's cost to a different cost
 * centre FOR P&L REPORTING ONLY; employees.cost_centre_id, and everything else that reads it, is
 * never touched.
 *
 * One row per employee (unique key on employee_id): setting a new mapping for someone already
 * mapped replaces it rather than adding a second row, so there is exactly one current answer.
 * Deactivating reverts that employee to their real cost centre everywhere this is read.
 *
 * WIRING — every place payroll cost is attributed to a cost centre, branch or process reads this
 * via `overrideJoinSql()` / `payrollAttributionSql()` below and folds cost centre 577 into 576
 * automatically (owner rule 2026-09-23: a mapped employee counts in the MAPPED cost centre only):
 *   pnl-reconciliation.service.ts   readPayroll(), readUnallocatedPayroll(), exceptions()
 *   ceo-overview.service.ts         peopleByBranch() (branch and process scope)
 *   bpo-pnl.service.ts              getPayrollPeople() -> Statement byBranch/byProcess, BMC pools
 *   pnl-running-salary.service.ts   getRunningPeopleCost() (Statement running-salary path, coverage)
 *   pnl-drilldown.service.ts        people drilldown (posted, accrual and bucketed)
 *   pnl-trend.service.ts, pnl-daily-trend.service.ts, cost-centre-activity.service.ts
 * Insights consume getPnlReconciliation()'s rows, so they inherit the fix with no separate wiring.
 */

export interface PnlCostCentreOverrideSql {
  /** Empty string if the table hasn't been migrated yet — callers fall back to the raw column. */
  join: string;
  /** `COALESCE(override.target_cost_centre_id, <fallbackExpr>)`, or just fallbackExpr pre-migration. */
  effectiveCostCentreExpr: string;
}

/**
 * `employeeIdExpr` is the already-aliased employee id in the caller's query (`e.id` when joined to
 * `employees`, or `s.employee_id` when reading a snapshot table that carries no employees join).
 * `fallbackExpr` is that same query's real cost-centre column (`e.cost_centre_id`, `s.cost_centre_id`).
 */
export async function overrideJoinSql(
  employeeIdExpr: string,
  fallbackExpr: string,
  alias = "pecco",
): Promise<PnlCostCentreOverrideSql> {
  if (!(await tableExists("pnl_employee_cost_centre_override"))) {
    return { join: "", effectiveCostCentreExpr: fallbackExpr };
  }
  return {
    join: `LEFT JOIN pnl_employee_cost_centre_override ${alias} ON ${alias}.employee_id = ${employeeIdExpr} AND ${alias}.active_status = 1`,
    effectiveCostCentreExpr: `COALESCE(${alias}.target_cost_centre_id, ${fallbackExpr})`,
  };
}

export interface PayrollAttributionSql {
  /** The override join plus a LEFT JOIN of the EFFECTIVE cost centre as `ccAlias`. */
  join: string;
  effectiveCostCentreExpr: string;
  /** Branch pay counts against: the effective cost centre's branch; the home branch only when the
   *  person has no cost centre at all. */
  effectiveBranchExpr: string;
  /** Process pay counts against: for an overridden employee the MAPPED cost centre's process (home
   *  process only when that cost centre carries none); everyone else keeps `homeProcessExpr`. */
  effectiveProcessExpr: string;
}

/**
 * CANONICAL payroll attribution (owner rule, 2026-09-23): an employee mapped to a payroll cost
 * centre through pnl_employee_cost_centre_override is counted in the MAPPED cost centre only —
 * never in their home cost centre or home branch, and never in two places. One row in, one row out:
 * the override table is unique on employee_id and the cost centre join is on its primary key, so
 * neither join can fan a salary line out into two rows.
 *
 * Every payroll-by-cost-centre/branch reader builds its attribution from this (or from
 * overrideJoinSql, which it extends), so Live P&L, CEO Overview, trend, the Statement (actual and
 * running-salary paths) and the people drilldown all put the same rupee in the same place.
 */
export async function payrollAttributionSql(opts: {
  employeeIdExpr: string;
  homeCostCentreExpr: string;
  homeBranchExpr: string;
  homeProcessExpr: string;
  ccAlias?: string;
  ovAlias?: string;
}): Promise<PayrollAttributionSql> {
  const cc = opts.ccAlias ?? "pacc";
  const ovAlias = opts.ovAlias ?? "pecco";
  const ov = await overrideJoinSql(opts.employeeIdExpr, opts.homeCostCentreExpr, ovAlias);
  const overridden = ov.join ? `${ovAlias}.target_cost_centre_id IS NOT NULL` : "";
  return {
    join: `${ov.join}
       LEFT JOIN cost_centre_master ${cc} ON ${cc}.id = ${ov.effectiveCostCentreExpr}`,
    effectiveCostCentreExpr: ov.effectiveCostCentreExpr,
    effectiveBranchExpr: `CASE WHEN ${cc}.id IS NULL THEN ${opts.homeBranchExpr} ELSE ${cc}.branch_id END`,
    effectiveProcessExpr: overridden
      ? `CASE WHEN ${overridden} THEN COALESCE(${cc}.process_id, ${opts.homeProcessExpr}) ELSE ${opts.homeProcessExpr} END`
      : opts.homeProcessExpr,
  };
}

export interface CostCentreOverrideRow {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  actualCostCentreId: string | null;
  actualCostCentreCode: string | null;
  actualCostCentreName: string | null;
  targetCostCentreId: string;
  targetCostCentreCode: string | null;
  targetCostCentreName: string | null;
  targetBranchId: string | null;
  targetBranchName: string | null;
  reason: string | null;
  activeStatus: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OverrideRowSql extends RowDataPacket {
  target_branch_id: string | null;
  target_branch_name: string | null;
  id: string;
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  actual_cost_centre_id: string | null;
  actual_cost_centre_code: string | null;
  actual_cost_centre_name: string | null;
  target_cost_centre_id: string;
  target_cost_centre_code: string | null;
  target_cost_centre_name: string | null;
  reason: string | null;
  active_status: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: OverrideRowSql): CostCentreOverrideRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.employee_name,
    actualCostCentreId: r.actual_cost_centre_id,
    actualCostCentreCode: r.actual_cost_centre_code,
    actualCostCentreName: r.actual_cost_centre_name,
    targetCostCentreId: r.target_cost_centre_id,
    targetCostCentreCode: r.target_cost_centre_code,
    targetCostCentreName: r.target_cost_centre_name,
    targetBranchId: r.target_branch_id,
    targetBranchName: r.target_branch_name,
    reason: r.reason,
    activeStatus: Number(r.active_status) === 1,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Active and deactivated rows, newest first — so a user can see what they turned off, not just what's live. */
export async function listCostCentreOverrides(): Promise<CostCentreOverrideRow[]> {
  if (!(await tableExists("pnl_employee_cost_centre_override"))) return [];
  const [rows] = await db.execute<OverrideRowSql[]>(
    `SELECT ov.id, ov.employee_id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), '')) AS employee_name,
            e.cost_centre_id AS actual_cost_centre_id,
            accm.cost_centre_code AS actual_cost_centre_code,
            accm.cost_centre_name AS actual_cost_centre_name,
            ov.target_cost_centre_id,
            tccm.cost_centre_code AS target_cost_centre_code,
            tccm.cost_centre_name AS target_cost_centre_name,
            tccm.branch_id AS target_branch_id,
            tbm.branch_name AS target_branch_name,
            ov.reason, ov.active_status, ov.created_by,
            COALESCE(NULLIF(TRIM(cu.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), '')) AS created_by_name,
            ov.created_at, ov.updated_at
       FROM pnl_employee_cost_centre_override ov
       JOIN employees e ON e.id = ov.employee_id
       LEFT JOIN cost_centre_master accm ON accm.id = e.cost_centre_id
       LEFT JOIN cost_centre_master tccm ON tccm.id = ov.target_cost_centre_id
       LEFT JOIN branch_master tbm ON tbm.id = tccm.branch_id
       LEFT JOIN employees cu ON cu.id = ov.created_by
      ORDER BY ov.active_status DESC, ov.updated_at DESC`,
  );
  return rows.map(mapRow);
}

export interface OverrideCostCentreOption {
  id: string;
  code: string;
  name: string | null;
  branchId: string | null;
  branchName: string | null;
  processName: string | null;
}

/**
 * EVERY cost centre an employee's pay can be redirected to: open today (its own flag and its
 * branch's), optionally narrowed to one branch. Deliberately not paginated — the general cost-centre
 * list caps a page at 100 rows, so the mapping dropdown built on it silently showed only the first
 * 50 of ~900 cost centres.
 */
export async function listOverrideCostCentreOptions(branchId?: string | null): Promise<OverrideCostCentreOption[]> {
  const where = ["cc.active_status = 1", "COALESCE(bm.active_status, 1) = 1"];
  const params: unknown[] = [];
  if (branchId) {
    where.push("cc.branch_id = ?");
    params.push(branchId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cc.id, cc.cost_centre_code, cc.cost_centre_name, cc.branch_id, bm.branch_name,
            COALESCE(pm.process_name, cc.process_name_bill) AS process_name
       FROM cost_centre_master cc
       LEFT JOIN branch_master bm ON bm.id = cc.branch_id
       LEFT JOIN process_master pm ON pm.id = cc.process_id
      WHERE ${where.join(" AND ")}
      ORDER BY bm.branch_name, cc.cost_centre_code
      LIMIT 3000`,
    params,
  );
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.cost_centre_code ?? r.cost_centre_name ?? r.id),
    name: r.cost_centre_name ? String(r.cost_centre_name) : null,
    branchId: r.branch_id ? String(r.branch_id) : null,
    branchName: r.branch_name ? String(r.branch_name) : null,
    processName: r.process_name ? String(r.process_name) : null,
  }));
}

export interface OverrideEmployeeOption {
  id: string;
  employeeCode: string;
  name: string | null;
  branchName: string | null;
  costCentreCode: string | null;
  alreadyMappedTo: string | null;
}

/**
 * Active employees whose code or name contains `query`, straight from the employees table, so the
 * mapping screen shows who a code belongs to before anyone is mapped. Company-wide on purpose (the
 * mapping itself is company-wide and restricted to P&L writers); the general employee picker is
 * scoped to the caller's own reports and would hide most of the people Finance needs.
 */
export async function searchEmployeesForOverride(
  query: string,
  branchId?: string | null,
  limit = 20,
): Promise<OverrideEmployeeOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const where = [
    "e.active_status = 1",
    "(e.employee_code LIKE ? OR COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT_WS(' ', e.first_name, e.last_name))) LIKE ?)",
  ];
  const params: unknown[] = [like, like];
  if (branchId) {
    where.push("(e.branch_id = ? OR cc.branch_id = ?)");
    params.push(branchId, branchId);
  }
  const overrideJoin = (await tableExists("pnl_employee_cost_centre_override"))
    ? `LEFT JOIN pnl_employee_cost_centre_override ov ON ov.employee_id = e.id AND ov.active_status = 1
       LEFT JOIN cost_centre_master tcc ON tcc.id = ov.target_cost_centre_id`
    : "";
  const mappedExpr = overrideJoin ? "tcc.cost_centre_code" : "NULL";
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 20, 50));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), '')) AS name,
            bm.branch_name, cc.cost_centre_code, ${mappedExpr} AS already_mapped_to
       FROM employees e
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       ${overrideJoin}
      WHERE ${where.join(" AND ")}
      ORDER BY CASE WHEN e.employee_code = ? THEN 0 ELSE 1 END, name
      LIMIT ${safeLimit}`,
    [...params, q],
  );
  return rows.map((r) => ({
    id: String(r.id),
    employeeCode: String(r.employee_code),
    name: r.name ? String(r.name) : null,
    branchName: r.branch_name ? String(r.branch_name) : null,
    costCentreCode: r.cost_centre_code ? String(r.cost_centre_code) : null,
    alreadyMappedTo: r.already_mapped_to ? String(r.already_mapped_to) : null,
  }));
}

export interface BulkSetOverrideInput {
  employeeCodes: string[];
  targetCostCentreId: string;
  reason?: string | null;
}

export interface BulkSetOverrideResult {
  applied: { employeeId: string; employeeCode: string; employeeName: string | null }[];
  notFound: string[];
}

/**
 * Set (or replace) the P&L cost-centre mapping for a batch of employees, pasted in by code — the
 * whole point is a Finance user doing this for a pool of people in one go instead of one row at a
 * time. Unknown codes are reported back rather than silently skipped, so a typo doesn't quietly do
 * nothing.
 */
export async function bulkSetCostCentreOverride(
  input: BulkSetOverrideInput,
  actorId: string,
): Promise<BulkSetOverrideResult> {
  if (!(await tableExists("pnl_employee_cost_centre_override"))) {
    throw refuse(503, "PNL_CC_OVERRIDE_TABLE_MISSING", "pnl_employee_cost_centre_override table not yet migrated (run sql/1785).");
  }
  const codes = Array.from(new Set(input.employeeCodes.map((c) => c.trim()).filter(Boolean)));
  if (!codes.length) throw refuse(400, "PNL_CC_OVERRIDE_NO_CODES", "At least one employee code is required");
  if (!input.targetCostCentreId?.trim()) {
    throw refuse(400, "PNL_CC_OVERRIDE_TARGET_REQUIRED", "A target cost centre is required");
  }

  const [ccRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM cost_centre_master WHERE id = ?`,
    [input.targetCostCentreId],
  );
  if (!ccRows.length) throw refuse(404, "PNL_CC_OVERRIDE_TARGET_NOT_FOUND", "Target cost centre not found");

  const marksClause = codes.map(() => "?").join(",");
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '') AS name
       FROM employees WHERE employee_code IN (${marksClause})`,
    codes,
  );
  const byCode = new Map<string, { id: string; name: string | null }>();
  for (const r of empRows) byCode.set(String(r.employee_code), { id: String(r.id), name: r.name ? String(r.name) : null });

  const applied: BulkSetOverrideResult["applied"] = [];
  const notFound: string[] = [];
  for (const code of codes) {
    const emp = byCode.get(code);
    if (!emp) {
      notFound.push(code);
      continue;
    }
    await db.execute(
      `INSERT INTO pnl_employee_cost_centre_override
         (id, employee_id, target_cost_centre_id, reason, active_status, created_by, updated_by)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         target_cost_centre_id = VALUES(target_cost_centre_id),
         reason = VALUES(reason),
         active_status = 1,
         updated_by = VALUES(updated_by)`,
      [randomUUID(), emp.id, input.targetCostCentreId, input.reason?.trim() || null, actorId, actorId],
    );
    applied.push({ employeeId: emp.id, employeeCode: code, employeeName: emp.name });
  }

  if (applied.length > 0) {
    await writeAuditLog({
      actor_user_id: actorId,
      action_type: "PNL_COST_CENTRE_OVERRIDE_SET",
      module_key: "process_pnl",
      entity_type: "pnl_employee_cost_centre_override",
      entity_id: input.targetCostCentreId,
      reason: input.reason ?? undefined,
      new_value_json: { targetCostCentreId: input.targetCostCentreId, employeeCodes: applied.map((a) => a.employeeCode) },
    });
  }

  return { applied, notFound };
}

/** Reverts one employee to their real cost centre everywhere this is read. Row is kept, not deleted. */
export async function deactivateCostCentreOverride(employeeId: string, actorId: string): Promise<void> {
  if (!(await tableExists("pnl_employee_cost_centre_override"))) {
    throw refuse(503, "PNL_CC_OVERRIDE_TABLE_MISSING", "pnl_employee_cost_centre_override table not yet migrated (run sql/1785).");
  }
  const [result] = await db.execute<RowDataPacket[]>(
    `UPDATE pnl_employee_cost_centre_override SET active_status = 0, updated_by = ? WHERE employee_id = ? AND active_status = 1`,
    [actorId, employeeId],
  );
  const affected = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
  if (affected === 0) throw refuse(404, "PNL_CC_OVERRIDE_NOT_FOUND", "No active override found for this employee");

  await writeAuditLog({
    actor_user_id: actorId,
    action_type: "PNL_COST_CENTRE_OVERRIDE_DEACTIVATED",
    module_key: "process_pnl",
    entity_type: "pnl_employee_cost_centre_override",
    entity_id: employeeId,
  });
}
