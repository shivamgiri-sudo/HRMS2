import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { callerHasRole } from "./_roles.js";

/** Same role set PATCH /api/exit/:id/approve and /return demand. Scope is enforced by the endpoint itself (guardExitEmployee). */
const DECIDER_ROLES = ["manager", "assistant_manager", "process_manager", "branch_head", "admin", "hr", "super_admin"];
/** exit.service ALLOWED_TRANSITIONS: both of these can go to notice_active (approve) or returned. */
const PENDING_STATUSES = ["submitted", "manager_review"];
const OVERDUE_DAYS = 7;

/**
 * Resignation / exit approval. The list endpoint already narrows a manager to their own direct reports and
 * hr/admin to their branch scope; here we only keep the pending statuses and drop the caller's own resignation.
 * Decline maps to the module's "return to employee" (push-back) transition, which needs a reason.
 */
export const exitResignationAdapter: ApprovalAdapter = {
  kind: "exit_resignation",
  label: "Resignation",
  category: "Exit",
  async list(ctx) {
    if (!(await callerHasRole(ctx.userId, ...DECIDER_ROLES))) return [];
    const out: ApprovalItem[] = [];
    const seen = new Set<string>();
    for (const status of PENDING_STATUSES) {
      const res = await ctx.call("GET", "/api/exit", { query: { status, limit: 100 } });
      const rows: any[] = res?.data ?? [];
      for (const r of rows) {
        const id = String(r.id);
        if (seen.has(id)) continue;
        seen.add(id);
        if (!PENDING_STATUSES.includes(str(r.status))) continue;
        // Never ask someone to approve a resignation they tendered themselves.
        if (str(r.initiated_by) === "employee" && str(r.initiated_by_user_id) === ctx.userId) continue;
        const submitted = iso(r.submitted_at ?? r.created_at);
        const ageDays = submitted ? (Date.now() - new Date(submitted).getTime()) / 86_400_000 : 0;
        const lwd = r.last_working_day_proposed;
        out.push({
          uid: `exit_resignation:${id}`,
          kind: "exit_resignation",
          kindLabel: "Resignation",
          category: "Exit",
          id,
          title: `${str(r.employee_name) || "Employee"} — resignation`,
          subtitle: [str(r.exit_reason_category), lwd ? `proposed LWD ${str(lwd).slice(0, 10)}` : ""].filter(Boolean).join(" · ") || undefined,
          requester: { name: r.employee_name, code: r.employee_code, branch: r.branch_name },
          stage: "Manager approval",
          fields: fields(
            f("Employee", r.employee_name),
            f("Employee code", r.employee_code),
            f("Branch", r.branch_name),
            f("Process", r.process_name),
            f("Department", r.department_name),
            f("Reporting manager", r.reporting_manager_name),
            badge("Exit type", [str(r.exit_type), str(r.exit_sub_type)].filter(Boolean).join(" / ")),
            f("Reason category", r.exit_reason_category),
            long("Resignation reason", r.resignation_reason),
            date("Proposed last working day", lwd),
            f("Notice period (days)", r.notice_period_days),
            date("Submitted on", r.submitted_at ?? r.created_at),
            f("Raised by", r.initiated_by),
            f("Attrition risk", r.risk_label),
            f("Engagement score", r.engagement_score),
            r.regrettable_exit ? f("Regrettable exit", "Yes") : null,
            long("Earlier push-back reason", r.return_reason),
          ),
          submittedAt: submitted,
          priority: ageDays > OVERDUE_DAYS ? "high" : "normal",
          viewPath: `/exit/command-center?tab=overview&approvalId=${encodeURIComponent(id)}`,
          rejectNeedsReason: true,
          approveLabel: "Approve resignation",
          rejectLabel: "Return to employee",
        });
      }
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/exit/${encodeURIComponent(item.id)}`;
    if (action === "approve") {
      await ctx.call("PATCH", `${base}/approve`, { body: {} });
    } else {
      await ctx.call("PATCH", `${base}/return`, { body: { reason: remarks } });
    }
  },
};
