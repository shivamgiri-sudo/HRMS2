import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { branchAllowed, callerScope, io } from "./scope-guard.js";

/**
 * Company feed post moderation. The module's approvals endpoint is role-gated (admin / super_admin /
 * hr_head) and returns only queued posts; 403 for everyone else is swallowed by the service.
 * The queue is company-wide, but `admin` is a branch-scoped role: a post is shown only when its author sits in the caller's OWN
 * branch (hr_head / super_admin and the other org-wide roles: every post). Nobody moderates their own post.
 */
export const companyPostAdapter: ApprovalAdapter = {
  kind: "company_post",
  label: "Company feed post",
  category: "Engagement",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/engagement/company-posts/approvals", { query: { page: 1, limit: 100 } });
    const rows: any[] = res?.posts ?? res?.data?.posts ?? [];
    const me = await callerScope(ctx);
    const authors = me.orgWide ? new Map() : await io.userEmployees(rows.map((r) => r.author_user_id));
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (r.status !== "pending_approval" && r.status !== "borderline_flagged") continue;
      if (r.active_status === false || r.active_status === 0) continue;
      if (str(r.author_user_id) && str(r.author_user_id) === ctx.userId) continue; // never moderate own post
      if (!branchAllowed(me, authors.get(str(r.author_user_id))?.branchId)) continue;
      const media = Array.isArray(r.media) ? r.media.length : 0;
      const flagged = r.status === "borderline_flagged";
      const text = str(r.content_text);
      out.push({
        uid: `company_post:${r.id}`,
        kind: "company_post",
        kindLabel: "Company feed post",
        category: "Engagement",
        id: String(r.id),
        title: `${str(r.author_name) || str(r.author_code) || "Employee"} — post for approval`,
        subtitle: text ? (text.length > 90 ? `${text.slice(0, 90)}…` : text) : media ? `${media} image(s)` : undefined,
        requester: { name: r.author_name, code: r.author_code },
        stage: flagged ? "Flagged by auto-moderation — needs review" : "Awaiting moderator approval",
        fields: fields(
          f("Author", r.author_name),
          f("Employee code", r.author_code),
          long("Post content", text),
          f("Images attached", media ? String(media) : ""),
          badge("Queue status", flagged ? "Borderline flagged" : "Pending approval"),
          badge("Moderation state", r.moderation_state),
          f("Moderation score", r.moderation_score),
          long("Auto-moderation note", r.auto_reject_reason),
          f("Post type", r.post_type),
          date("Submitted", r.submitted_at ?? r.created_at),
        ),
        submittedAt: iso(r.submitted_at ?? r.created_at),
        priority: flagged ? "high" : "normal",
        viewPath: `/engagement/company-feed/approvals?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false, // endpoint defaults the reason to "Rejected by moderator"
        meta: { flagged },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") {
      await ctx.call("POST", `/api/engagement/company-posts/${id}/approve`, { body: { review_notes: remarks || undefined } });
    } else {
      await ctx.call("POST", `/api/engagement/company-posts/${id}/reject`, {
        body: { reason: remarks || undefined, review_notes: remarks || undefined },
      });
    }
  },
};
