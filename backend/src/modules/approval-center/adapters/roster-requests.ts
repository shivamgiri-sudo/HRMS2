import type { ApprovalAction, ApprovalAdapter, ApprovalItem, LoopbackCtx } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { hasRole } from "../../../shared/accessGuard.js";
import { rolesForKindAction } from "../../roster-requests/roster-requests.routes.js";
import { keepApproverOrBranchRole } from "./_scope.js";

/**
 * The designated approver of every hub kind is the employee's effective approver (reporting manager / skip-level). These branch roles
 * are shown a request ONLY when the employee has no resolvable approver, and only inside their OWN branch; holding a role that is
 * merely able to decide (admin / hr / wfm / branch_head / super_admin) is not a designation.
 */
const FALLBACK_ROLES: Record<HubKind, string[]> = {
  swap: ["admin", "hr", "wfm"],
  weekoff_rejection: ["admin", "hr", "wfm", "branch_head"],
  dispute: ["admin", "hr", "wfm", "branch_head", "process_manager"],
  conflict: ["admin", "hr", "wfm"],
};

/**
 * Roster Requests Hub: four sub-kinds, each listed from its own existing endpoint (exactly what the hub page loads)
 * and decided through the hub's own POST /api/roster-requests/:kind/:id/decide (role + scope + impact gate live there).
 * The legacy list endpoints are scope-visible and some fall back to "my own requests" for non-approver roles, so
 * rows are only returned to a caller holding a role the decide route accepts for that kind.
 */
type HubKind = "swap" | "weekoff_rejection" | "dispute" | "conflict";

const DAY = 24 * 3600 * 1000;
const FALLBACK_REASON = "Approved via Approval Center";

const mkId = (kind: HubKind, id: unknown) => String(id ?? "") || `${kind}`;
const viewPath = (kind: HubKind, id: string) =>
  `/wfm/roster-requests?kind=${kind}&id=${encodeURIComponent(id)}&approvalId=${encodeURIComponent(id)}`;

/** Roster date + age -> priority (matches the hub's own "urgent" within 24h of the shift, "overdue" > 48h). */
function priorityOf(rosterDate: unknown, raisedAt: unknown): "high" | "normal" {
  const now = Date.now();
  const d = str(rosterDate).slice(0, 10);
  const shift = d ? new Date(`${d}T00:00:00+05:30`).getTime() : NaN;
  if (!Number.isNaN(shift) && shift - now <= DAY) return "high";
  const r = iso(raisedAt);
  if (r && now - new Date(r).getTime() > 2 * DAY) return "high";
  return "normal";
}

const timeRange = (a: unknown, b: unknown) => (str(a) || str(b) ? `${str(a).slice(0, 5)} - ${str(b).slice(0, 5)}` : "");

async function allowed(ctx: LoopbackCtx, kind: HubKind): Promise<boolean> {
  return hasRole(ctx.userId, ...rolesForKindAction(kind, "approve"));
}

async function decideVia(ctx: LoopbackCtx, kind: HubKind, id: string, action: ApprovalAction, remarks: string, approveFallback: boolean) {
  const reason = remarks || (action === "approve" && approveFallback ? FALLBACK_REASON : "");
  await ctx.call("POST", `/api/roster-requests/${kind}/${encodeURIComponent(id)}/decide`, {
    body: { action, ...(reason ? { reason } : {}) },
  });
}

export const rosterSwapAdapter: ApprovalAdapter = {
  kind: "roster_swap",
  label: "Shift swap",
  category: "Attendance",
  async list(ctx) {
    if (!(await allowed(ctx, "swap"))) return [];
    const res = await ctx.call("GET", "/api/wfm-ext/roster/swaps", { query: { status: "pending" } });
    const out: ApprovalItem[] = [];
    const swaps = await keepApproverOrBranchRole(ctx.userId, (res?.data ?? []) as any[], (s: any) => ({ employeeId: s.requester_employee_id }), FALLBACK_ROLES.swap);
    for (const s of swaps) {
      if (str(s.status) && str(s.status) !== "pending") continue;
      // The swap service refuses an approve until the counterpart accepted; only offer rows the manager can actually move.
      const cp = str(s.counterpart_status);
      if (cp && cp !== "accepted") continue;
      const id = String(s.id);
      out.push({
        uid: `roster_swap:${id}`,
        kind: "roster_swap",
        kindLabel: "Shift swap",
        category: "Attendance",
        id,
        title: `${str(s.requester_name) || "Employee"} swaps with ${str(s.target_name) || "colleague"}`,
        subtitle: `Swap date ${str(s.swap_date).slice(0, 10)}`,
        requester: { name: s.requester_name },
        stage: "Manager approval (counterpart accepted)",
        fields: fields(
          f("Requested by", s.requester_name),
          f("Swap with", s.target_name),
          date("Swap date", s.swap_date),
          badge("Counterpart", cp || ""),
          f("LOB", s.requester_lob_name),
          long("Reason", s.reason),
          date("Raised on", s.created_at),
        ),
        submittedAt: iso(s.created_at),
        priority: priorityOf(s.swap_date, s.created_at),
        viewPath: viewPath("swap", id),
        rejectNeedsReason: false,
      });
    }
    return out;
  },
  decide: (ctx, item, action, remarks) => decideVia(ctx, "swap", item.id, action, remarks, false),
};

export const rosterWeekoffAdapter: ApprovalAdapter = {
  kind: "roster_weekoff",
  label: "Week-off rejection",
  category: "Attendance",
  async list(ctx) {
    if (!(await allowed(ctx, "weekoff_rejection"))) return [];
    const res = await ctx.call("GET", "/api/wfm/manager/weekoff-review");
    const out: ApprovalItem[] = [];
    const weekoffs = await keepApproverOrBranchRole(ctx.userId, (res?.data ?? []) as any[], (w: any) => ({ employeeId: w.employee_id, employeeCode: w.employee_code }), FALLBACK_ROLES.weekoff_rejection);
    for (const w of weekoffs) {
      const id = mkId("weekoff_rejection", w.id);
      const raised = w.employee_ack_at ?? w.updated_at ?? w.created_at;
      out.push({
        uid: `roster_weekoff:${id}`,
        kind: "roster_weekoff",
        kindLabel: "Week-off rejection",
        category: "Attendance",
        id,
        title: `${str(w.employee_name) || "Employee"} rejected the assigned week-off`,
        subtitle: `Roster date ${str(w.roster_date).slice(0, 10)}`,
        requester: { name: w.employee_name, code: w.employee_code, branch: w.branch_name },
        stage: "Manager review",
        fields: fields(
          f("Employee", w.employee_name),
          f("Employee code", w.employee_code),
          f("Designation", w.designation),
          f("Branch", w.branch_name),
          f("Process", w.process_name),
          date("Roster date", w.roster_date),
          f("Shift", `${str(w.shift_name)} ${timeRange(w.start_time, w.end_time)}`.trim()),
          f("Roster week", w.week_start_date ? `${str(w.week_start_date).slice(0, 10)} to ${str(w.week_end_date).slice(0, 10)}` : ""),
          long("Employee's reason", w.employee_rejection_reason),
          date("Raised on", raised),
        ),
        submittedAt: iso(raised),
        priority: priorityOf(w.roster_date, raised),
        viewPath: viewPath("weekoff_rejection", id),
        rejectNeedsReason: true,
        approveLabel: "Force-approve week-off",
        rejectLabel: "Reject employee's request",
      });
    }
    return out;
  },
  // The hub requires a reason for every week-off decision.
  decide: (ctx, item, action, remarks) => decideVia(ctx, "weekoff_rejection", item.id, action, remarks, true),
};

export const rosterDisputeAdapter: ApprovalAdapter = {
  kind: "roster_dispute",
  label: "Roster dispute",
  category: "Attendance",
  async list(ctx) {
    if (!(await allowed(ctx, "dispute"))) return [];
    const res = await ctx.call("GET", "/api/roster-gov/manager-review-queue");
    const out: ApprovalItem[] = [];
    const disputes = await keepApproverOrBranchRole(ctx.userId, (res?.data ?? []) as any[], (r: any) => ({ employeeId: r.employee_id, employeeCode: r.employee_code }), FALLBACK_ROLES.dispute);
    for (const r of disputes) {
      if (r.dispute_resolved_at) continue;
      const id = String(r.id);
      const name = `${str(r.first_name)} ${str(r.last_name)}`.trim() || "Employee";
      const raised = r.disputed_at ?? r.updated_at;
      out.push({
        uid: `roster_dispute:${id}`,
        kind: "roster_dispute",
        kindLabel: "Roster dispute",
        category: "Attendance",
        id,
        title: `${name} disputed the published roster`,
        subtitle: `Roster date ${str(r.roster_date).slice(0, 10)}`,
        requester: { name, code: r.employee_code },
        stage: "Manager resolution",
        fields: fields(
          f("Employee", name),
          f("Employee code", r.employee_code),
          date("Roster date", r.roster_date),
          f("Assigned", r.is_week_off ? "Week off" : `${str(r.shift_name)} ${timeRange(r.start_time, r.end_time)}`.trim()),
          f("Roster week", r.week_start_date ? `${str(r.week_start_date).slice(0, 10)} to ${str(r.week_end_date).slice(0, 10)}` : ""),
          long("Dispute reason", r.dispute_reason),
          date("Raised on", raised),
        ),
        submittedAt: iso(raised),
        priority: priorityOf(r.roster_date, raised),
        viewPath: viewPath("dispute", id),
        rejectNeedsReason: true,
        approveLabel: "Resolve (accept dispute)",
        rejectLabel: "Resolve (keep original shift)",
      });
    }
    return out;
  },
  // The hub requires a resolution text for disputes in both directions.
  decide: (ctx, item, action, remarks) => decideVia(ctx, "dispute", item.id, action, remarks, true),
};

export const rosterConflictAdapter: ApprovalAdapter = {
  kind: "roster_conflict",
  label: "Roster conflict",
  category: "Attendance",
  async list(ctx) {
    if (!(await allowed(ctx, "conflict"))) return [];
    const res = await ctx.call("GET", "/api/wfm-ext/roster/conflicts", { query: { resolved: "false" } });
    const out: ApprovalItem[] = [];
    const conflicts = await keepApproverOrBranchRole(ctx.userId, (res?.data ?? []) as any[], (c: any) => ({ employeeId: Array.isArray(c.employees_involved) ? c.employees_involved[0] : undefined }), FALLBACK_ROLES.conflict);
    for (const c of conflicts) {
      if (str(c.status) === "resolved") continue;
      const id = String(c.id);
      const names = Array.isArray(c.employee_names) ? c.employee_names.map(str).filter(Boolean).join(", ") : "";
      out.push({
        uid: `roster_conflict:${id}`,
        kind: "roster_conflict",
        kindLabel: "Roster conflict",
        category: "Attendance",
        id,
        title: `${str(c.conflict_type).replace(/_/g, " ") || "Roster conflict"} — ${names || "employee"}`,
        subtitle: `Conflict date ${str(c.conflict_date).slice(0, 10)}`,
        requester: { name: names },
        stage: "Manager resolution",
        fields: fields(
          f("Employee(s)", names),
          badge("Conflict type", str(c.conflict_type).replace(/_/g, " ")),
          badge("Severity", c.severity),
          date("Conflict date", c.conflict_date),
          long("Details", c.description),
          date("Detected on", c.created_at),
        ),
        submittedAt: iso(c.created_at),
        priority: c.severity === "high" ? "high" : priorityOf(c.conflict_date, c.created_at),
        viewPath: viewPath("conflict", id),
        // A conflict can only be resolved (there is no reject). The resolution text is mandatory at the hub.
        rejectNeedsReason: true,
        approveLabel: "Mark resolved",
        meta: { rejectUnsupported: true },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    if (action === "reject") throw new Error("A roster conflict can only be resolved, not rejected. Open it in the Roster Requests page.");
    await decideVia(ctx, "conflict", item.id, action, remarks, true);
  },
};
