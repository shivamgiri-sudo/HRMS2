/**
 * Recruiter hiring: logging the follow-up call.
 *
 * Migration 1009 shipped five followup_call_* columns on
 * ats_recruiter_hiring_activity, and NativeATSHiringEntry has had a "Log call"
 * modal posting to /api/ats/recruiter/hiring-activity/:id/log-followup-call —
 * but the route was never written. Confirmed on production 2026-07-31 with a
 * valid super_admin token:
 *   {"message":"Route not found: POST /api/ats/recruiter/hiring-activity/.../log-followup-call"}
 * and the live census agreed: 0 of 38,236 activity rows had followup_call_done=1.
 *
 * The completed/pending semantics are taken from the client, not inferred. The
 * page renders the "Done" pill on `row.followup_call_done && !row.followup_required`,
 * so logging a call must clear followup_required — except for "Rescheduled",
 * which is the one outcome that keeps the follow-up open and moves followup_date
 * to the new date so the row stays in the pending list.
 *
 * Source assertions: the suite has no live DB, and the defect was a route that
 * did not exist writing to columns that did. That is what source assertions catch.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const routes = readFileSync(resolve(process.cwd(), "src/modules/ats/recruiter-hiring.routes.ts"), "utf8");
const atsRoutes = readFileSync(resolve(process.cwd(), "src/modules/ats/ats.routes.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "sql/1009_ats_hiring_followup_call_feedback.sql"), "utf8");
const page = readFileSync(resolve(repoRoot, "src/pages/NativeATSHiringEntry.tsx"), "utf8");

/** The five columns migration 1009 added. */
const CALL_COLUMNS = [
  "followup_call_done",
  "followup_call_date",
  "followup_call_outcome",
  "followup_call_notes",
  "followup_rescheduled_to",
];

/** The outcomes the page's <select> offers. */
const UI_OUTCOMES = [
  "Interested",
  "Not Interested",
  "No Response",
  "Rescheduled",
  "Already Joined",
  "Declined Offer",
  "Wrong Number",
];

describe("log-followup-call — the route exists and is reachable", () => {
  it("is declared on the recruiter hiring router", () => {
    expect(routes).toContain('recruiterHiringRouter.post("/recruiter/hiring-activity/:id/log-followup-call"');
  });

  it("that router is mounted, so the path the page calls resolves", () => {
    // atsRouter is mounted at /api/ats, and this router is used at its root,
    // so "/recruiter/hiring-activity/..." becomes "/api/ats/recruiter/...".
    expect(atsRoutes).toContain("atsRouter.use(recruiterHiringRouter)");
    expect(page).toContain("/api/ats/recruiter/hiring-activity/");
    expect(page).toContain("/log-followup-call");
  });

  it("enforces row-level access like its sibling routes", () => {
    const handler = routes.slice(routes.indexOf("log-followup-call"));
    expect(handler).toContain("ensureRowAccess");
  });
});

describe("log-followup-call — writes only columns that exist", () => {
  it("every column it writes was added by migration 1009", () => {
    const handler = routes.slice(routes.indexOf("log-followup-call"));
    for (const column of CALL_COLUMNS) {
      expect(migration).toContain(column);
      expect(handler).toContain(column);
    }
  });

  it("accepts exactly the outcomes the page offers", () => {
    for (const outcome of UI_OUTCOMES) {
      expect(page).toContain(`value="${outcome}"`);
      expect(routes).toContain(`"${outcome}"`);
    }
  });

  it("rejects an outcome the page cannot produce", () => {
    // The allow-list is declared, so an arbitrary string cannot reach the UPDATE.
    expect(routes).toContain("FOLLOWUP_CALL_OUTCOMES");
    expect(routes).toMatch(/followup_call_outcome must be one of/);
  });
});

describe("log-followup-call — pending vs done matches what the page renders", () => {
  it("the page defines done as followup_call_done && !followup_required", () => {
    expect(page).toContain("row.followup_call_done && !row.followup_required");
  });

  it("a normal outcome clears followup_required, a reschedule keeps it", () => {
    const handler = routes.slice(routes.indexOf("log-followup-call"));
    expect(handler).toContain('const rescheduled = followup_call_outcome === "Rescheduled"');
    // Both branches are supplied explicitly rather than defaulted.
    expect(handler).toContain("followup_required = ?");
    expect(handler).toMatch(/rescheduled\s*\n?\s*\?\s*\[/);
  });

  it("requires a new date when the outcome is Rescheduled", () => {
    const handler = routes.slice(routes.indexOf("log-followup-call"));
    expect(handler).toMatch(/rescheduled && !followup_rescheduled_to/);
    // The page disables submit on the same condition.
    expect(page).toContain('callOutcome === "Rescheduled" && !rescheduledTo');
  });

  it("does not leave the recruiter's inbox reminder open", () => {
    const handler = routes.slice(routes.indexOf("log-followup-call"));
    expect(handler).toContain("ats_followup_reminder");
    expect(handler).toContain("is_actioned = 1");
  });
});
