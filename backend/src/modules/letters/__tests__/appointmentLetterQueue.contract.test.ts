import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// listAppointmentLetterQueue() used to require a mandatory=1 checklist row to
// even appear in the query, which contradicts evaluateAppointmentLetterEligibility()
// — the single-employee endpoint already correctly reports a no_joining_documents
// blocker for that exact case. Every id returned by the list query still runs
// through that same per-employee evaluation, so list and detail must agree by
// construction: no pre-filter duplicating (or contradicting) the eligibility logic.
const service = readFileSync(
  resolve(process.cwd(), "src/modules/letters/appointmentLetterEligibility.service.ts"),
  "utf8"
);

describe("Appointment letter queue — list/detail agreement", () => {
  it("does not pre-filter the queue by mandatory checklist existence", () => {
    const queueFn = service.slice(service.indexOf("export async function listAppointmentLetterQueue"));
    expect(queueFn).not.toContain("c.mandatory = 1");
  });

  it("excludes legacy_emp_id employees from the queue", () => {
    const queueFn = service.slice(service.indexOf("export async function listAppointmentLetterQueue"));
    expect(queueFn).toContain("e.legacy_emp_id IS NULL");
  });

  // The queue's population filter used to be `e.active_status = 1` alone, with no
  // employment_status check at all — unlike the Joining Documents Tracker, which
  // excludes exited employees explicitly. An employee routed through Exit
  // Management stayed in this queue until active_status happened to catch up.
  it("excludes exited employees by employment_status, not just active_status", () => {
    const queueFn = service.slice(service.indexOf("export async function listAppointmentLetterQueue"));
    expect(queueFn).toContain("e.active_status = 1");
    expect(queueFn).toContain("nonReactivatableSqlList");
  });
});
