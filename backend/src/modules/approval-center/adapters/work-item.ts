import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { LoopbackError } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { buildActionDeeplink } from "../../work-inbox/action-item-registry.js";
import { keepWorkItemsForCaller } from "./_scope.js";

/**
 * Work-inbox item types shown as VIEW-ONLY cards. Only approval/decision flavoured types that no dedicated
 * adapter owns. Everything else in the registry is deliberately excluded (see WORK_ITEM_EXCLUDED_TYPES).
 */
export const WORK_ITEM_VIEW_ONLY_TYPES = new Set([
  "NOTICE_PERIOD_OVERRIDE_OPS",
  "NOTICE_PERIOD_OVERRIDE_OPS_HEAD",
  "NOTICE_PERIOD_OVERRIDE_PAYROLL",
  "JOINING_DOCS_INCOMPLETE",
]);

/**
 * Registry types intentionally NOT surfaced here: owned by a dedicated adapter, handled by `awol`, or not an approval.
 */
export const WORK_ITEM_EXCLUDED_TYPES = [
  "OFFER_APPROVAL_PENDING", "REGULARIZATION_PENDING", "LEAVE_APPROVAL_PENDING", "INCENTIVE_APPROVAL",
  "BULK_UPLOAD_APPROVAL", "PAYROLL_SIGN_OFF_PENDING", "RESIGNATION_PENDING_REVIEW",
  "RESIGNATION_MANAGER_DISCUSSION", "RESIGNATION_HR_DISCUSSION", "FF_CLEARANCE_PENDING", "DPDP_WITHDRAWAL_REVIEW",
  "AWOL_SUSPECTED", // decidable: awolAdapter
];

const PRIORITY_HIGH = new Set(["critical", "high"]);

export const workItemAdapter: ApprovalAdapter = {
  kind: "work_item",
  label: "Work inbox item",
  category: "Admin",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/work-inbox/my");
    const candidates: any[] = ((res?.data ?? []) as any[])
      .slice(0, 200)
      .filter((r) => r.source_table === "work_item") // derived / bell rows are not work items
      .filter((r) => WORK_ITEM_VIEW_ONLY_TYPES.has(str(r.item_type)))
      .filter((r) => !(r.status && ["completed", "cancelled"].includes(str(r.status))));
    // /my also returns every ROLE-QUEUE item to every holder of the role in every branch: keep only the caller's own items and
    // unassigned role-queue items of a branch the caller may act in.
    const rows = await keepWorkItemsForCaller(ctx.userId, candidates, (r: any) => r.id);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      const link = buildActionDeeplink(str(r.item_type), str(r.entity_id)) ?? "/work-inbox";
      const sep = link.includes("?") ? "&" : "?";
      const due = iso(r.due_at);
      out.push({
        uid: `work_item:${r.id}`,
        kind: "work_item",
        kindLabel: "Work inbox item",
        category: "Admin",
        id: String(r.id),
        title: str(r.title) || str(r.item_type),
        subtitle: str(r.item_type).replace(/_/g, " ").toLowerCase(),
        stage: "Open in the linked page to act",
        fields: fields(
          badge("Type", str(r.item_type).replace(/_/g, " ")),
          long("Details", r.description),
          f("Module", r.module_code),
          badge("Priority", r.priority),
          f("Assigned to", r.assigned_employee_name),
          date("Due", r.due_at),
          date("Raised", r.created_at),
        ),
        submittedAt: iso(r.created_at),
        priority: PRIORITY_HIGH.has(str(r.priority)) || (due ? new Date(due).getTime() < Date.now() : false) ? "high" : "normal",
        viewPath: `${link}${sep}approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
        meta: { viewOnly: true, itemType: r.item_type },
      });
    }
    return out;
  },
  async decide() {
    throw new LoopbackError(400, "This item cannot be decided from the Approval Center. Open it to act.");
  },
};
