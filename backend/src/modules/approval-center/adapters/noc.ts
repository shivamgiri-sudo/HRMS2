import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { hasAnyRole } from "../../../shared/scopeAccess.js";
import { ageDays } from "./payroll-shared.js";

/** Payroll NOC (salary / F&F): uploaded by branch payroll, validated or rejected by the Payroll Head only (the endpoint enforces it too). */
export const nocAdapter: ApprovalAdapter = {
  kind: "payroll_noc",
  label: "Payroll NOC",
  category: "Payroll",
  async list(ctx) {
    if (!(await hasAnyRole(ctx.userId, "payroll_head", "super_admin"))) return [];
    const res = await ctx.call("GET", "/api/payroll/noc/", { query: { uploadStatus: "uploaded" } });
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.upload_status) !== "uploaded") continue;
      const age = ageDays(r.uploaded_at ?? r.created_at);
      const fnf = r.noc_type === "fnf";
      out.push({
        uid: `payroll_noc:${r.id}`,
        kind: "payroll_noc",
        kindLabel: "Payroll NOC",
        category: "Payroll",
        id: String(r.id),
        title: `${str(r.employee_name) || str(r.employee_code) || "Employee"} — ${fnf ? "F&F" : "salary"} NOC`,
        subtitle: str(r.run_month) ? `Payroll month ${str(r.run_month)}` : undefined,
        requester: { name: r.employee_name, code: r.employee_code },
        stage: "Payroll Head validation",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          badge("NOC type", fnf ? "F&F" : "Salary"),
          f("Payroll month", r.run_month),
          f("Uploaded by", r.uploaded_by_name),
          date("Uploaded on", r.uploaded_at ?? r.created_at),
          long("Reason", r.reason),
          long("Note", r.note),
        ),
        submittedAt: iso(r.uploaded_at ?? r.created_at),
        priority: age !== null && age >= 3 ? "high" : "normal",
        viewPath: `/payroll/noc?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: "Validate",
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") await ctx.call("PATCH", `/api/payroll/noc/${id}/validate`, { body: { note: remarks || undefined } });
    else await ctx.call("PATCH", `/api/payroll/noc/${id}/reject`, { body: { reason: remarks } });
  },
};
