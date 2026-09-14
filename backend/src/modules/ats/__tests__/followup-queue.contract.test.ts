/**
 * The recruiter follow-up call queue.
 *
 * The follow-up schema, both write endpoints and a modal had existed since
 * migration 1009, but nothing surfaced the work: the only "due" list was the
 * analytics `followupDue` aggregate, which is `followup_date BETWEEN CURDATE()
 * AND +7 DAY`. That window drops a follow-up the day after it was due. Live
 * census 2026-09-04 across 48,129 activity rows: 3 follow-ups had ever been set,
 * 0 calls had ever been logged, and one candidate sat 42 days overdue while the
 * UI showed nothing.
 *
 * These are source assertions, matching log-followup-call.contract.test.ts in
 * this directory: the suite has no live DB, and the defects being guarded are
 * "the predicate hides rows" and "the queue depends on another tab's state",
 * both of which live in the source text.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const routes = readFileSync(resolve(process.cwd(), "src/modules/ats/recruiter-hiring.routes.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/modules/ats/recruiter-hiring.service.ts"), "utf8");
const page = readFileSync(resolve(repoRoot, "src/pages/NativeATSHiringEntry.tsx"), "utf8");
const queue = readFileSync(resolve(repoRoot, "src/components/ats/FollowupQueue.tsx"), "utf8");

/** The service body of listFollowups, where the predicate lives. */
const listFollowupsBody = service.slice(service.indexOf("export async function listFollowups"));

describe("followup queue — the route resolves", () => {
  it("is declared on the recruiter hiring router", () => {
    expect(routes).toContain('recruiterHiringRouter.get("/recruiter/hiring-activity/followups"');
  });

  it("is registered BEFORE /:id, or Express matches 'followups' as an activity id", () => {
    const followups = routes.indexOf('"/recruiter/hiring-activity/followups"');
    const byId = routes.indexOf('"/recruiter/hiring-activity/:id"');
    expect(followups).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(followups).toBeLessThan(byId);
  });
});

describe("followup queue — the predicate shows work that is actually due", () => {
  it("includes overdue follow-ups, not just today and forward", () => {
    expect(listFollowupsBody).toContain("arha.followup_date <= CURDATE()");
  });

  it("does not reintroduce the forward-only BETWEEN window", () => {
    expect(listFollowupsBody).not.toContain("BETWEEN CURDATE()");
  });

  it("excludes open follow-ups that carry no date", () => {
    // persistActivity sets followup_required = 1 on a duplicate re-entry without
    // a date; such a row can never be called or cleared, so it must not queue.
    expect(listFollowupsBody).toContain("arha.followup_date IS NOT NULL");
  });

  it("computes overdue days on the server, never in the browser", () => {
    expect(listFollowupsBody).toContain("DATEDIFF(CURDATE(), arha.followup_date)");
    expect(queue).not.toContain("new Date()");
  });

  it("dates a logged call with the server's today", () => {
    expect(queue).toContain("followup_call_date: res?.serverToday");
  });

  it("is not capped at the analytics widget's hard LIMIT 50", () => {
    expect(listFollowupsBody).not.toMatch(/LIMIT\s+50/);
    expect(listFollowupsBody).toContain("LIMIT ${limit} OFFSET ${offset}");
  });
});

describe("followup queue — row scope", () => {
  it("scopes rows rather than returning the whole org to any recruiter", () => {
    expect(service).toContain("export async function buildFollowupScopeSql");
    expect(listFollowupsBody).toContain("buildFollowupScopeSql");
  });

  it("matches branches the way the analytics follow-up arm does, not by exact string", () => {
    const scopeBody = service.slice(service.indexOf("export async function buildFollowupScopeSql"));
    expect(scopeBody).toContain("LOWER(TRIM(COALESCE(arha.branch_name, '')))");
    expect(scopeBody).toContain("arha.created_by = ?");
  });

  it("falls back to the user's own rows when their branch cannot be resolved", () => {
    const scopeBody = service.slice(service.indexOf("export async function buildFollowupScopeSql"));
    expect(scopeBody).toContain("branchResolved: false");
  });
});

describe("followup queue — actions reuse the existing endpoint", () => {
  it("logs calls through log-followup-call rather than a new writer", () => {
    expect(queue).toContain("/log-followup-call");
  });

  it("sends Rescheduled only for a reschedule, with the new date", () => {
    expect(queue).toContain('followup_call_outcome: mode === "reschedule" ? "Rescheduled" : outcome');
    expect(queue).toContain('followup_rescheduled_to: mode === "reschedule" ? newDate : null');
  });

  it("never invents an outcome the server would reject", () => {
    // FOLLOWUP_CALL_OUTCOMES is the server allow-list; a "Done" value is not in it.
    expect(queue).not.toContain('followup_call_outcome: "Done"');
    for (const outcome of ["Interested", "Not Interested", "No Response", "Already Joined", "Declined Offer", "Wrong Number"]) {
      expect(queue).toContain(`"${outcome}"`);
      expect(routes).toContain(`"${outcome}"`);
    }
  });
});

describe("rapid entry — marking a follow-up while typing", () => {
  it("carries the two fields in the entry form state", () => {
    expect(page).toContain("followup_date: string;");
    expect(page).toContain("followup_note: string;");
  });

  it("clears them between candidates", () => {
    // Without this the previous candidate's follow-up date is silently attached
    // to the next person entered in the same session.
    const clear = page.slice(page.indexOf("const clearCandidateFields"));
    expect(clear.slice(0, 500)).toContain('followup_date: "", followup_note: ""');
  });

  it("tells the recruiter when the follow-up write failed", () => {
    // This path used to be console.error only, so a deliberately-set follow-up
    // could disappear with the UI still reporting a clean save.
    const save = page.slice(page.indexOf("const saveEntry"));
    expect(save).toContain("followupFailed = true");
    expect(save).toContain("Entry saved, but the follow-up could not be set");
  });

  it("lets what the recruiter typed beat the walk-in auto-reminder", () => {
    const save = page.slice(page.indexOf("const saveEntry"));
    expect(save).toContain("const followup = normalizeText(form.followup_date)");
  });
});

describe("the queue does not depend on the analytics tab", () => {
  it("renders from its own component, not the analytics payload", () => {
    expect(page).toContain('activeTab === "followups"');
    expect(page).toContain("<FollowupQueue");
  });

  it("fetches its own data", () => {
    expect(queue).toContain("/api/ats/recruiter/hiring-activity/followups");
    // It must not read the analytics payload or call the analytics endpoint —
    // that dependency is exactly what makes the old Progress-tab panel invisible.
    // (The word still appears in this file's header comment explaining why.)
    expect(queue).not.toContain("/hiring-activity/analytics");
    expect(queue).not.toContain("followupDue");
    expect(queue).not.toMatch(/\banalytics\s*[.?[]/);
  });
});
