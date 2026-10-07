import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";

const STALE_DAYS = 3;

/**
 * Internal job posting application, manager step. Lists only applications whose assigned manager is the caller and
 * whose status is pending_manager, via the read-only GET /api/ijp/applications/pending-manager (the caller's own rows),
 * so every row is one PATCH /applications/:id/manager-action will accept from them. Reject remarks are optional in the
 * route. There is no manager screen for IJP in the app today, so the View link opens the IJP page.
 */
export const ijpManagerAdapter: ApprovalAdapter = {
  kind: "ijp_manager",
  label: "Internal job application",
  category: "Recruitment",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/ijp/applications/pending-manager", { query: { limit: 200 } });
    const rows: any[] = (res?.applications ?? []).slice(0, 200);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.status) !== "pending_manager") continue;
      const applied = iso(r.applied_at);
      const ageDays = applied ? (Date.now() - new Date(applied).getTime()) / 86_400_000 : 0;
      out.push({
        uid: `ijp_manager:${r.id}`,
        kind: "ijp_manager",
        kindLabel: "Internal job application",
        category: "Recruitment",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — applied for ${str(r.job_title) || "internal posting"}`,
        subtitle: [str(r.posting_code), str(r.current_designation_name)].filter(Boolean).join(" · ") || undefined,
        requester: { name: str(r.employee_name), code: r.employee_code, branch: r.current_branch_name },
        stage: "Reporting manager approval",
        fields: fields(
          f("Employee", str(r.employee_name)),
          f("Employee code", r.employee_code),
          f("Applied for", r.job_title),
          f("Posting code", r.posting_code),
          f("Current designation", r.current_designation_name),
          f("Current department", r.current_department_name),
          f("Current process", r.current_process_name),
          f("Current branch", r.current_branch_name),
          f("Tenure (months)", r.tenure_months),
          long("Employee's note", r.application_note),
          date("Applied on", r.applied_at),
          badge("Next step", "HR review after your approval"),
        ),
        submittedAt: applied,
        priority: ageDays > STALE_DAYS ? "high" : "normal",
        viewPath: `/people/ijp?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("PATCH", `/api/ijp/applications/${encodeURIComponent(item.id)}/manager-action`, {
      body: { action, remarks: remarks || undefined },
    });
  },
};
