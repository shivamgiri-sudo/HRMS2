import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, money, str } from "../format.js";

/**
 * Legacy branch-head approval queue (/ats/branch-head-approval, table ats_branch_head_approval).
 * GET /api/ats/branch-head-approval/pending is scoped to the caller's branch assignments and only returns
 * payroll-validated, pending rows. Candidates that also have a submitted offer are already listed by the
 * canonical ats_offer adapter, so they are skipped here to avoid two popup rows for one decision.
 */
export const atsBranchHeadAdapter: ApprovalAdapter = {
  kind: "ats_branch_head",
  label: "Branch head approval (legacy)",
  category: "Recruitment",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/ats/branch-head-approval/pending");
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    if (!rows.length) return [];
    const inOffers = new Set<string>();
    try {
      const o = await ctx.call("GET", "/api/ats/onboarding/pending-approval");
      for (const x of Array.isArray(o) ? o : o?.data ?? []) inOffers.add(String(x.candidate_id));
    } catch {
      /* no access to the canonical queue — nothing to dedupe against */
    }
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (inOffers.has(String(r.candidate_id))) continue;
      const branch = str(r.branch_display_name) || str(r.applied_for_branch);
      out.push({
        uid: `ats_branch_head:${r.id}`,
        kind: "ats_branch_head",
        kindLabel: "Branch head approval",
        category: "Recruitment",
        id: String(r.id),
        title: `${str(r.candidate_name) || "Candidate"} — final offer approval`,
        subtitle: `${str(r.candidate_code)} · ${str(r.applied_for_role)} · Gross ${money("", r.gross_salary).value || "—"}`,
        requester: { name: r.candidate_name, code: r.candidate_code, branch },
        stage: "Branch head approval (Payroll HR validated)",
        fields: fields(
          f("Candidate", r.candidate_name),
          f("Candidate code", r.candidate_code),
          f("Mobile", r.mobile),
          f("Email", r.email),
          f("Role applied", r.applied_for_role),
          f("Branch", branch),
          badge("Employment type", r.employment_type),
          money("Gross salary", r.gross_salary),
          money("Basic", r.basic_salary),
          money("HRA", r.hra),
          money("Conveyance", r.conveyance),
          money("Special allowance", r.special_allowance),
          date("Joining date", r.joining_date),
          date("Salary start date", r.salary_start_date),
          f("Submitted by (Payroll HR)", r.submitted_by),
          date("Validated on", r.submitted_at),
          f("Payroll HR validation", "Validated", "badge"),
        ),
        submittedAt: iso(r.submitted_at),
        viewPath: `/ats/branch-head-approval?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        meta: { candidateId: String(r.candidate_id) },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", "/api/ats/branch-head-approval/process", {
      body: { approval_id: item.id, approval_status: action === "approve" ? "approved" : "rejected", remarks: remarks || undefined },
    });
  },
};
