import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays } from "./payroll-shared.js";
import { callerHolds, callerScope, keepEmployeeRowsInBranch } from "./scope-guard.js";

const SAFE = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

function mapDispute(r: any, stage: "wfm" | "payroll_head"): ApprovalItem {
  const dates: string[] = Array.isArray(r.affected_dates) ? r.affected_dates : [];
  const type = str(r.dispute_type).replace(/_/g, " ");
  const corrective = r.wfm_corrective_json && typeof r.wfm_corrective_json === "object" ? JSON.stringify(r.wfm_corrective_json) : "";
  const wfm = stage === "wfm";
  const age = ageDays(r.created_at);
  return {
    uid: `salary_dispute:${r.id}`,
    kind: "salary_dispute",
    kindLabel: "Salary dispute",
    category: "Payroll",
    id: String(r.id),
    title: `${str(r.employee_name) || str(r.employee_code) || "Employee"} — salary dispute ${str(r.run_month)}`,
    subtitle: type,
    requester: { name: r.employee_name, code: r.employee_code },
    stage: wfm ? "Stage 1 of 2 — WFM / Payroll HR validation" : "Stage 2 of 2 — Payroll Head final approval",
    fields: fields(
      f("Employee", r.employee_name),
      f("Employee code", r.employee_code),
      f("Payroll month", r.run_month),
      badge("Dispute type", type),
      f("Affected dates", dates.map((d) => str(d).slice(0, 10)).join(", ")),
      long("Employee's description", r.description),
      money("WFM differential amount", r.differential_amount),
      f("Differential basis", r.differential_basis),
      long("WFM corrective data", corrective),
      long("WFM remarks", r.wfm_remarks),
      date("WFM reviewed on", r.wfm_reviewed_at),
      date("Raised on", r.created_at),
    ),
    submittedAt: iso(r.created_at),
    priority: age !== null && age >= 5 ? "high" : "normal",
    viewPath: `/payroll/salary-disputes?tab=queue&approvalId=${encodeURIComponent(String(r.id))}`,
    // Both review endpoints demand remarks >= 10 chars for approve AND reject.
    rejectNeedsReason: true,
        rejectMinLength: 10,
    // WFM approve needs a differentialAmount (and optional corrective data) typed by WFM; nothing in the row proposes it,
    // so the popup can only reject at stage 1. Approve = open the page.
    meta: { stage, ...(wfm ? { viewOnly: true, approveViewOnly: true } : {}) },
  };
}

/** Salary dispute: WFM queue (stage 1) + Payroll Head queue (stage 2). Each queue is role-gated by its own endpoint. */
export const salaryDisputeAdapter: ApprovalAdapter = {
  kind: "salary_dispute",
  label: "Salary dispute",
  category: "Payroll",
  async list(ctx) {
    const [wfm, ph] = await Promise.all([
      SAFE(ctx.call("GET", "/api/salary-disputes/queue/wfm")),
      SAFE(ctx.call("GET", "/api/salary-disputes/queue/payroll-head")),
    ]);
    // WFM / Payroll HR / payroll are branch roles: the WFM queue is already scoped by the module, but it also includes the
    // caller's own dispute, so both stages are narrowed to the caller's own branch (org-wide: all) and never their own.
    const me = await callerScope(ctx);
    // Stage roles as the queue endpoints name them; literal match (super_admin alone passes the endpoint guard but is not designated).
    const wfmRows = !callerHolds(me, "wfm", "payroll_hr", "payroll", "super_admin") ? [] : await keepEmployeeRowsInBranch(me, ((wfm?.data ?? []) as any[]).filter((r) => r.status === "pending_wfm").slice(0, 200), (r) => r.employee_id);
    const phRows = !callerHolds(me, "payroll_head", "super_admin") ? [] : await keepEmployeeRowsInBranch(me, ((ph?.data ?? []) as any[]).filter((r) => r.status === "pending_payroll_head").slice(0, 200), (r) => r.employee_id);
    return [...wfmRows.map((r) => mapDispute(r, "wfm")), ...phRows.map((r) => mapDispute(r, "payroll_head"))];
  },
  async decide(ctx, item, action, remarks) {
    const stage = item.meta?.stage;
    const id = encodeURIComponent(item.id);
    if (stage === "payroll_head") {
      const text = action === "approve" && remarks.trim().length < 10 ? "Approved via Approval Center" : remarks;
      await ctx.call("POST", `/api/salary-disputes/${id}/payroll-head-review`, { body: { action, remarks: text } });
      return;
    }
    if (action === "approve") {
      throw new Error("WFM approval needs a differential amount — open the dispute and enter it on the Salary Disputes page.");
    }
    await ctx.call("POST", `/api/salary-disputes/${id}/wfm-review`, { body: { action: "reject", remarks } });
  },
};
