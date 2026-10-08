import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { hasScopedAccess } from "../../../shared/scopeAccess.js";
import { callerScope } from "./_scope.js";

const AGE_HIGH_MS = 2 * 24 * 3600 * 1000;

/**
 * Auto-roster plan awaiting Process Manager approval (wfm_roster_plan_control.approval_status = 'submitted').
 * The plan list is scope-visible to wfm/hr/ceo etc. too, but approve/reject are process_manager (scoped to the plan's
 * process/branch) only, so each plan is checked with the SAME hasScopedAccess call the approve route's guard makes.
 * Approving can still be refused by the module while critical coverage gaps are open; that message is surfaced.
 */
export const autoRosterAdapter: ApprovalAdapter = {
  kind: "auto_roster",
  label: "Auto-roster plan",
  category: "Attendance",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/wfm/auto-roster/plans");
    const plans: any[] = ((res?.data ?? []) as any[]).filter((p) => str(p.approval_status) === "submitted");
    if (plans.length === 0) return [];

    const ok: any[] = [];
    const scope = await callerScope(ctx.userId);
    for (const p of plans) {
      // Owner policy: a process_manager decides only plans of their OWN branch (an assignment row may narrow, never widen).
      if (!scope.allows(p.branch_id)) continue;
      if (await hasScopedAccess(ctx.userId, ["process_manager"], { processId: p.process_id, branchId: p.branch_id })) ok.push(p);
    }
    if (ok.length === 0) return [];

    const procName = new Map<string, string>();
    const branchName = new Map<string, string>();
    try {
      const m = (await ctx.call("GET", "/api/wfm/auto-roster/masters"))?.data ?? {};
      for (const x of m.processes ?? []) procName.set(String(x.id), str(x.process_name));
      for (const x of m.branches ?? []) branchName.set(String(x.id), str(x.branch_name));
    } catch { /* names are a nicety; ids are not shown, fields are simply omitted */ }

    return ok.map((p): ApprovalItem => {
      const id = String(p.id);
      const proc = procName.get(String(p.process_id)) ?? "";
      const branch = branchName.get(String(p.branch_id)) ?? "";
      const score = p.last_coverage_score;
      const submitted = iso(p.updated_at ?? p.created_at);
      return {
        uid: `auto_roster:${id}`,
        kind: "auto_roster",
        kindLabel: "Auto-roster plan",
        category: "Attendance",
        id,
        title: `${str(p.plan_name) || "Roster plan"}${proc ? ` — ${proc}` : ""}`,
        subtitle: `${str(p.from_date).slice(0, 10)} to ${str(p.to_date).slice(0, 10)}${branch ? ` · ${branch}` : ""}`,
        requester: { branch },
        stage: "Process Manager approval",
        fields: fields(
          f("Plan", p.plan_name),
          f("Process", proc),
          f("Branch", branch),
          date("From", p.from_date),
          date("To", p.to_date),
          f("Required headcount", Number(p.required_headcount) > 0 ? p.required_headcount : ""),
          f("Assigned headcount", Number(p.assigned_headcount) > 0 ? p.assigned_headcount : ""),
          f("Coverage score", score !== null && score !== undefined && score !== "" ? `${score}%` : ""),
          f("Shrinkage", p.shrinkage_pct !== null && p.shrinkage_pct !== undefined ? `${p.shrinkage_pct}%` : ""),
          badge("Status", "Submitted for approval"),
          long("Note", "Approval is refused while critical coverage gaps are open; open the plan to review gaps and conflicts."),
          date("Submitted on", submitted),
        ),
        submittedAt: submitted,
        priority: submitted && Date.now() - new Date(submitted).getTime() > AGE_HIGH_MS ? "high" : "normal",
        viewPath: `/wfm/roster-insights?tab=heatmap&approvalId=${encodeURIComponent(id)}`,
        rejectNeedsReason: true,
        rejectMinLength: 5,
      };
    });
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") {
      await ctx.call("POST", `/api/wfm/auto-roster/plans/${id}/approve`, { body: remarks ? { remarks } : {} });
    } else {
      await ctx.call("POST", `/api/wfm/auto-roster/plans/${id}/reject`, { body: { remarks } });
    }
  },
};
