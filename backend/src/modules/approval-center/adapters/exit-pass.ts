import type { ApprovalAdapter, ApprovalItem, LoopbackCtx } from "../types.js";
import { badge, date, dateText, f, fields, iso, long, str } from "../format.js";
import { getActorRoles, resolveRequestingEmployee } from "../../assets/exit-pass.service.js";
import { branchAllowed, callerScope, type CallerScope } from "./scope-guard.js";

const MAX_DETAIL_CALLS = 15;

type Stage = "branch_head" | "admin";

/**
 * The module's UNRESTRICTED_ROLES (super_admin, admin, it_head) override the assigned-head / branch check at both stages, which only
 * means they are ABLE to decide. The popup shows a pass to its designated person: the assigned Branch Head at stage 1 (a branch admin
 * only when none is assigned), and at stage 2 it_head (org-wide), the branch's admin or its branch_admin. super_admin is not
 * shown either stage unless it holds one of those roles.
 */
async function who(ctx: LoopbackCtx): Promise<{ employeeId: string | null; roles: string[]; scope: CallerScope }> {
  const [roles, me, scope] = await Promise.all([
    getActorRoles(ctx.userId).catch(() => [] as string[]),
    resolveRequestingEmployee(ctx.userId).catch(() => null),
    callerScope(ctx),
  ]);
  return { employeeId: me?.employeeId ?? null, roles, scope };
}

const GLOBAL_OVERRIDE_ROLES = ["it_head"];
const globalOverride = (w: { roles: string[] }) => w.roles.some((r) => GLOBAL_OVERRIDE_ROLES.includes(r));
const adminOfBranch = (w: { roles: string[]; scope: CallerScope }, branchId: unknown) => w.roles.includes("admin") && branchAllowed(w.scope, branchId);

async function itemsFor(ctx: LoopbackCtx, rows: any[]): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  await Promise.all(
    rows.slice(0, MAX_DETAIL_CALLS).map(async (r) => {
      try {
        const res = await ctx.call("GET", `/api/exit-passes/${encodeURIComponent(String(r.id))}`);
        const items = res?.data?.items;
        if (Array.isArray(items)) map.set(String(r.id), items);
      } catch {
        /* items are a nicety; the decision does not depend on them */
      }
    }),
  );
  return map;
}

function toItem(r: any, stage: Stage, items: any[] | undefined): ApprovalItem {
  const submitted = iso(r.submitted_at ?? r.branch_head_decided_at ?? r.created_at);
  const urgent = r.priority === "urgent" || r.priority === "emergency";
  const itemLines = (items ?? []).map((i) => {
    const bits = [`${str(i.quantity) || "1"} ${str(i.unit) || "Nos"}`, str(i.category), str(i.make_model), i.serial_number ? `S/N ${str(i.serial_number)}` : "", i.condition_out ? `(${str(i.condition_out)})` : ""].filter(Boolean);
    return `${str(i.item_name)} — ${bits.join(" · ")}`;
  });
  const stageLabel = stage === "branch_head" ? "Branch Head approval" : "Admin / IT approval";
  const destination = [str(r.destination_name), str(r.destination_type)].filter(Boolean).join(" · ");
  return {
    uid: `exit_pass:${r.id}`,
    kind: "exit_pass",
    kindLabel: "Exit / gate pass",
    category: "Admin",
    id: String(r.id),
    title: `${str(r.requestor_name) || "Employee"} — ${str(r.movement_type) === "returnable" ? "returnable" : "non-returnable"} material exit`,
    subtitle: [str(r.branch_name), destination, r.planned_exit_at ? `exit ${dateText(r.planned_exit_at)}` : ""].filter(Boolean).join(" · ") || undefined,
    requester: { name: r.requestor_name, branch: r.branch_name },
    stage: stageLabel,
    fields: fields(
      f("Requested by", r.requestor_name),
      f("Branch", r.branch_name),
      badge("Department", r.request_department),
      badge("Movement", r.movement_type),
      badge("Priority", r.priority),
      f("Purpose", r.purpose_code),
      long("Purpose details", r.purpose_details),
      f("Destination type", r.destination_type),
      f("Destination", r.destination_name),
      long("Destination address", r.destination_address),
      f("Carrier type", r.carrier_type),
      f("Carrier", r.carrier_name),
      f("Carrier mobile", r.carrier_mobile),
      f("Carrier company", r.carrier_company),
      f("Vehicle number", r.vehicle_number),
      date("Planned exit", r.planned_exit_at),
      date("Expected return", r.expected_return_at),
      date("Submitted", r.submitted_at),
      stage === "admin" ? date("Branch Head decided", r.branch_head_decided_at) : null,
      itemLines.length ? long("Items", itemLines.join("\n")) : null,
    ),
    submittedAt: submitted,
    priority: urgent ? "high" : "normal",
    viewPath: `/it-admin/exit-pass?tab=${stage === "branch_head" ? "pending_bh" : "pending_admin"}&approvalId=${encodeURIComponent(String(r.id))}`,
    rejectNeedsReason: true, // both stage endpoints require remarks on reject
    meta: { stage },
  };
}

/**
 * Exit (gate) pass. Branch-head stage: only passes where the caller is the assigned Branch Head, or an
 * unrestricted role (super_admin/admin/it_head) — the list endpoint also returns branch-scope matches that
 * decide would 403, so those are filtered out here. Admin stage: the endpoint already restricts to
 * admin/it_head/super_admin or the branch_admin of that branch. Own requests are always excluded.
 */
export const exitPassAdapter: ApprovalAdapter = {
  kind: "exit_pass",
  label: "Exit / gate pass",
  category: "Admin",
  async list(ctx) {
    const [bh, admin, me] = await Promise.all([
      ctx.call("GET", "/api/exit-passes/pending/branch-head").catch(() => null),
      ctx.call("GET", "/api/exit-passes/pending/admin").catch(() => null),
      who(ctx),
    ]);
    if (!me.employeeId) return [];
    const bhRows: any[] = (bh?.data ?? [])
      .filter((r: any) => r.status === "pending_branch_head" && r.requestor_employee_id !== me.employeeId)
      // Branch-head stage: the ASSIGNED head only. A literal admin of the pass's branch is shown it solely when no head is assigned.
      .filter((r: any) => r.branch_head_employee_id === me.employeeId || (!r.branch_head_employee_id && adminOfBranch(me, r.branch_id)))
      .slice(0, 200);
    const adminRows: any[] = (admin?.data ?? [])
      .filter((r: any) => r.status === "pending_admin_approval" && r.requestor_employee_id !== me.employeeId)
      // Admin / IT stage is role-designated: it_head (org-wide), admin of the branch, branch_admin of the branch. super_admin alone is
      // a bypass, not a designation, so it is not shown the stage unless it also holds one of those roles.
      .filter((r: any) => globalOverride(me) || adminOfBranch(me, r.branch_id) || (me.roles.includes("branch_admin") && branchAllowed(me.scope, r.branch_id)))
      .slice(0, 200);
    const items = await itemsFor(ctx, [...bhRows, ...adminRows]);
    return [
      ...bhRows.map((r) => toItem(r, "branch_head", items.get(String(r.id)))),
      ...adminRows.map((r) => toItem(r, "admin", items.get(String(r.id)))),
    ];
  },
  async decide(ctx, item, action, remarks) {
    const stage: Stage = item.meta?.stage === "admin" ? "admin" : "branch_head";
    const path = stage === "admin" ? "admin" : "branch-head";
    await ctx.call("POST", `/api/exit-passes/${encodeURIComponent(item.id)}/${path}/decision`, {
      body: { decision: action === "approve" ? "approved" : "rejected", remarks: remarks || undefined },
    });
  },
};
