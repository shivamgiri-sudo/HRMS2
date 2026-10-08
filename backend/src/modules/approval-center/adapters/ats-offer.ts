import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { callerHasRole } from "./_roles.js";
import { keepInBranch } from "./_scope.js";

const yes = (v: unknown) => (v === true || v === 1 || v === "1" ? "Yes" : "");

/**
 * ATS employment offer awaiting branch-head approval (canonical /ats/offer-approvals queue).
 * GET /api/ats/onboarding/pending-approval is already scoped to the caller (branch_head scope, admin bypass).
 * Approval creates the employee, which requires Payroll HR validation — rows without it can only be
 * rejected on the page, so they are left out of the popup (the page flags them).
 */
export const atsOfferAdapter: ApprovalAdapter = {
  kind: "ats_offer",
  label: "Offer approval",
  category: "Recruitment",
  async list(ctx) {
    // The queue is also served to admin / hr / payroll_hr, who are not the branch head who owns this stage. The popup shows the
    // approval only to a branch_head (or super_admin), and only for offers of the branch on their OWN record.
    if (!(await callerHasRole(ctx.userId, "branch_head", "super_admin"))) return [];
    const res = await ctx.call("GET", "/api/ats/onboarding/pending-approval");
    const rows: any[] = await keepInBranch(ctx.userId, (Array.isArray(res) ? res : res?.data ?? []).slice(0, 200), (r: any) => ({ branchId: r.branch_id }));
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (!(r.payroll_validated === 1 || r.payroll_validated === true)) continue;
      const process = str(r.process_name) || (r.process_is_designation ? "" : str(r.process_raw));
      out.push({
        uid: `ats_offer:${r.offer_id}`,
        kind: "ats_offer",
        kindLabel: "Offer approval",
        category: "Recruitment",
        id: String(r.offer_id),
        title: `${str(r.full_name) || "Candidate"} — offer approval`,
        subtitle: `${str(r.candidate_code)} · ${str(r.branch_name)} · Gross ${money("", r.gross).value || "—"}`,
        requester: { name: r.full_name, code: r.candidate_code, branch: r.branch_name },
        stage: "Branch head offer approval (Payroll HR validated)",
        fields: fields(
          f("Candidate", r.full_name),
          f("Candidate code", r.candidate_code),
          f("Mobile", r.mobile),
          f("Email", r.email),
          f("Father's name", r.father_name),
          date("Date of birth", r.date_of_birth),
          f("Branch", r.branch_name),
          f("Process", process),
          f("Cost centre", [str(r.cost_centre_code), str(r.cost_centre_name)].filter(Boolean).join(" — ")),
          f("Client", r.client_name),
          badge("Employment type", r.emp_type),
          f("Salary band", r.salary_band),
          money("Offered CTC", r.offered_ctc),
          money("Gross", r.gross),
          money("Net in hand", r.net_in_hand),
          date("Joining date (Payroll HR)", r.payroll_joining_date),
          date("Salary start (Payroll HR)", r.payroll_salary_start_date),
          date("Date of joining (offer form)", r.date_of_joining),
          f("Payroll HR validation", "Validated", "badge"),
          f("Outside salary band (exception)", yes(r.is_proposed_exception), "badge"),
          long("Exception reason", r.proposed_exception_reason),
          f("Profile status", r.profile_status),
        ),
        priority: yes(r.is_proposed_exception) ? "high" : "normal",
        submittedAt: iso(r.submitted_at),
        viewPath: `/ats/offer-approvals?candidate=${encodeURIComponent(String(r.candidate_id))}&approvalId=${encodeURIComponent(String(r.offer_id))}`,
        rejectNeedsReason: true,
        meta: { candidateId: String(r.candidate_id) },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    await ctx.call("POST", `/api/ats/onboarding/offers/${id}/${action === "approve" ? "approve" : "reject"}`, {
      body: { remarks: remarks || "" },
    });
  },
};
