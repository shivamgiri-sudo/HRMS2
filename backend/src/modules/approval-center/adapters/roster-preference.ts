import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { getEmployeeForUser } from "../../../shared/accessGuard.js";

/**
 * Employee roster / week-off preference (employee_roster_preference, status pending). The module's list is
 * scope-visible and includes the caller's own rows, which the page lets nobody decide on themselves, so own rows are dropped.
 * Not covered: the stricter two-stage week-off flow under /api/roster-gov/weekoff-preferences, which has no inbox-style list (needs processId).
 */
export const rosterPreferenceAdapter: ApprovalAdapter = {
  kind: "roster_preference",
  label: "Roster / week-off preference",
  category: "Attendance",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/wfm/roster-preferences/pending");
    const rows: any[] = ((res?.data ?? []) as any[]).filter((r) => !str(r.status) || str(r.status) === "pending").slice(0, 200);
    if (rows.length === 0) return [];
    const me = await getEmployeeForUser(ctx.userId);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (me?.id && String(r.employee_id) === String(me.id)) continue;
      const name = `${str(r.first_name)} ${str(r.last_name)}`.trim() || "Employee";
      const id = String(r.id);
      out.push({
        uid: `roster_preference:${id}`,
        kind: "roster_preference",
        kindLabel: "Roster / week-off preference",
        category: "Attendance",
        id,
        title: `${name} — ${str(r.preferred_week_off) ? `week-off ${str(r.preferred_week_off)}` : str(r.shift_name) || "roster preference"}`,
        subtitle: `Effective from ${str(r.effective_from).slice(0, 10)}`,
        requester: { name, code: r.employee_code },
        stage: "Manager / WFM approval",
        fields: fields(
          f("Employee", name),
          f("Employee code", r.employee_code),
          f("Preferred shift", r.shift_name),
          f("Preferred week-off", r.preferred_week_off),
          badge("Flexibility", r.flexibility),
          date("Effective from", r.effective_from),
          long("Notes", r.notes),
          date("Submitted on", r.created_at),
        ),
        submittedAt: iso(r.created_at),
        viewPath: `/roster-preference?approvalId=${encodeURIComponent(id)}`,
        rejectNeedsReason: false,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") await ctx.call("PATCH", `/api/wfm/roster-preferences/${id}/approve`, { body: {} });
    else await ctx.call("PATCH", `/api/wfm/roster-preferences/${id}/reject`, { body: { reason: remarks || undefined } });
  },
};
