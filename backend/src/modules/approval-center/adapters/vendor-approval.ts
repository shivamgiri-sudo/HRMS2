import type { ApprovalAdapter, ApprovalItem, ApprovalField } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { ageDays, callerRoles, hasRole, rowsOf } from "./finance-shared.js";

const LABELS: Record<string, string> = {
  vendor_name: "Vendor name", vendor_code: "Vendor code", vendor_type: "Vendor type", contact_name: "Contact name",
  contact_email: "Contact email", contact_phone: "Contact phone", gst_number: "GST number", pan_number: "PAN number",
  payment_terms: "Payment terms", address: "Address", city: "City", state: "State", pincode: "Pincode",
  expense_head_code: "Suggested expense head", expense_sub_head_code: "Suggested expense sub-head",
  msme_registered: "MSME registered", tds_applicable: "TDS applicable", notes: "Notes",
};
const humanize = (k: string) => LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const SKIP = new Set(["id"]);

function payloadOf(r: any): Record<string, unknown> {
  const p = r.payload;
  if (typeof p === "string") {
    try { return JSON.parse(p); } catch { return {}; }
  }
  return p && typeof p === "object" ? p : {};
}

/**
 * Vendor create/update requests (Finance Head / super_admin). Approving sends NO editedPayload, so the
 * stored payload is applied exactly as raised (the service merges edits only when given).
 * Maker-checker: the raiser cannot approve.
 */
export const vendorApprovalAdapter: ApprovalAdapter = {
  kind: "vendor_approval",
  label: "Vendor request",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    if (!hasRole(roles, "finance_head", "super_admin")) return [];
    const res = await ctx.call("GET", "/api/finance/vendor-approval/requests", { query: { status: "pending", limit: 200 } });
    const out: ApprovalItem[] = [];
    for (const r of rowsOf(res?.data ?? res)) {
      if (str(r.status) !== "pending") continue;
      if (str(r.raised_by) === ctx.userId) continue;
      const p = payloadOf(r);
      const create = str(r.request_type) === "create";
      const age = ageDays(r.raised_at);
      const payloadFields: ApprovalField[] = Object.entries(p)
        .filter(([k, v]) => !SKIP.has(k) && v !== null && v !== undefined && typeof v !== "object")
        .map(([k, v]) => (k === "notes" ? long(humanize(k), v) : f(humanize(k), typeof v === "boolean" ? (v ? "Yes" : "No") : v)));
      out.push({
        uid: `vendor_approval:${r.id}`,
        kind: "vendor_approval",
        kindLabel: "Vendor request",
        category: "Finance",
        id: String(r.id),
        title: `${create ? "New vendor" : "Vendor update"} — ${str(p.vendor_name) || "(unnamed)"}`,
        subtitle: [str(p.vendor_type), str(r.branch_name)].filter(Boolean).join(" · "),
        requester: { name: str(r.raised_by_name) || null, branch: r.branch_name },
        stage: "Finance Head approval",
        fields: fields(
          badge("Request type", create ? "Create vendor" : "Update vendor"),
          f("Existing vendor id", create ? "" : r.vendor_id),
          f("Branch", r.branch_name),
          f("Raised by", str(r.raised_by_name)),
          date("Raised on", r.raised_at),
          f("Days pending", age),
          ...payloadFields,
        ),
        submittedAt: iso(r.raised_at),
        priority: age !== null && age > 3 ? "high" : "normal",
        viewPath: `/finance/masters?tab=approvals&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/finance/vendor-approval/${encodeURIComponent(item.id)}`;
    if (action === "approve") await ctx.call("PATCH", `${base}/approve`, { body: { reviewNotes: remarks || undefined } });
    else await ctx.call("PATCH", `${base}/reject`, { body: { reviewNotes: remarks } });
  },
};
