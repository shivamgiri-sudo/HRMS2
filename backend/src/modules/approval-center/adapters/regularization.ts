import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { nextRegularizationStatus, regularizationReviewRole } from "../../wfm/wfm.regularization.secure.routes.js";

const AGE_HIGH_MS = 3 * 24 * 3600 * 1000;
const STAGES: Record<string, string> = {
  pending: "Stage 1 — Reporting manager",
  manager_approved: "Stage 2 — WFM",
  payroll_pending: "Stage 3 — Payroll (month already frozen)",
};

/** Run `fn` over items with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/**
 * Attendance regularization (3 stages: manager -> WFM -> payroll). The list endpoint returns scope-visible rows;
 * the module's own regularizationReviewRole + stage machine decide whether the caller can act on each.
 */
export const regularizationAdapter: ApprovalAdapter = {
  kind: "regularization",
  label: "Attendance regularization",
  category: "Attendance",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/wfm/regularizations", {
      query: { status: "pending,manager_approved,payroll_pending", limit: 200 },
    });
    const rows: any[] = res?.data ?? [];
    const actionable = await mapLimit(rows, 8, async (r) => {
      if (r.decision_support?.canApproveNow === true) return true;
      try {
        const role = await regularizationReviewRole(ctx.userId, String(r.id));
        return !!role && nextRegularizationStatus(role, str(r.status), "approved") !== null;
      } catch {
        return false;
      }
    });
    const out: ApprovalItem[] = [];
    rows.forEach((r, i) => {
      if (!actionable[i]) return;
      const created = iso(r.created_at);
      const aged = created ? Date.now() - new Date(created).getTime() > AGE_HIGH_MS : false;
      const ds = r.decision_support ?? {};
      const punches = (a: unknown, b: unknown) => (str(a) || str(b) ? `${str(a) || "—"} to ${str(b) || "—"}` : "");
      out.push({
        uid: `regularization:${r.id}`,
        kind: "regularization",
        kindLabel: "Attendance regularization",
        category: "Attendance",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — ${str(r.requested_status || r.new_status).replace(/_/g, " ") || "attendance correction"}`,
        subtitle: `For ${str(r.session_date).slice(0, 10)}`,
        requester: { name: r.employee_name, code: r.employee_code, branch: r.branch_name },
        stage: STAGES[str(r.status)] ?? str(r.status),
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          f("Process", r.process_name),
          f("Reporting manager", r.manager_name),
          date("Attendance date", r.session_date),
          badge("Requested status", str(r.requested_status || r.new_status).replace(/_/g, " ")),
          badge("Current status", str(r.current_attendance_status || r.old_status).replace(/_/g, " ")),
          f("Dispute type", r.dispute_type),
          f("Requested punches (in / out)", punches(r.new_punch_in, r.new_punch_out)),
          f("Recorded punches (in / out)", punches(r.first_punch || r.old_punch_in, r.last_punch || r.old_punch_out)),
          f("Roster", r.roster_status),
          f("Requested by", r.requested_by_type),
          f("Reason category", r.reason_label),
          long("Reason", r.reason),
          long("Supporting note", r.supporting_note),
          f("Supporting document", r.supporting_doc_id ? "Attached" : ""),
          badge("Risk", ds.riskLevel),
          long("Risk flags", Array.isArray(ds.flags) ? ds.flags.join("; ") : ""),
          date("Raised on", r.created_at),
        ),
        submittedAt: created,
        priority: aged || ds.riskLevel === "high" ? "high" : "normal",
        viewPath: `/attendance-regularization?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        meta: { status: str(r.status) },
      });
    });
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("PATCH", `/api/wfm/regularizations/${encodeURIComponent(item.id)}/review`, {
      body: { status: action === "approve" ? "approved" : "rejected", reviewerNote: remarks || null },
    });
  },
};
