import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { branchAllowed, callerScope, io } from "./scope-guard.js";

/** Workflow codes owned by a dedicated adapter elsewhere in the Approval Center (avoid duplicate cards). */
export const WORKFLOW_EXCLUDED_CODES = new Set(["JOB_REQUISITION_APPROVAL"]);
export const WORKFLOW_EXCLUDED_ENTITY_TYPES = new Set(["job_requisition"]);

const AGING_HOURS_FALLBACK = 48;

/** Steps owned by the requester's line manager rather than by a role holder anywhere in the branch. */
export const MANAGER_STAGE_ROLES = new Set(["manager", "team_leader", "tl", "process_manager", "reporting_manager"]);

/**
 * Generic multi-step workflow engine (approval_request). The module's own pending endpoint already
 * filters by the caller's approver role, current step and requester scope; we drop the caller's own
 * requests and workflows another adapter owns, and then apply the responsible-person rules the endpoint does not:
 *  - a MANAGER-type step (manager / team_leader / process_manager ...) is shown only to the requester's effective approver
 *    (reporting manager, or the skip-level while the manager is on approved leave), not to every holder of that role and not to
 *    super_admin; with no resolvable approver, only a literal holder of the step role in the requester's branch;
 *  - every other step is shown only to a caller who literally holds the step's role AND the requester's branch is the caller's OWN
 *    branch (org-wide roles: all). A requester with no employee record has no branch, so only org-wide callers see theirs.
 */
export const workflowAdapter: ApprovalAdapter = {
  kind: "workflow",
  label: "Workflow approval",
  category: "Admin",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/workflow/requests/pending");
    const rows: any[] = (Array.isArray(res) ? res : res?.data ?? []).slice(0, 200);
    const me = await callerScope(ctx);
    const requesters = await io.userEmployees(rows.map((r) => r.requested_by));
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.status) && str(r.status) !== "pending") continue;
      if (WORKFLOW_EXCLUDED_CODES.has(str(r.workflow_code))) continue;
      if (WORKFLOW_EXCLUDED_ENTITY_TYPES.has(str(r.entity_type))) continue;
      if (str(r.requested_by) && str(r.requested_by) === ctx.userId) continue; // never approve own request
      const requester = requesters.get(str(r.requested_by));
      const stageRole = str(r.approver_role).toLowerCase();
      if (MANAGER_STAGE_ROLES.has(stageRole)) {
        // Manager-type step: ONLY the requester's effective approver. super_admin / admin / hr are not a blanket pass. When no
        // approver can be resolved the module falls back to the step's role, so a literal holder of it inside the requester's branch.
        if (!requester || !me.employeeId) continue;
        const approver = await io.effectiveApproverEmployeeId(requester.employeeId);
        if (approver ? approver !== me.employeeId : !(me.roles.includes(stageRole) && branchAllowed(me, requester.branchId))) continue;
      } else {
        // Role-owned step: the caller must literally hold the step's role (no super_admin wildcard), for a requester in their branch.
        if (!(stageRole && me.roles.includes(stageRole)) || !branchAllowed(me, requester?.branchId)) continue;
      }
      const summary = str(r.summary) || str(r.summary_text);
      const created = iso(r.created_at);
      const sla = Number(r.sla_hours) > 0 ? Number(r.sla_hours) : AGING_HOURS_FALLBACK;
      const overdue = created ? Date.now() - new Date(created).getTime() > sla * 3_600_000 : false;
      out.push({
        uid: `workflow:${r.id}`,
        kind: "workflow",
        kindLabel: str(r.workflow_name) || "Workflow approval",
        category: "Admin",
        id: String(r.id),
        title: summary || `${str(r.workflow_name) || "Approval request"}`,
        subtitle: [str(r.workflow_name), str(r.step_name)].filter(Boolean).join(" · ") || undefined,
        requester: { name: r.requested_by_name },
        stage: [str(r.step_name) && `Step ${str(r.current_step)}: ${str(r.step_name)}`, str(r.approver_role) && `(${str(r.approver_role)})`]
          .filter(Boolean)
          .join(" ") || undefined,
        fields: fields(
          f("Workflow", r.workflow_name),
          badge("Workflow code", r.workflow_code),
          f("Requested by", r.requested_by_name),
          long("Summary", summary),
          f("Entity type", r.entity_type),
          f("Entity id", r.entity_id),
          f("Module", r.module_key),
          f("Current step", r.step_name),
          badge("Approver role", r.approver_role),
          f("SLA (hours)", r.sla_hours),
          date("Submitted", r.created_at),
        ),
        submittedAt: created,
        priority: overdue ? "high" : "normal",
        viewPath: `/workflow-admin?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
        meta: { workflowCode: r.workflow_code ?? null, step: r.current_step ?? null },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/workflow/requests/${encodeURIComponent(item.id)}/act`, {
      body: { action: action === "approve" ? "approved" : "rejected", remarks: remarks || undefined },
    });
  },
};
