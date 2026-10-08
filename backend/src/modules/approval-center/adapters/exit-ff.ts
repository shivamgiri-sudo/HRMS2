import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { LoopbackError } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { callerHasRole } from "./_roles.js";
import { keepInBranch } from "./_scope.js";

/** POST /api/exit/ff/:id/approve is requireRole(admin, finance, payroll); /verify also admits hr. */
const APPROVER_ROLES = ["admin", "finance", "payroll"];
const VERIFIER_ROLES = ["admin", "hr", "finance", "payroll"];
const MAX_DETAIL_CALLS = 25;

/**
 * Full & Final settlement. There is no F&F list endpoint, so candidates come from the exit command center (which
 * carries ff_status / is_ff_provisional / clearance counts per exit request, branch-scoped for the caller) and each
 * candidate's settlement is then read once from GET /api/exit/ff/:exitRequestId (capped).
 *
 * Only settlements the caller can act on are listed:
 *   - clearance fully cleared + not provisional + status draft/verified -> Approve (admin / finance / payroll). Open clearance
 *     tasks or a provisional flag make the approve endpoint return 409, so those are left out of the popup.
 *   - provisional but clearance done -> "Verify" stage. Verifying needs an audit reason, so these are view-only here
 *     (meta.viewOnly=true): the person must write the reason on the F&F page.
 * The module has no "decline" for F&F, so reject is refused; the popup should hide Decline for this kind (meta.noReject).
 */
export const exitFfAdapter: ApprovalAdapter = {
  kind: "exit_ff",
  label: "F&F settlement",
  category: "Payroll",
  async list(ctx) {
    const canApprove = await callerHasRole(ctx.userId, ...APPROVER_ROLES);
    const canVerify = canApprove || (await callerHasRole(ctx.userId, ...VERIFIER_ROLES));
    if (!canVerify) return [];

    const cc = await ctx.call("GET", "/api/exit/command-center");
    const requests: any[] = cc?.data?.requests ?? [];
    // `admin` approves F&F but is branch-scoped (owner ruling 2026-10-01); finance / payroll_head / super_admin are org-wide.
    const inScope = await keepInBranch(ctx.userId, requests, (r: any) => ({ employeeId: r.employee_id, employeeCode: r.employee_code }));
    const candidates = inScope
      .filter((r) => ["draft", "verified"].includes(str(r.ff_status)))
      .filter((r) => Number(r.clearance_cleared ?? 0) >= Number(r.clearance_total ?? 0))
      .filter((r) => (Number(r.is_ff_provisional ?? 0) === 1 ? canVerify : canApprove))
      .sort((a, b) => Number(a.is_ff_provisional ?? 0) - Number(b.is_ff_provisional ?? 0))
      .slice(0, MAX_DETAIL_CALLS);

    const out: ApprovalItem[] = [];
    for (const r of candidates) {
      let ff: any;
      try {
        const res = await ctx.call("GET", `/api/exit/ff/${encodeURIComponent(String(r.id))}`);
        ff = res?.data;
      } catch (e) {
        if (e instanceof LoopbackError && [403, 404].includes(e.status)) continue;
        throw e;
      }
      if (!ff?.id || !["draft", "verified"].includes(str(ff.status))) continue;
      const provisional = Number(ff.is_ff_provisional ?? 0) === 1;
      if (!provisional && !canApprove) continue;
      const alreadyPaid: any[] = Array.isArray(ff.payroll_already_paid) ? ff.payroll_already_paid : [];
      out.push({
        uid: `exit_ff:${ff.id}`,
        kind: "exit_ff",
        kindLabel: "F&F settlement",
        category: "Payroll",
        id: String(ff.id),
        title: `${str(ff.employee_name) || str(r.employee_name) || "Employee"} — F&F settlement`,
        subtitle: `Net payable ${money("", ff.net_payable).value}${provisional ? " · provisional" : ""}`,
        requester: { name: ff.employee_name ?? r.employee_name, code: r.employee_code, branch: r.branch_name },
        stage: provisional ? "Verify (clear provisional flag)" : "Final approval",
        fields: fields(
          f("Employee", ff.employee_name ?? r.employee_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          f("Process", r.process_name),
          badge("Exit type", [str(r.exit_type), str(r.exit_sub_type)].filter(Boolean).join(" / ")),
          date("Last working day", r.last_working_day_confirmed ?? r.last_working_day_proposed),
          date("Calculation date", ff.calculation_date),
          f("Notice period (days)", ff.notice_period_days),
          f("Notice shortfall (days)", ff.notice_shortfall_days),
          money("Notice recovery", ff.notice_recovery),
          money("Earned leave encashment", ff.earned_leave_encashment),
          money("Gratuity", ff.gratuity_amount),
          money("Salary hold", ff.salary_hold),
          money("Advances recovery", ff.advances_recovery),
          money("Net payable", ff.net_payable),
          badge("F&F status", ff.status),
          badge("Provisional", provisional ? "Yes - statutory values not verified" : "No"),
          f("Clearance tasks", `${Number(r.clearance_cleared ?? 0)} of ${Number(r.clearance_total ?? 0)} cleared`),
          alreadyPaid.length ? long("Payroll already paid around this period", `${alreadyPaid.length} run line(s) - check salary hold is not double counted`) : null,
        ),
        submittedAt: iso(ff.created_at),
        viewPath: `/payroll/full-final?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
        approveLabel: provisional ? "Verify on page" : "Approve settlement",
        meta: { exitRequestId: String(r.id), provisional, viewOnly: provisional, noReject: true },
      });
    }
    return out;
  },
  async decide(ctx, item, action) {
    if (action === "reject") throw new LoopbackError(400, "F&F settlements cannot be declined here; open the F&F page to hold or recalculate it");
    if (item.meta?.provisional === true) {
      throw new LoopbackError(400, "This settlement is still provisional. Verifying it needs an audit reason; open the F&F page");
    }
    await ctx.call("POST", `/api/exit/ff/${encodeURIComponent(item.id)}/approve`, { body: {} });
  },
};
