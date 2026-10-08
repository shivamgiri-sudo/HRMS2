import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { hasAnyRole } from "../../../shared/scopeAccess.js";

/** Same role list as the PATCH /holiday-work/requests/:id/approve guard (the list endpoint also admits finance / branch_wfm, who cannot decide). */
const DECIDE_ROLES = ["admin", "super_admin", "payroll", "payroll_head", "wfm", "payroll_branch"];
const DETAIL_CAP = 50;

/** Holiday-work request awaiting payroll approval (status `submitted`). */
export const holidayWorkAdapter: ApprovalAdapter = {
  kind: "holiday_work",
  label: "Holiday work request",
  category: "Payroll",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/payroll/holiday-work/requests", { query: { status: "submitted" } });
    const rows: any[] = (res?.data ?? []).filter((r: any) => str(r.status) === "submitted").slice(0, 200);
    if (rows.length === 0) return [];
    if (!(await hasAnyRole(ctx.userId, ...DECIDE_ROLES))) return [];

    // The list rows carry no branch/process names or designations; the detail endpoint does.
    const details = new Map<string, any>();
    await Promise.all(
      rows.slice(0, DETAIL_CAP).map(async (r) => {
        try {
          const d = await ctx.call("GET", `/api/payroll/holiday-work/requests/${encodeURIComponent(String(r.id))}`);
          details.set(String(r.id), d?.data ?? null);
        } catch { /* fall back to the list row */ }
      }),
    );

    return rows.map((r): ApprovalItem => {
      const d = { ...r, ...(details.get(String(r.id)) ?? {}) };
      const desigs = Array.isArray(d.designations) ? d.designations.map((x: any) => str(x.designation_name || x.designation_id)).filter(Boolean).join(", ") : "";
      const hours = Number(d.min_hours_required);
      return {
        uid: `holiday_work:${r.id}`,
        kind: "holiday_work",
        kindLabel: "Holiday work request",
        category: "Payroll",
        id: String(r.id),
        title: `${str(d.holiday_name) || "Holiday"} — ${str(d.branch_name) || "branch"}${str(d.process_name) ? ` / ${str(d.process_name)}` : ""}`,
        subtitle: `Requested by ${str(d.requested_by_name) || "—"}`,
        requester: { name: d.requested_by_name, branch: d.branch_name },
        stage: "Payroll approval",
        fields: fields(
          f("Holiday", d.holiday_name),
          badge("Holiday type", d.holiday_type),
          date("Holiday date", d.holiday_date),
          f("Request month", str(d.request_month).slice(0, 7)),
          f("Branch", d.branch_name || d.branch_id),
          f("Process", d.process_name || d.process_id),
          f("Requested by", d.requested_by_name),
          f("Payout policy", `${str(d.payout_type)}${d.payout_rate_multiplier ? ` (x${d.payout_rate_multiplier})` : ""}`),
          f("Minimum hours", Number.isFinite(hours) && hours > 0 ? `${(hours / 60).toFixed(1)} h` : ""),
          f("Client approval ref", d.client_approval_reference),
          long("Eligible designations", desigs),
          long("Reason", d.request_reason),
          long("Remarks", d.remarks),
          f("Attachment", d.attachment_document_id ? "Attached" : ""),
          date("Raised on", d.created_at),
        ),
        submittedAt: iso(d.created_at),
        viewPath: `/payroll/holiday-work?tab=approvals&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
      };
    });
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("PATCH", `/api/payroll/holiday-work/requests/${encodeURIComponent(item.id)}/approve`, {
      body: { action, remarks: remarks || undefined },
    });
  },
};
