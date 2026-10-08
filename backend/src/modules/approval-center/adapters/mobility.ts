import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { callerHasRole } from "./_roles.js";
import { keepInBranch } from "./_scope.js";

const TRANSFER_TYPE: Record<string, string> = {
  branch: "Branch transfer",
  department: "Department transfer",
  process: "Process transfer",
  location: "Location transfer",
  reporting: "Reporting manager change",
  reporting_manager: "Reporting manager change",
  cost_centre: "Cost centre transfer",
};
const STALE_DAYS = 7;

/**
 * Mobility: transfers and promotions awaiting approval. PATCH /api/mobility/{transfers|promotions}/:id is admin / hr only,
 * but the GET endpoints also answer plain employees with THEIR OWN records, so the caller's role is checked first.
 * The GETs are already branch-scoped for hr and only pending rows are requested. Approve applies the move immediately
 * (or holds a future-dated transfer for the worker), all inside the module's own handler.
 */
export const mobilityAdapter: ApprovalAdapter = {
  kind: "mobility",
  label: "Transfer / promotion",
  category: "People",
  async list(ctx) {
    if (!(await callerHasRole(ctx.userId, "admin", "hr"))) return [];
    const [t, p] = await Promise.all([
      ctx.call("GET", "/api/mobility/transfers", { query: { status: "pending" } }),
      ctx.call("GET", "/api/mobility/promotions", { query: { status: "pending" } }),
    ]);
    // admin / hr are branch-scoped (owner ruling 2026-10-01): only transfers / promotions of employees in their own branch.
    const refOf = (r: any) => ({ employeeId: r.employee_id, employeeCode: r.employee_code });
    const transfers = await keepInBranch(ctx.userId, ((t?.data ?? []) as any[]).slice(0, 200), refOf);
    const promotions = await keepInBranch(ctx.userId, ((p?.data ?? []) as any[]).slice(0, 200), refOf);
    const out: ApprovalItem[] = [];
    for (const r of transfers) {
      if (str(r.status) !== "pending") continue;
      const typeLabel = TRANSFER_TYPE[str(r.transfer_type)] ?? str(r.transfer_type);
      const created = iso(r.created_at);
      out.push({
        uid: `mobility:${r.id}`,
        kind: "mobility",
        kindLabel: "Transfer",
        category: "People",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — ${typeLabel}`,
        subtitle: `${str(r.from_value) || "-"} to ${str(r.to_value)} · effective ${str(r.effective_date).slice(0, 10)}`,
        requester: { name: r.employee_name, code: r.employee_code },
        stage: "HR approval",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          badge("Transfer type", typeLabel),
          f("From", r.from_value),
          f("To", r.to_value),
          f("New reporting manager", r.new_reporting_manager_id),
          date("Effective date", r.effective_date),
          long("Reason", r.reason),
          date("Raised on", r.created_at),
        ),
        submittedAt: created,
        priority: created && (Date.now() - new Date(created).getTime()) / 86_400_000 > STALE_DAYS ? "high" : "normal",
        viewPath: `/mobility?tab=transfers&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
        meta: { type: "transfer" },
      });
    }
    for (const r of promotions) {
      if (str(r.status) !== "pending") continue;
      const created = iso(r.created_at);
      out.push({
        uid: `mobility:${r.id}`,
        kind: "mobility",
        kindLabel: "Promotion",
        category: "People",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — promotion to ${str(r.to_designation)}`,
        subtitle: `${str(r.from_designation) || "-"} to ${str(r.to_designation)} · effective ${str(r.effective_date).slice(0, 10)}`,
        requester: { name: r.employee_name, code: r.employee_code },
        stage: "HR approval",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("From designation", r.from_designation),
          f("To designation", r.to_designation),
          f("From grade", r.from_grade),
          f("To grade", r.to_grade),
          money("Salary revision", r.salary_revision),
          date("Effective date", r.effective_date),
          long("Reason", r.reason),
          date("Raised on", r.created_at),
        ),
        submittedAt: created,
        priority: created && (Date.now() - new Date(created).getTime()) / 86_400_000 > STALE_DAYS ? "high" : "normal",
        viewPath: `/mobility?tab=promotions&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
        meta: { type: "promotion" },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const path = item.meta?.type === "promotion" ? "promotions" : "transfers";
    await ctx.call("PATCH", `/api/mobility/${path}/${encodeURIComponent(item.id)}`, {
      body: { action: action === "approve" ? "approved" : "rejected", remarks: remarks || undefined },
    });
  },
};
