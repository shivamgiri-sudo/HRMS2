import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";

/** Page-access requests. Both endpoints are admin-only; a non-admin gets 403 from list (swallowed by the service). */
export const accessRequestAdapter: ApprovalAdapter = {
  kind: "access_request",
  label: "Page access request",
  category: "Admin",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/access/requests", { query: { status: "pending" } });
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (r.status !== "pending") continue;
      if (str(r.user_id) && str(r.user_id) === ctx.userId) continue; // never approve own access
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
