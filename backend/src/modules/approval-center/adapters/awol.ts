import type { ApprovalAdapter, ApprovalItem, LoopbackCtx } from "../types.js";
import { LoopbackError } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { assertWorkItemAccess } from "../../work-inbox/work-inbox.service.js";

const MAX_CONTEXT_CALLS = 15;

/**
 * AWOL suspected (7 consecutive no-show days): the reporting manager confirms absconding (raises an
 * involuntary/absconding exit) or dismisses it. Same access rule as the work-inbox endpoints
 * (assignee, or privileged role inside branch scope) via the module's own assertWorkItemAccess.
 */
export const awolAdapter: ApprovalAdapter = {
  kind: "awol",
  label: "Possible absconding (AWOL)",
  category: "Exit",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/work-inbox/my");
    const rows: any[] = (res?.data ?? []).filter(
      (r: any) => r.source_table === "work_item" && r.item_type === "AWOL_SUSPECTED" && !["completed", "cancelled"].includes(str(r.status)),
    );
    const actionable: any[] = [];
    for (const r of rows.slice(0, 100)) {
      try {
        await assertWorkItemAccess(ctx.userId, String(r.id), "complete");
        actionable.push(r);
      } catch {
        /* not decidable by this caller (role-queue visibility only) */
      }
    }
    const contexts = new Map<string, any>();
    await Promise.all(
      actionable.slice(0, MAX_CONTEXT_CALLS).map(async (r) => {
        try {
          const c = await ctx.call("GET", `/api/work-inbox/${encodeURIComponent(String(r.id))}/awol-context`);
          contexts.set(String(r.id), c?.data ?? {});
        } catch {
          /* context is display-only here; decide() re-reads it */
        }
      }),
    );
    return actionable.map((r): ApprovalItem => {
      const c = contexts.get(String(r.id)) ?? {};
      const name = str(c.employeeName) || str(r.title);
      return {
        uid: `awol:${r.id}`,
        kind: "awol",
        kindLabel: "Possible absconding (AWOL)",
        category: "Exit",
        id: String(r.id),
        title: `${name || "Employee"} — absent 7+ days`,
        subtitle: c.lastWorkedDate ? `Last worked ${str(c.lastWorkedDate).slice(0, 10)}` : undefined,
        requester: { name: c.employeeName ?? null },
        stage: "Reporting manager: confirm absconding or dismiss",
        fields: fields(
          f("Employee", c.employeeName),
          date("Last worked day", c.lastWorkedDate),
          long("Details", r.description),
          badge("Priority", r.priority),
          date("Due", r.due_at),
          date("Raised", r.created_at),
        ),
        submittedAt: iso(r.created_at),
        priority: r.priority === "critical" || r.priority === "high" ? "high" : "normal",
        viewPath: `/work-inbox?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true, // dismissal requires a reason
        approveLabel: "Confirm absconding",
        rejectLabel: "Not absconding",
        meta: { employeeId: c.employeeId ?? r.entity_id ?? null },
      };
    });
  },
  async decide(ctx: LoopbackCtx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "reject") {
      await ctx.call("POST", `/api/work-inbox/${id}/awol/reject`, { body: { remarks } });
      return;
    }
    // Confirm needs the last worked date, which the module derives from attendance.
    const c = await ctx.call("GET", `/api/work-inbox/${id}/awol-context`);
    const lastWorkedDate = str(c?.data?.lastWorkedDate).slice(0, 10);
    if (!lastWorkedDate) {
      throw new LoopbackError(400, "Last worked date could not be determined from attendance. Open the item to enter it manually.");
    }
    await ctx.call("POST", `/api/work-inbox/${id}/awol/confirm`, { body: { lastWorkedDate, remarks: remarks || undefined } });
  },
};
