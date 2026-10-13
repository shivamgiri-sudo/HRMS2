import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, str } from "../format.js";
import { maskStatutoryValues } from "../../employees/statutory-approval.routes.js";
import { keepInBranch } from "./_scope.js";
import { holdsLiteralRole } from "./_scope.js";

const LABELS: Record<string, string> = {
  pan_number: "PAN",
  aadhaar_id: "Aadhaar",
  uan_number: "UAN",
  esi_number: "ESI number",
  epf_number: "EPF number",
  pf_eligible: "PF eligible",
  esi_eligible: "ESI eligible",
  epf_date: "EPF date",
};

const parse = (v: unknown): Record<string, any> => {
  if (!v) return {};
  if (typeof v === "string") {
    try { return JSON.parse(v || "{}"); } catch { return {}; }
  }
  return v as Record<string, any>;
};

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "(none)" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

/**
 * Statutory data change (PAN / Aadhaar / UAN / ESI / EPF). hr / admin / super_admin, branch-scoped by the endpoint itself.
 * PAN, Aadhaar, UAN, ESI and EPF numbers are masked with the module's own maskStatutoryValues (last 4 only), stricter than
 * the review page, because the popup opens on every login. Reject needs a note on the page, so it does here.
 */
export const statutoryChangeAdapter: ApprovalAdapter = {
  kind: "statutory_change",
  label: "Statutory data change",
  category: "People",
  async list(ctx) {
    if (!(await holdsLiteralRole(ctx.userId, "hr", "admin", "super_admin"))) return [];
    const res = await ctx.call("GET", "/api/statutory-change-requests/pending");
    // hr / admin are branch-scoped (owner ruling 2026-10-01): only their own branch's employees.
    const rows: any[] = await keepInBranch(ctx.userId, (res?.data ?? []).slice(0, 200), (r: any) => ({ employeeId: r.employee_id, employeeCode: r.employee_code }));
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.status) && str(r.status) !== "pending") continue;
      const next = maskStatutoryValues(parse(r.new_values));
      const prevRaw = parse(r.old_values);
      // old_values is nested ({ employees: {...}, employee_statutory_info: {...} }); new_values is flat.
      const prev = maskStatutoryValues({ ...(prevRaw.employee_statutory_info ?? {}), ...(prevRaw.employees ?? {}), ...prevRaw });
      const keys = Object.keys(next);
      const changes = keys.map((k) => {
        const old = (prev as Record<string, unknown>)[k];
        return f(LABELS[k] ?? k, `${show(old)} -> ${show(next[k])}`);
      });
      out.push({
        uid: `statutory_change:${r.id}`,
        kind: "statutory_change",
        kindLabel: "Statutory data change",
        category: "People",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — ${keys.map((k) => LABELS[k] ?? k).slice(0, 3).join(", ") || "statutory details"}`,
        subtitle: `${keys.length} field(s) changed`,
        requester: { name: str(r.employee_name), code: r.employee_code, branch: r.branch_name },
        stage: "HR review",
        fields: fields(
          f("Employee", str(r.employee_name)),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          ...changes,
          date("Requested on", r.requested_at),
          badge("Numbers shown", "Masked to last 4 characters"),
        ),
        submittedAt: iso(r.requested_at),
        viewPath: `/statutory-change-approvals?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("PATCH", `/api/statutory-change-requests/${encodeURIComponent(item.id)}`, {
      body: { decision: action === "approve" ? "approved" : "rejected", note: remarks || undefined },
    });
  },
};
