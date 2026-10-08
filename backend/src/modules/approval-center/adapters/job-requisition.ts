import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";

const yn = (v: unknown) => (v === true || v === 1 || v === "1" ? "Yes" : "");
const range = (a: unknown, b: unknown, unit = "") => {
  const x = str(a), y = str(b);
  if (!x && !y) return "";
  return `${x || "?"} – ${y || "?"}${unit}`;
};

/**
 * Job requisition: branch head / super admin approval. /pending-approvals is already scoped to the
 * caller's branches, excludes their own requisitions and only returns pending_approval rows,
 * and the endpoint is role-gated (super_admin, branch_head) — so every row returned is actionable.
 */
export const jobRequisitionAdapter: ApprovalAdapter = {
  kind: "job_requisition",
  label: "Job requisition",
  category: "Recruitment",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/job-requisition/pending-approvals");
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      const aging = Number(r.aging_days);
      const urgent = r.priority === "urgent" || r.priority === "high";
      out.push({
        uid: `job_requisition:${r.id}`,
        kind: "job_requisition",
        kindLabel: "Job requisition",
        category: "Recruitment",
        id: String(r.id),
        title: `${str(r.designation_name) || "Role"} × ${str(r.requested_headcount) || "?"} — ${str(r.branch_name)}`,
        subtitle: `${str(r.requisition_code)} · ${str(r.requisition_type).replace(/_/g, " ")} · raised by ${str(r.requested_by_name) || "—"}`,
        requester: { name: r.requested_by_name, branch: r.branch_name },
        stage: "Branch head approval",
        fields: fields(
          f("Requisition code", r.requisition_code),
          badge("Priority", r.priority),
          badge("Type", str(r.requisition_type).replace(/_/g, " ")),
          f("Designation", r.designation_name),
          f("Department", r.department_name),
          f("Branch", r.branch_name),
          f("Process", r.process_name),
          f("Headcount requested", r.requested_headcount),
          f("Employment type", str(r.employment_type).replace(/_/g, " ")),
          f("Salary range", range(r.salary_min, r.salary_max) ? `${money("", r.salary_min).value || "?"} – ${money("", r.salary_max).value || "?"}` : ""),
          f("Experience (years)", range(r.experience_min_years, r.experience_max_years)),
          f("Education", r.education_requirement),
          f("Shift", r.shift_requirement),
          f("Rotational shift", yn(r.rotational_shift)),
          f("Night shift", yn(r.night_shift_required)),
          date("Target joining", r.target_joining_date),
          date("Valid until", r.requisition_validity),
          f("Owner recruiter", r.owner_recruiter_name),
          f("Internal posting", yn(r.internal_posting)),
          f("Ad required", yn(r.ad_required)),
          f("Requested by", r.requested_by_name),
          date("Raised on", r.created_at),
          f("Pending for (days)", Number.isFinite(aging) ? aging : ""),
          long("Skills required", r.skills_required),
          long("Job description", r.job_description),
          long("Business justification", r.business_justification),
        ),
        submittedAt: iso(r.created_at),
        priority: urgent || (Number.isFinite(aging) && aging >= 3) ? "high" : "normal",
        viewPath: `/recruitment/job-requisition?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        rejectMinLength: 5,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") {
      await ctx.call("POST", `/api/job-requisition/${id}/approve`, { body: { remarks: remarks || undefined } });
    } else {
      await ctx.call("POST", `/api/job-requisition/${id}/reject`, { body: { reason: remarks } });
    }
  },
};
