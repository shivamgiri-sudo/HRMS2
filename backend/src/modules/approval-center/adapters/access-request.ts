import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { branchAllowed, callerScope, io } from "./scope-guard.js";
import { holdsLiteralRole } from "./_scope.js";

/**
 * Page-access requests. Both endpoints are admin-only; a non-admin gets 403 from list (swallowed by the service). The endpoint lists
 * every user's request org-wide, and `admin` is branch-scoped, so a request is shown only when the requesting person's employee
 * record is in the caller's OWN branch (super_admin and the other org-wide roles: all). A requester with no employee record has no
 * branch, so only org-wide callers see theirs.
 */
export const accessRequestAdapter: ApprovalAdapter = {
  kind: "access_request",
  label: "Page access request",
  category: "Admin",
  async list(ctx) {
    if (!(await holdsLiteralRole(ctx.userId, "admin"))) return [];
    const res = await ctx.call("GET", "/api/access/requests", { query: { status: "pending" } });
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    const me = await callerScope(ctx);
    const requesters = me.orgWide ? new Map() : await io.userEmployees(rows.map((r) => r.user_id));
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (r.status !== "pending") continue;
      if (str(r.user_id) && str(r.user_id) === ctx.userId) continue; // never approve own access
      if (!branchAllowed(me, requesters.get(str(r.user_id))?.branchId)) continue;
      const page = str(r.page_name) || str(r.page_code);
      out.push({
        uid: `access_request:${r.id}`,
        kind: "access_request",
        kindLabel: "Page access request",
        category: "Admin",
        id: String(r.id),
        title: `${str(r.user_email) || "User"} — access to ${page}`,
        subtitle: str(r.page_code) || undefined,
        requester: { name: r.user_email },
        stage: "Admin review",
        fields: fields(
          f("User", r.user_email),
          f("Page", r.page_name),
          badge("Page code", r.page_code),
          long("Reason", r.reason),
          date("Requested", r.created_at),
        ),
        submittedAt: iso(r.created_at),
        viewPath: `/settings/access-control?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false, // deny accepts an empty note
        meta: {},
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") await ctx.call("POST", `/api/access/requests/${id}/approve`, { body: {} });
    else await ctx.call("POST", `/api/access/requests/${id}/deny`, { body: { review_note: remarks || undefined } });
  },
};
