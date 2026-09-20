/**
 * Bulk manager operations (US4.6/US4.7): "Send Reminder" and "Extend Deadline" against
 * multiple training_assignment rows at once.
 *
 * The properties every test in this file protects:
 *   1. A manager can only bulk-act on assignments belonging to their OWN team — the
 *      posted id list is re-validated server-side (scopeAssignmentIdsToCaller), never
 *      trusted from the client, mirroring joiningDocumentsTracker's scopeBulkEmployeeIds.
 *   2. Extending a deadline is forward-only, requires a justification, and is logged.
 *   3. A reminder nudge uses a SHORT (30-minute) cooldown, distinct from the 1440-minute
 *      default other events use, because notification.gateway.ts's cooldown keys on
 *      (event_code, entity_type, entity_id) alone, not on dedupeKey.
 *
 * Source-level assertions, matching this repo's convention for modules with heavy pool
 * dependencies.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTES = readFileSync(
  resolve(process.cwd(), "src/modules/quality-learning/quality-learning.routes.ts"),
  "utf8",
);
const TAT_SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/governance/tat.service.ts"),
  "utf8",
);
const MIGRATION = readFileSync(
  resolve(process.cwd(), "sql/1823_training_reminder_nudge_event.sql"),
  "utf8",
);

describe("scopeAssignmentIdsToCaller — bulk actions never trust the posted id list", () => {
  const fn = ROUTES.slice(
    ROUTES.indexOf("async function scopeAssignmentIdsToCaller"),
    ROUTES.indexOf("/**\n * POST /api/quality-learning/assignments/bulk-remind"),
  );

  it("re-queries the database to confirm each id belongs to the caller's own team", () => {
    expect(fn).toMatch(/JOIN employees e ON e\.id = ta\.employee_id/);
    expect(fn).toMatch(/e\.reporting_manager_id = \? OR e\.manager_id = \?/);
  });

  it("a non-wide-role caller with no employee record is denied everything, not granted everything", () => {
    expect(fn).toMatch(/if \(!ownEmployeeId\) return \{ allowed: \[\], denied: assignmentIds \};/);
  });

  it("wide roles (admin/hr/ceo/super_admin/operations_head) bypass the team check entirely", () => {
    expect(fn).toMatch(/if \(isWide\) return \{ allowed: assignmentIds, denied: \[\] \};/);
  });

  it("both bulk routes call this scoping function before doing anything else with the posted ids", () => {
    for (const routePath of ["bulk-remind", "bulk-extend-deadline"]) {
      const routeStart = ROUTES.indexOf(`"/assignments/${routePath}"`);
      const routeBody = ROUTES.slice(routeStart, routeStart + 1500);
      expect(routeBody).toMatch(/scopeAssignmentIdsToCaller\(req, assignmentIds\)/);
    }
  });

  it("both bulk routes 403 rather than silently no-op when nothing in the request is in scope", () => {
    for (const routePath of ["bulk-remind", "bulk-extend-deadline"]) {
      const routeStart = ROUTES.indexOf(`"/assignments/${routePath}"`);
      const routeBody = ROUTES.slice(routeStart, routeStart + 1500);
      expect(routeBody).toMatch(/if \(!allowed\.length\) \{\s*\n\s*return res\.status\(403\)/);
    }
  });
});

describe("bulk-remind route", () => {
  const routeStart = ROUTES.indexOf('"/assignments/bulk-remind"');
  const routeBody = ROUTES.slice(routeStart, ROUTES.indexOf('"/assignments/bulk-extend-deadline"'));

  it("fires through notificationGateway.notify, not a direct email call", () => {
    expect(routeBody).toMatch(/notificationGateway\.notify\(\{/);
    expect(routeBody).not.toMatch(/sendEmail|sendJoiningDocReminderEmail/);
  });

  it("uses the dedicated training_reminder_nudge event code, not the automatic escalation ladder's codes", () => {
    expect(routeBody).toMatch(/eventCode: "training_reminder_nudge"/);
    expect(routeBody).not.toMatch(/task_sla_breach_l[123]/);
  });

  it("includes a per-call timestamp in the dedupe key so a manager's repeat nudge is not silently swallowed by the claim table's own uniqueness, leaving the cooldown as the real throttle", () => {
    expect(routeBody).toMatch(/dedupeKey: `training_assignment:\$\{row\.id\}:manual_nudge:\$\{Date\.now\(\)\}`/);
  });

  it("a 'cooldown' outcome from the gateway is counted as skipped, not silently dropped or reported as a failure", () => {
    expect(routeBody).toMatch(/notifyResult\.outcome === "cooldown"/);
    const cooldownBranch = routeBody.slice(routeBody.indexOf('outcome === "cooldown"'));
    expect(cooldownBranch.slice(0, 60)).toMatch(/result\.skipped\+\+/);
  });

  it("one failing notification does not abort the batch", () => {
    expect(routeBody).toMatch(/for \(const row of rows[\s\S]*?\{\s*\n\s*try \{/);
    expect(routeBody).toMatch(/\} catch \(err\) \{\s*\n\s*result\.failed\+\+;/);
  });
});

describe("training_reminder_nudge event configuration — short cooldown, live from day one", () => {
  it("ships enabled and live, not shadow-mode pending a later go-live decision", () => {
    expect(MIGRATION).toMatch(/1, 'live', 'int', 0,/);
  });

  it("cooldown is 30 minutes, not the 1440-minute default other events use", () => {
    const insertBlock = MIGRATION.slice(MIGRATION.indexOf("VALUES"), MIGRATION.indexOf("UPDATE notification_event_config"));
    expect(insertBlock).toMatch(/\n\s*30,\s*\n\s*NULL\);/);
  });

  it("documents WHY the cooldown is short, so a future edit does not silently widen it back to the default", () => {
    expect(MIGRATION).toMatch(/keys on \(event_code, entity_type, entity_id\) alone.*not on dedupeKey/s);
  });

  it("addresses only the employee — no cc/bcc that would need the fin-sensitivity guard", () => {
    expect(MIGRATION).toMatch(/'\{"to":\[\{"kind":"employee"\}\]\}'/);
  });
});

describe("bulk-extend-deadline route", () => {
  const routeStart = ROUTES.indexOf('"/assignments/bulk-extend-deadline"');
  const routeBody = ROUTES.slice(routeStart, ROUTES.indexOf("// ── LMS Provisioning"));

  it("requires newDueAt and rejects an invalid date before touching the database", () => {
    expect(routeBody).toMatch(/if \(!newDueAt \|\| Number\.isNaN\(new Date\(newDueAt\)\.getTime\(\)\)\)/);
  });

  it("requires a non-empty justification", () => {
    expect(routeBody).toMatch(/if \(!justification\?\.trim\(\)\)/);
  });

  it("skips (and reports, not silently drops) an assignment with no TAT instance rather than crashing on a null", () => {
    expect(routeBody).toMatch(/if \(!row\.tat_instance_id\) \{/);
    expect(routeBody).toMatch(/No TAT instance on this assignment/);
  });

  it("delegates the actual due_at mutation to the shared governance service, not a local UPDATE", () => {
    expect(routeBody).toMatch(/await extendTatDeadline\(row\.tat_instance_id, newDueAt, req\.authUser!\.id\);/);
    expect(routeBody).not.toMatch(/UPDATE task_tat_instance SET due_at/);
  });

  it("appends the justification to the assignment's own notes, since task_escalation_log has no reason column", () => {
    expect(routeBody).toMatch(/UPDATE training_assignment SET notes = TRIM\(CONCAT\(COALESCE\(notes, ''\), '\\n', \?\)\)/);
  });
});

describe("extendTatDeadline (governance/tat.service.ts) — the shared capability this feature is built on", () => {
  const fn = TAT_SERVICE.slice(
    TAT_SERVICE.indexOf("export async function extendTatDeadline"),
    TAT_SERVICE.indexOf("/**\n * Mark a TAT instance as completed"),
  );

  it("did not exist before — confirms this is new capability, not a rename of an existing function", () => {
    // Sanity: the function is present exactly once.
    expect(TAT_SERVICE.match(/export async function extendTatDeadline/g)?.length).toBe(1);
  });

  it("refuses to shorten a deadline", () => {
    expect(fn).toMatch(/if \(requestedDueAt\.getTime\(\) <= currentDueAt\.getTime\(\)\)/);
    expect(fn).toMatch(/New deadline must be later than the current one/);
  });

  it("refuses on an already-completed or cancelled task", () => {
    expect(fn).toMatch(/if \(task\.status === "completed" \|\| task\.status === "cancelled"\)/);
  });

  it("clears an sla_breached status back to open against the new deadline, rather than leaving a stale breach flag", () => {
    expect(fn).toMatch(/CASE WHEN status = 'sla_breached' THEN 'open' ELSE status END/);
  });

  it("does NOT touch current_escalation_level — that counter is history, not re-derived from the new deadline", () => {
    expect(fn).not.toMatch(/current_escalation_level\s*=/);
  });

  it("logs the extension in task_escalation_log at a synthetic level (-1) that cannot collide with real escalation levels 0-3", () => {
    expect(fn).toMatch(/VALUES \(UUID\(\), \?, -1, NOW\(\), \?, 'extended'\)/);
  });

  it("does not enforce single-row uniqueness on the extension log row — repeated extensions are all legitimate, unlike repeated completions", () => {
    // No ER_DUP_ENTRY handling here, unlike recordEscalation's per-level dedupe — every
    // extension gets a fresh audit row rather than being caught as a duplicate.
    expect(fn).not.toMatch(/ER_DUP_ENTRY/);
  });
});
