/**
 * Reimbursement multi-level approval service.
 * Approval flow: draft → submitted → manager_approved → branch_head_approved → processed
 */

import { randomUUID } from "crypto";
import type { Request } from "express";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { inboxService } from "../inbox/inbox.service.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import { allocateMonthlyGrnNumber } from "../finance/grn-number-monthly.service.js";

interface ReimbursementClaim extends RowDataPacket {
  id: string; employee_id: string; branch_id: string | null; claim_type: string; claim_month: string;
  amount_claimed: number; amount_approved: number | null; description: string | null; status: string;
  manager_reviewed_by: string | null; manager_reviewed_at: string | null;
  branch_head_reviewed_by: string | null; branch_head_reviewed_at: string | null;
  converted_to_grn_id: string | null; attachment_file_path: string | null;
  attachment_original_name: string | null; attachment_mime: string | null;
}

interface EmployeeRow extends RowDataPacket {
  id: string; user_id: string | null; full_name: string; employee_code: string;
  branch_id: string | null; reporting_manager_id: string | null; manager_id: string | null;
}

function formatINR(val: number | string | null): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(val ?? 0));
}

function financialYearFromPeriod(periodCode: string): string {
  const [year, month] = periodCode.split("-").map(Number);
  if (!year || !month) throw new Error("Invalid period code");
  return month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
}

async function getEmployeeDetails(employeeId: string): Promise<EmployeeRow | null> {
  const [rows] = await db.execute<EmployeeRow[]>(
    `SELECT id, user_id, COALESCE(NULLIF(TRIM(full_name), ''), employee_code) AS full_name, employee_code, branch_id, reporting_manager_id, manager_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

async function getManagerUserId(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT mgr.user_id FROM employees emp JOIN employees mgr ON mgr.id = COALESCE(emp.reporting_manager_id, emp.manager_id) WHERE emp.id = ? AND mgr.active_status = 1 LIMIT 1`,
    [employeeId]
  );
  return (rows[0]?.user_id as string) ?? null;
}

async function getImprestManagerUserIds(branchId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT user_id FROM imprest_manager WHERE branch_id = ? AND active_status = 1 AND (effective_from IS NULL OR effective_from <= CURDATE()) AND (effective_to IS NULL OR effective_to >= CURDATE())`,
    [branchId]
  );
  return rows.map((r) => String(r.user_id)).filter(Boolean);
}

async function getUserIdFromEmployeeId(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT user_id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1", [employeeId]);
  return (rows[0]?.user_id as string) ?? null;
}

async function notifyManagerOnSubmit(claim: ReimbursementClaim, employee: EmployeeRow): Promise<void> {
  const managerUserId = await getManagerUserId(employee.id);
  if (!managerUserId) return;
  await inboxService.createItem({ user_id: managerUserId, type: "REIMBURSEMENT_MANAGER_PENDING", title: `[ACTION] Reimbursement: ${employee.full_name}`, description: `${employee.employee_code} submitted ${claim.claim_type} claim for ${formatINR(claim.amount_claimed)}`, entity_type: "employee_reimbursement_claim", entity_id: claim.id, action_url: "/payroll/reimbursements", priority: "high" });
}

async function notifyBranchHeadOnManagerApproval(claim: ReimbursementClaim, employee: EmployeeRow, branchId: string): Promise<void> {
  const userIds = await resolveRoleHolderUserIds("branch_head", branchId);
  for (const userId of userIds) {
    await inboxService.createItem({ user_id: userId, type: "REIMBURSEMENT_BRANCH_HEAD_PENDING", title: `[ACTION] Reimbursement Awaiting Branch Head`, description: `${employee.employee_code} - ${claim.claim_type} ${formatINR(claim.amount_claimed)}`, entity_type: "employee_reimbursement_claim", entity_id: claim.id, action_url: "/payroll/reimbursements", priority: "high" });
  }
}

async function notifyConversionReady(claim: ReimbursementClaim, employee: EmployeeRow, branchId: string): Promise<void> {
  const adminIds = await resolveRoleHolderUserIds("branch_admin", branchId);
  const imprestIds = await getImprestManagerUserIds(branchId);
  const allIds = [...new Set([...adminIds, ...imprestIds])];
  for (const userId of allIds) {
    await inboxService.createItem({ user_id: userId, type: "REIMBURSEMENT_GRN_READY", title: `Reimbursement Ready for GRN`, description: `${employee.employee_code} - ${claim.claim_type} ${formatINR(claim.amount_approved ?? claim.amount_claimed)}`, entity_type: "employee_reimbursement_claim", entity_id: claim.id, action_url: "/payroll/reimbursements", priority: "normal" });
  }
}

async function notifyEmployeeOnDecision(claim: ReimbursementClaim, employee: EmployeeRow, decision: "approved" | "rejected", stage: "manager" | "branch_head", reason?: string): Promise<void> {
  const userId = await getUserIdFromEmployeeId(employee.id);
  if (!userId) return;
  await inboxService.createItem({ user_id: userId, type: decision === "approved" ? "REIMBURSEMENT_APPROVED" : "REIMBURSEMENT_REJECTED", title: `Your reimbursement was ${decision} by ${stage === "manager" ? "Manager" : "Branch Head"}`, description: reason ? `${claim.claim_type} - ${reason}` : `${claim.claim_type} ${formatINR(claim.amount_claimed)}`, entity_type: "employee_reimbursement_claim", entity_id: claim.id, action_url: "/payroll/reimbursements", priority: "normal" });
}

async function resolveInboxItems(claimId: string, types: string[]): Promise<void> {
  await inboxService.resolveItems({ entity_type: "employee_reimbursement_claim", entity_id: claimId, types });
}

export const reimbursementService = {
  async submit(claimId: string, actorUserId: string, req?: Request): Promise<{ success: true }> {
    const [claimRows] = await db.execute<ReimbursementClaim[]>(`SELECT c.*, e.branch_id FROM employee_reimbursement_claim c JOIN employees e ON e.id = c.employee_id WHERE c.id = ? LIMIT 1`, [claimId]);
    const claim = claimRows[0]; if (!claim) throw new Error("Claim not found"); if (claim.status !== "draft") throw new Error(`Only draft claims can be submitted`);
    const employee = await getEmployeeDetails(claim.employee_id); if (!employee) throw new Error("Employee not found"); if (employee.user_id !== actorUserId) throw new Error("You can only submit your own claims");
    await db.execute<ResultSetHeader>(`UPDATE employee_reimbursement_claim SET status = 'submitted', submitted_at = NOW(), branch_id = ? WHERE id = ?`, [employee.branch_id, claimId]);
    await notifyManagerOnSubmit({ ...claim, branch_id: employee.branch_id }, employee);
    void logSensitiveAction({ actor_user_id: actorUserId, actor_role: "employee", action_type: "reimbursement_submitted", module_key: "payroll_reimbursements", entity_type: "employee_reimbursement_claim", entity_id: claimId, old_value_json: { status: "draft" }, new_value_json: { status: "submitted" }, req });
    return { success: true };
  },

  async managerApprove(claimId: string, actorUserId: string, note?: string, amountApproved?: number, req?: Request): Promise<{ success: true }> {
    const [claimRows] = await db.execute<ReimbursementClaim[]>(`SELECT c.*, e.branch_id FROM employee_reimbursement_claim c JOIN employees e ON e.id = c.employee_id WHERE c.id = ? LIMIT 1`, [claimId]);
    const claim = claimRows[0]; if (!claim) throw new Error("Claim not found"); if (claim.status !== "submitted") throw new Error(`Only submitted claims can be approved by manager`);
    const employee = await getEmployeeDetails(claim.employee_id); if (!employee) throw new Error("Employee not found");
    const managerId = employee.reporting_manager_id ?? employee.manager_id; if (!managerId) throw new Error("Employee has no manager");
    const [mgrRows] = await db.execute<RowDataPacket[]>("SELECT user_id FROM employees WHERE id = ? LIMIT 1", [managerId]); if ((mgrRows[0]?.user_id as string) !== actorUserId) throw new Error("Only the reporting manager can approve");
    const branchId = employee.branch_id ?? claim.branch_id; if (!branchId) throw new Error("No branch"); const finalAmount = amountApproved ?? claim.amount_claimed;
    await db.execute<ResultSetHeader>(`UPDATE employee_reimbursement_claim SET status = 'manager_approved', manager_reviewed_by = ?, manager_reviewed_at = NOW(), manager_review_note = ?, amount_approved = ?, branch_id = ? WHERE id = ?`, [actorUserId, note ?? null, finalAmount, branchId, claimId]);
    await resolveInboxItems(claimId, ["REIMBURSEMENT_MANAGER_PENDING"]);
    await notifyBranchHeadOnManagerApproval({ ...claim, branch_id: branchId, amount_approved: finalAmount }, employee, branchId);
    void logSensitiveAction({ actor_user_id: actorUserId, actor_role: "manager", action_type: "reimbursement_manager_approved", module_key: "payroll_reimbursements", entity_type: "employee_reimbursement_claim", entity_id: claimId, old_value_json: { status: "submitted" }, new_value_json: { status: "manager_approved", amount_approved: finalAmount }, req });
    return { success: true };
  },

  async managerReject(claimId: string, actorUserId: string, reason: string, req?: Request): Promise<{ success: true }> {
    if (!reason?.trim()) throw new Error("Rejection reason required");
    const [claimRows] = await db.execute<ReimbursementClaim[]>("SELECT * FROM employee_reimbursement_claim WHERE id = ? LIMIT 1", [claimId]);
    const claim = claimRows[0]; if (!claim) throw new Error("Claim not found"); if (claim.status !== "submitted") throw new Error(`Only submitted claims can be rejected`);
    const employee = await getEmployeeDetails(claim.employee_id); if (!employee) throw new Error("Employee not found");
    await db.execute<ResultSetHeader>(`UPDATE employee_reimbursement_claim SET status = 'rejected', manager_reviewed_by = ?, manager_reviewed_at = NOW(), rejection_reason = ? WHERE id = ?`, [actorUserId, reason.trim(), claimId]);
    await resolveInboxItems(claimId, ["REIMBURSEMENT_MANAGER_PENDING"]);
    await notifyEmployeeOnDecision(claim, employee, "rejected", "manager", reason.trim());
    void logSensitiveAction({ actor_user_id: actorUserId, actor_role: "manager", action_type: "reimbursement_manager_rejected", module_key: "payroll_reimbursements", entity_type: "employee_reimbursement_claim", entity_id: claimId, old_value_json: { status: "submitted" }, new_value_json: { status: "rejected" }, req });
    return { success: true };
  },

  async branchHeadApprove(claimId: string, actorUserId: string, note?: string, amountApproved?: number, req?: Request): Promise<{ success: true }> {
    const [claimRows] = await db.execute<ReimbursementClaim[]>(`SELECT c.*, e.branch_id FROM employee_reimbursement_claim c JOIN employees e ON e.id = c.employee_id WHERE c.id = ? LIMIT 1`, [claimId]);
    const claim = claimRows[0]; if (!claim) throw new Error("Claim not found"); if (claim.status !== "manager_approved") throw new Error(`Only manager-approved claims can be approved by branch head`);
    const employee = await getEmployeeDetails(claim.employee_id); if (!employee) throw new Error("Employee not found");
    const branchId = claim.branch_id ?? employee.branch_id; if (!branchId) throw new Error("No branch"); const finalAmount = amountApproved ?? claim.amount_approved ?? claim.amount_claimed;
    await db.execute<ResultSetHeader>(`UPDATE employee_reimbursement_claim SET status = 'branch_head_approved', branch_head_reviewed_by = ?, branch_head_reviewed_at = NOW(), branch_head_review_note = ?, amount_approved = ? WHERE id = ?`, [actorUserId, note ?? null, finalAmount, claimId]);
    await resolveInboxItems(claimId, ["REIMBURSEMENT_BRANCH_HEAD_PENDING"]);
    await notifyConversionReady({ ...claim, amount_approved: finalAmount }, employee, branchId);
    await notifyEmployeeOnDecision({ ...claim, amount_approved: finalAmount }, employee, "approved", "branch_head");
    void logSensitiveAction({ actor_user_id: actorUserId, actor_role: "branch_head", action_type: "reimbursement_branch_head_approved", module_key: "payroll_reimbursements", entity_type: "employee_reimbursement_claim", entity_id: claimId, old_value_json: { status: "manager_approved" }, new_value_json: { status: "branch_head_approved", amount_approved: finalAmount }, req });
    return { success: true };
  },

  async branchHeadReject(claimId: string, actorUserId: string, reason: string, req?: Request): Promise<{ success: true }> {
    if (!reason?.trim()) throw new Error("Rejection reason required");
    const [claimRows] = await db.execute<ReimbursementClaim[]>("SELECT * FROM employee_reimbursement_claim WHERE id = ? LIMIT 1", [claimId]);
    const claim = claimRows[0]; if (!claim) throw new Error("Claim not found"); if (claim.status !== "manager_approved") throw new Error(`Only manager-approved claims can be rejected`);
    const employee = await getEmployeeDetails(claim.employee_id); if (!employee) throw new Error("Employee not found");
    await db.execute<ResultSetHeader>(`UPDATE employee_reimbursement_claim SET status = 'rejected', branch_head_reviewed_by = ?, branch_head_reviewed_at = NOW(), rejection_reason = ? WHERE id = ?`, [actorUserId, reason.trim(), claimId]);
    await resolveInboxItems(claimId, ["REIMBURSEMENT_BRANCH_HEAD_PENDING"]);
    await notifyEmployeeOnDecision(claim, employee, "rejected", "branch_head", reason.trim());
    void logSensitiveAction({ actor_user_id: actorUserId, actor_role: "branch_head", action_type: "reimbursement_branch_head_rejected", module_key: "payroll_reimbursements", entity_type: "employee_reimbursement_claim", entity_id: claimId, old_value_json: { status: "manager_approved" }, new_value_json: { status: "rejected" }, req });
    return { success: true };
  },

  async convertToImprestGrn(claimId: string, actorUserId: string, actorRole: string): Promise<{ grnId: string; grnNumber: string }> {
    const connection = (await db.getConnection()) as PoolConnection;
    try {
      await connection.beginTransaction();
      const [claimRows] = await connection.execute<ReimbursementClaim[]>(`SELECT c.*, e.branch_id AS emp_branch_id, COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name, e.employee_code FROM employee_reimbursement_claim c JOIN employees e ON e.id = c.employee_id WHERE c.id = ? AND c.status = 'branch_head_approved' FOR UPDATE`, [claimId]);
      const claim = claimRows[0] as ReimbursementClaim & { emp_branch_id: string | null; employee_name: string; employee_code: string };
      if (!claim) throw new Error("Claim not found or not branch_head_approved"); if (claim.converted_to_grn_id) throw new Error("Already converted");
      const branchId = claim.branch_id ?? claim.emp_branch_id; if (!branchId) throw new Error("No branch");
      const [managerRows] = await connection.execute<RowDataPacket[]>(`SELECT id FROM imprest_manager WHERE branch_id = ? AND active_status = 1 AND (effective_from IS NULL OR effective_from <= CURDATE()) AND (effective_to IS NULL OR effective_to >= CURDATE()) LIMIT 1`, [branchId]);
      if (!managerRows.length) throw new Error("No active imprest manager for branch");
      const accountingPeriod = new Date().toISOString().slice(0, 7); const financialYear = financialYearFromPeriod(accountingPeriod);
      const grnNumber = await allocateMonthlyGrnNumber({ periodCode: accountingPeriod, connection }); const grnId = randomUUID();
      const amount = Number(claim.amount_approved ?? claim.amount_claimed); const billDate = new Date().toISOString().slice(0, 10);
      await connection.execute(`INSERT INTO grn_request (id, grn_number, grn_type, branch_id, status, is_unbudgeted, head, sub_head, description, remarks, quantity, unit, unit_rate, amount_without_tax, tax_amount, amount_with_tax, pnl_cost_amount, amount, bill_date, accounting_period, financial_year, attachment_file_path, attachment_original_name, attachment_mime, branch_head_reviewed_by, branch_head_reviewed_at, branch_head_review_note, submitted_by, submitted_at, created_by, created_at, source_reimbursement_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`, [grnId, grnNumber, "imprest", branchId, "branch_head_approved", 1, "REIMBURSEMENT", claim.claim_type, `Reimbursement: ${claim.description ?? claim.claim_type}`, `From reimbursement. Employee: ${claim.employee_name} (${claim.employee_code})`, 1, "amount", amount, amount, 0, amount, amount, amount, billDate, accountingPeriod, financialYear, claim.attachment_file_path, claim.attachment_original_name, claim.attachment_mime, claim.branch_head_reviewed_by, claim.branch_head_reviewed_at, `Auto-approved from reimbursement ${claimId}`, actorUserId, new Date(), actorUserId, claimId]);
      await connection.execute(`INSERT INTO grn_cost_allocation (id, grn_request_id, sequence_no, branch_id, allocation_percentage, quantity, unit, amount_without_tax, tax_amount, amount_with_tax, pnl_cost_amount, lifecycle_status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), grnId, 1, branchId, 100, 1, "amount", amount, 0, amount, amount, "reserved", actorUserId]);
      await connection.execute(`UPDATE employee_reimbursement_claim SET converted_to_grn_id = ?, converted_at = NOW(), converted_by = ? WHERE id = ?`, [grnId, actorUserId, claimId]);
      await recordFinanceApprovalEvent({ entityType: "grn", entityId: grnId, action: "create_from_reimbursement", fromStatus: null, toStatus: "branch_head_approved", actorUserId, actorRole, remarks: `From reimbursement ${claimId}`, details: { sourceClaimId: claimId } }, connection);
      await connection.commit(); await resolveInboxItems(claimId, ["REIMBURSEMENT_GRN_READY"]); return { grnId, grnNumber };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },

  async getManagerQueue(managerUserId: string): Promise<ReimbursementClaim[]> {
    const [rows] = await db.execute<ReimbursementClaim[]>(`SELECT c.*, COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name, e.employee_code FROM employee_reimbursement_claim c JOIN employees e ON e.id = c.employee_id JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id) WHERE c.status = 'submitted' AND mgr.user_id = ? ORDER BY c.submitted_at ASC`, [managerUserId]);
    return rows;
  },

  async getBranchHeadQueue(branchIds: string[]): Promise<ReimbursementClaim[]> {
    if (!branchIds.length) return [];
    const [rows] = await db.execute<ReimbursementClaim[]>(`SELECT c.*, COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name, e.employee_code FROM employee_reimbursement_claim c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'manager_approved' AND c.branch_id IN (${branchIds.map(() => "?").join(",")}) ORDER BY c.manager_reviewed_at ASC`, branchIds);
    return rows;
  },

  async getConversionQueue(branchIds?: string[]): Promise<ReimbursementClaim[]> {
    let query = `SELECT c.*, COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name, e.employee_code FROM employee_reimbursement_claim c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'branch_head_approved' AND c.converted_to_grn_id IS NULL`;
    const params: string[] = [];
    if (branchIds?.length) { query += ` AND c.branch_id IN (${branchIds.map(() => "?").join(",")})`; params.push(...branchIds); }
    const [rows] = await db.execute<ReimbursementClaim[]>(query + " ORDER BY c.branch_head_reviewed_at ASC", params);
    return rows;
  },
};
