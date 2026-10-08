import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, str } from "../format.js";
import { hasAnyRole, hasScopedAccess } from "../../../shared/scopeAccess.js";
import { APPROVER_ROLES, PAYROLL_APPROVER_ROLES } from "../../bulk-upload/bulk-approval.service.js";
import { ageDays } from "./payroll-shared.js";

const TYPE_LABEL: Record<string, string> = {
  ATTENDANCE_REGULARIZATION_BULK: "Attendance regularization",
  LEAVE_APPLICATION_BULK: "Leave application",
  INCENTIVE_BULK: "Incentive",
  DEDUCTION_BULK: "Deduction",
};

/**
 * Bulk upload approvals (branch head stage, then payroll head for incentive/deduction).
 * The pending endpoint is branch-scoped but shows both stages to either role, so the rows are narrowed to what assertCanApprove would
 * allow: stage role (branch_head / payroll_head, super_admin always), not the uploader, a payroll-stage approver who did not
 * also approve at branch stage, and (branch stage) a branch inside the caller's assignment scope.
 */
export const bulkUploadAdapter: ApprovalAdapter = {
  kind: "bulk_upload",
  label: "Bulk upload",
  category: "Admin",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/bulk-upload/approvals/pending");
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    if (rows.length === 0) return [];
    const [isSuper, isBranch, isPayroll] = await Promise.all([
      hasAnyRole(ctx.userId, "super_admin"),
      hasAnyRole(ctx.userId, ...APPROVER_ROLES),
      hasAnyRole(ctx.userId, ...PAYROLL_APPROVER_ROLES),
    ]);
    const scopeCache = new Map<string, boolean>();
    const inBranchScope = async (branchId: string): Promise<boolean> => {
      if (!scopeCache.has(branchId)) {
        scopeCache.set(
          branchId,
          await hasScopedAccess(ctx.userId, APPROVER_ROLES, { branchId }, { allowAdminBypass: false, requireScopeForNonAdmin: true }),
        );
      }
      return scopeCache.get(branchId)!;
    };

    const out: ApprovalItem[] = [];
    for (const r of rows) {
      const stage = r.approval_status === "pending_branch_head" ? "branch" : r.approval_status === "pending_payroll_head" ? "payroll" : null;
      if (!stage) continue;
      if (!isSuper) {
        if (r.uploaded_by && String(r.uploaded_by) === String(ctx.userId)) continue;
        if (stage === "branch") {
          if (!isBranch) continue;
          if (r.branch_id && !(await inBranchScope(String(r.branch_id)))) continue;
        } else {
          if (!isPayroll) continue;
          if (r.branch_head_approved_by && String(r.branch_head_approved_by) === String(ctx.userId)) continue;
        }
      }
      const type = TYPE_LABEL[str(r.upload_type_code)] ?? str(r.upload_type_code);
      const age = ageDays(r.submitted_for_approval_at ?? r.created_at);
      out.push({
        uid: `bulk_upload:${r.id}`,
        kind: "bulk_upload",
        kindLabel: "Bulk upload",
        category: "Admin",
        id: String(r.id),
        title: `${type} upload ${str(r.upload_batch_no)}`,
        subtitle: `${str(r.imported_rows ?? r.total_rows)} row(s)${r.branch_name ? ` · ${str(r.branch_name)}` : ""}`,
        requester: { name: r.uploaded_by_name, branch: r.branch_name },
        stage: stage === "branch" ? "Stage 1 — Branch Head" : "Stage 2 — Payroll Head (final)",
        fields: fields(
          f("Batch no", r.upload_batch_no),
          badge("Upload type", type),
          f("File", r.original_file_name),
          f("Branch", r.branch_name),
          f("Total rows", r.total_rows),
          f("Imported rows", r.imported_rows),
          f("Error rows", r.error_rows),
          f("Uploaded by", r.uploaded_by_name),
          date("Submitted on", r.submitted_for_approval_at ?? r.created_at),
          date("Branch Head approved on", r.branch_head_approved_at),
          f("Branch Head remarks", r.branch_head_remarks),
        ),
        submittedAt: iso(r.submitted_for_approval_at ?? r.created_at),
        priority: age !== null && age >= 3 ? "high" : "normal",
        viewPath: `/bulk-upload/approvals?approvalId=${encodeURIComponent(String(r.id))}`,
        // reject: remarks >= 10 chars; approve is async (202) and applies rows, so review the preview on the page first.
        rejectNeedsReason: true,
        rejectMinLength: 10,
        meta: { stage, upload_type: str(r.upload_type_code) },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/bulk-upload/approvals/batches/${encodeURIComponent(item.id)}/${action === "approve" ? "approve" : "reject"}`, {
      body: { remarks: remarks || undefined },
    });
  },
};
