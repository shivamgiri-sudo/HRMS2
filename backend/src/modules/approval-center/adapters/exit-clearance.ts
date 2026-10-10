import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { canClearTask, CLEARANCE_ROLE_MAP } from "../../exit/exit.routes.js";
import { callerRoleKeys } from "./_roles.js";
import { keepApproverOrBranchRole, keepInBranch } from "./_scope.js";

/** Same mapping the work inbox uses for an exit clearance task's action_url. */
const PAGE_BY_OWNER_ROLE: Record<string, string> = {
  manager: "/provisioning/manager-handover",
  hr: "/provisioning/hr-exit",
  admin: "/provisioning/admin",
  wfm: "/provisioning/wfm-alignment",
  payroll: "/provisioning/payroll-exit",
  it: "/provisioning/it",
};

const AREA_LABEL: Record<string, string> = {
  manager: "Manager handover",
  hr: "HR",
  compliance: "Compliance",
  assets: "Assets",
  it: "IT access",
  wfm: "WFM",
  payroll: "Payroll",
  finance: "Finance",
};

/**
 * Exit clearance task. /api/exit/clearance/queue is already limited to the caller's own owner_role(s) and branch
 * scope; on top of that the PATCH endpoint only lets roles mapped to the task's clearance_area clear it, so we apply
 * the module's own canClearTask() and show only tasks the caller can actually clear.
 * Decline = mark the task "blocked" with a remark (the module's only non-clear outcome that needs no waiver reason).
 */
export const exitClearanceAdapter: ApprovalAdapter = {
  kind: "exit_clearance",
  label: "Exit clearance",
  category: "Exit",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/exit/clearance/queue", { query: { status: "pending,in_progress,blocked", limit: 200 } });
    const rows: any[] = res?.data ?? [];
    if (rows.length === 0) return [];
    const roles = await callerRoleKeys(ctx.userId);
    // Owner policy: the manager-handover task belongs to the leaver's effective approver (admin / branch_head only inside their own
    // branch, and only when the leaver has no resolvable approver); every other area (hr, it, wfm, payroll, ...) is a departmental task limited to the branch on the caller's own record
    // unless they are org-wide (admin is a wildcard in canClearTask but is NOT org-wide).
    // canClearTask lets super_admin / admin clear ANY area (a bypass). A departmental task is designated by ROLE, so for those areas
    // the caller must literally hold one of the area's own roles (CLEARANCE_ROLE_MAP); the manager-handover area is gated below by
    // the effective-approver rule, with canClearTask only confirming the module would accept the caller.
    const clearable = rows.filter((r) => {
      const area = str(r.clearance_area);
      if (area === "manager") return canClearTask(area, roles);
      return (CLEARANCE_ROLE_MAP[area] ?? [area]).some((role) => roles.includes(role));
    });
    const refOf = (r: any) => ({ employeeId: r.employee_id, employeeCode: r.employee_code });
    const mgr = await keepApproverOrBranchRole(ctx.userId, clearable.filter((r) => str(r.clearance_area) === "manager"), refOf, ["admin", "branch_head"]);
    const dept = await keepInBranch(ctx.userId, clearable.filter((r) => str(r.clearance_area) !== "manager"), refOf);
    const allowedIds = new Set([...mgr, ...dept].map((r) => String(r.id)));
    const out: ApprovalItem[] = [];
    for (const r of clearable) {
      if (!allowedIds.has(String(r.id))) continue;
      const exitReqId = str(r.exit_request_id);
      const owner = str(r.owner_role);
      const area = str(r.clearance_area);
      const overdue = r.due_date ? new Date(str(r.due_date).slice(0, 10)).getTime() < Date.now() : false;
      out.push({
        uid: `exit_clearance:${r.id}`,
        kind: "exit_clearance",
        kindLabel: "Exit clearance",
        category: "Exit",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — ${str(r.task_title) || `${AREA_LABEL[area] ?? area} clearance`}`,
        subtitle: [AREA_LABEL[area] ?? area, r.due_date ? `due ${str(r.due_date).slice(0, 10)}` : ""].filter(Boolean).join(" · "),
        requester: { name: r.employee_name, code: r.employee_code, branch: r.branch_name },
        stage: `${AREA_LABEL[area] ?? area} clearance${str(r.status) === "blocked" ? " (blocked)" : ""}`,
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          f("Process", r.process_name),
          badge("Clearance area", AREA_LABEL[area] ?? area),
          f("Task", r.task_title),
          long("Description", r.task_description),
          date("Due date", r.due_date),
          badge("Task status", str(r.status).replace(/_/g, " ")),
          badge("Exit status", str(r.exit_status).replace(/_/g, " ")),
          date("Last working day", r.last_working_day_confirmed ?? r.last_working_day_proposed),
          badge("NOC case", str(r.noc_case_status).replace(/_/g, " ")),
          f("Attachment", r.attachment_url ? "Attached" : ""),
          long("Existing remarks", r.remarks),
        ),
        submittedAt: iso(r.created_at),
        priority: overdue || str(r.status) === "blocked" ? "high" : "normal",
        viewPath: `${PAGE_BY_OWNER_ROLE[owner] ?? "/exit/command-center"}?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: "Mark cleared",
        rejectLabel: "Mark blocked",
        meta: { exitRequestId: exitReqId },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const exitRequestId = str(item.meta?.exitRequestId);
    if (!exitRequestId) throw new Error("Clearance task is missing its exit request reference");
    await ctx.call("PATCH", `/api/exit/${encodeURIComponent(exitRequestId)}/clearance/${encodeURIComponent(item.id)}`, {
      body: { status: action === "approve" ? "cleared" : "blocked", remarks: remarks || undefined },
    });
  },
};
