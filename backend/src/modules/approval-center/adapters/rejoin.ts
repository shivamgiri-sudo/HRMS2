import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { LoopbackError } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { callerHasRole } from "./_roles.js";
import { keepInBranch } from "./_scope.js";

/** The branch-action endpoint takes remarks of at least 5 characters on both outcomes. */
const MIN_REMARKS = 5;
const DEFAULT_APPROVE_REMARKS = "Approved via Approval Center";

function parseSnapshot(raw: unknown): { status?: string; reasons?: Array<{ severity?: string; code?: string; message?: string }> } {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw as any;
}

/**
 * Rejoin / reactivation of a former employee. branch_head gives the single, final decision (the HR step was removed),
 * so the item is shown only to a caller holding branch_head. /reactivation/pending is already branch-scoped.
 *
 * Absconders: the route demands absconding_acknowledged=true AND remarks >= 20 chars on approve. That is a deliberate
 * personal acknowledgement, so those items are flagged meta.viewOnly=true (no blind approve from the popup); the
 * branch head opens the review page. Declining an absconder is still allowed (needs remarks only).
 * Legacy rows without an eligibility snapshot fall back to the route's own live verdict (it answers 400 if an ack is needed).
 */
export const rejoinAdapter: ApprovalAdapter = {
  kind: "rejoin",
  label: "Rejoin request",
  category: "People",
  async list(ctx) {
    if (!(await callerHasRole(ctx.userId, "branch_head"))) return [];
    const res = await ctx.call("GET", "/api/employees/reactivation/pending");
    // Scope behind the list is assignment-based (can reach several branches). Owner policy: branch_head decides only their OWN branch.
    const rows: any[] = await keepInBranch(ctx.userId, (res?.data ?? []).slice(0, 200), (r: any) => ({ employeeId: r.employee_id, employeeCode: r.employee_code }));
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (!["pending", "branch_head_approved"].includes(str(r.status))) continue;
      const snap = parseSnapshot(r.eligibility_snapshot);
      const absconding = JSON.stringify(snap).includes('"ABSCONDING"');
      const notes = (snap.reasons ?? []).map((x) => `${str(x.severity)}: ${str(x.message)}`).join("\n");
      out.push({
        uid: `rejoin:${r.id}`,
        kind: "rejoin",
        kindLabel: "Rejoin request",
        category: "People",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — rejoin`,
        subtitle: `Proposed joining ${str(r.proposed_joining_date).slice(0, 10)}${absconding ? " · left by absconding" : ""}`,
        requester: { name: r.employee_name, code: r.employee_code },
        stage: "Branch head final decision",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Previous status", r.old_employment_status),
          date("Proposed joining date", r.proposed_joining_date),
          f("Gap since exit (days)", r.gap_days),
          long("Reinstatement reason", r.reinstatement_reason),
          f("Same cost centre", r.same_cost_centre === undefined || r.same_cost_centre === null ? "" : Number(r.same_cost_centre) === 1 ? "Yes" : "No"),
          f("F&F already paid", r.ff_already_paid === undefined || r.ff_already_paid === null ? "" : Number(r.ff_already_paid) === 1 ? "Yes" : "No"),
          badge("Eligibility", r.eligibility_status ?? snap.status),
          absconding ? badge("Absconding", "Yes - acknowledgement and 20+ character remarks required to approve") : null,
          long("Eligibility notes", notes),
          f("Raised by role", r.raised_by_role),
          date("Raised on", r.created_at),
          r.status === "branch_head_approved" ? badge("Legacy state", "Left at old HR step") : null,
        ),
        submittedAt: iso(r.created_at),
        priority: absconding ? "high" : "normal",
        viewPath: `/employees/reactivation/${encodeURIComponent(String(r.id))}/review`,
        rejectNeedsReason: true,
        rejectMinLength: 5,
        meta: { absconding, viewOnly: absconding },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const text = remarks.trim();
    if (action === "reject") {
      if (text.length < MIN_REMARKS) throw new LoopbackError(400, `Remarks of at least ${MIN_REMARKS} characters are required`);
      await ctx.call("POST", `/api/employees/reactivation/${encodeURIComponent(item.id)}/branch-action`, { body: { action: "rejected", remarks: text } });
      return;
    }
    if (item.meta?.absconding === true) {
      throw new LoopbackError(400, "This employee absconded: open the review page to acknowledge and give remarks of at least 20 characters");
    }
    await ctx.call("POST", `/api/employees/reactivation/${encodeURIComponent(item.id)}/branch-action`, {
      body: { action: "approved", remarks: text.length >= MIN_REMARKS ? text : DEFAULT_APPROVE_REMARKS },
    });
  },
};
