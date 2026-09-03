import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { appointmentLetterSearchTerm } from "../appointmentLetterEligibility.service.js";

// The appointment letter screen was role-gated but not branch-gated: a branch HR
// holds the same `hr` role as a head-office HR, so the queue, the issued list and
// every per-employee action (eligibility, issue, preview, download, revoke) were
// org-wide for all of them. Each route must resolve the actor's branch scope
// through buildScopeWhereClause() — the codebase's one scope resolver — rather
// than filtering after the fact or trusting a branch id from the request.
const routes = readFileSync(
  resolve(process.cwd(), "src/modules/letters/appointmentLetter.routes.ts"),
  "utf8"
);
const service = readFileSync(
  resolve(process.cwd(), "src/modules/letters/appointmentLetterEligibility.service.ts"),
  "utf8"
);

/** The body of one route handler, from its path literal to the next router. call. */
function handler(pathLiteral: string): string {
  const start = routes.indexOf(pathLiteral);
  expect(start, `route ${pathLiteral} not found`).toBeGreaterThan(-1);
  const next = routes.indexOf("\nrouter.", start);
  return routes.slice(start, next === -1 ? undefined : next);
}

describe("Appointment letters — branch RBAC", () => {
  it("resolves scope through buildScopeWhereClause, not a request-supplied branch", () => {
    expect(routes).toContain("buildScopeWhereClause");
    // A branch id read off the request would let any HR name someone else's branch.
    expect(routes).not.toMatch(/req\.(query|body)\s*[.[]\s*["']?branch/i);
  });

  it("scopes the queue", () => {
    const h = handler('"/appointment-letters/queue"');
    expect(h).toContain("branchScope(req");
    expect(h).toContain("scopeSql");
  });

  it("scopes the issued-letter list", () => {
    const h = handler('router.get("/appointment-letters", ');
    expect(h).toContain("branchScope(req");
    expect(h).toContain("WHERE ${conds.join");
  });

  it.each([
    ['"/appointment-letters/eligibility/:employeeId"', "employeeInScope"],
    ['"/appointment-letters/:employeeId/issue"', "employeeInScope"],
    ['"/appointment-letters/preview/:employeeId"', "employeeInScope"],
    ['"/appointment-letters/:issueId/download"', "branchScope(req"],
    ['"/appointment-letters/:issueId/revoke"', "branchScope(req"],
  ])("scopes %s", (pathLiteral, guard) => {
    expect(handler(pathLiteral)).toContain(guard);
  });

  it("applies the scope inside the queue's id query, before eligibility is evaluated", () => {
    const queueFn = service.slice(service.indexOf("export async function listAppointmentLetterQueue"));
    expect(queueFn).toContain("filters.scopeSql");
    expect(queueFn).toContain("filters.scopeParams");
  });
});

describe("Appointment letters — employee search", () => {
  it("searches in SQL so it can reach past the queue's LIMIT", () => {
    const queueFn = service.slice(service.indexOf("export async function listAppointmentLetterQueue"));
    expect(queueFn).toContain("LIKE ?");
    expect(queueFn).toContain("e.employee_code LIKE ?");
  });

  it("escapes LIKE wildcards so a search box cannot widen its own result set", () => {
    expect(appointmentLetterSearchTerm("%")).toBe("%\\%%");
    expect(appointmentLetterSearchTerm("_")).toBe("%\\_%");
    expect(appointmentLetterSearchTerm("a\\b")).toBe("%a\\\\b%");
    expect(appointmentLetterSearchTerm("  Ravi  ")).toBe("%Ravi%");
  });
});

/**
 * The EPF forms do not gate the appointment letter.
 *
 * They are statutory PF paperwork on a separate track — joiningKitAssembly's
 * KIT_DOCUMENT_CODES already excludes them from the e-sign kit, so they finish
 * days or weeks after the six kit documents. Counting them in the letter's
 * document gate held every appointment letter behind paperwork the letter does
 * not depend on (RAVIKAR MISHRA, MAS63459: six of eight documents signed
 * 2026-09-02, blocked on Form 11 and Form 2 sitting at employee_review_pending).
 */
describe("Appointment letters — EPF forms are not a blocker", () => {
  const eligibility = readFileSync(
    resolve(process.cwd(), "src/modules/letters/appointmentLetterEligibility.service.ts"),
    "utf8"
  );

  it("names both EPF documents in one shared constant", () => {
    const list = eligibility.match(/EPF_DOCUMENT_CODES = \[(.*?)\]/s)?.[1] ?? "";
    expect(list).toContain('"EPF_DECLARATION"');
    expect(list).toContain('"EPF_NOMINATION_FORM2"');
  });

  it("excludes them from the mandatory-documents gate", () => {
    const gate = eligibility.slice(eligibility.indexOf("AS mandatory_total"));
    const clause = gate.slice(0, gate.indexOf(").catch("));
    expect(clause).toContain("document_code NOT IN (");
    expect(clause).toContain("...EPF_DOCUMENT_CODES");
  });

  it("excludes them from the joining-kit e-sign gate too", () => {
    const gate = eligibility.slice(eligibility.indexOf("AS signed_count"));
    const clause = gate.slice(0, gate.indexOf(").catch("));
    expect(clause).toContain("document_code NOT IN (");
    expect(clause).toContain("...EPF_DOCUMENT_CODES");
  });
});

/**
 * The BGV blocker names which checks are outstanding.
 *
 * "Background verification is in_progress, not clear" sent HR to the report to
 * work out which of seven categories was holding the letter — and the answer is
 * usually education or address, which have no automated provider and sit at
 * 'not_run' until a human marks them. On live data 196 of 198 reports read
 * education_status = 'not_run', so this was the common case, not the edge one.
 */
describe("Appointment letters — the BGV blocker is specific", () => {
  const eligibility = readFileSync(
    resolve(process.cwd(), "src/modules/letters/appointmentLetterEligibility.service.ts"),
    "utf8"
  );

  it("reads the per-category statuses, not just the verdict", () => {
    expect(eligibility).toContain("education_status");
    expect(eligibility).toContain("address_status");
    expect(eligibility).toContain("digilocker_status");
  });

  it("names the outstanding categories in the blocker reason", () => {
    expect(eligibility).toContain("outstandingBgvCategories(candidateId, report)");
    expect(eligibility).toContain("Outstanding: ${outstanding.join(\", \")}");
  });

  it("takes applicability from getApplicableChecks rather than re-deriving it", () => {
    // A second copy of "criminal only for managers, employment only for
    // non-freshers" would drift from the score denominator that uses the real one.
    // Asserted against the inputs those rules read, not against the words —
    // the helper's own comment names them while deliberately not implementing them.
    expect(eligibility).toContain("getApplicableChecks(candidateId)");
    expect(eligibility).not.toContain("candidate_onboarding_experience");
    expect(eligibility).not.toContain("bgv_requirements");
  });

  it("counts only passed/waived as done, so 'not_run' is reported outstanding", () => {
    const fn = eligibility.slice(eligibility.indexOf("async function outstandingBgvCategories"));
    expect(fn).toContain('v === "passed"');
    expect(fn).toContain('v === "waived"');
  });

  it("keeps the blocker even when applicability cannot be resolved", () => {
    const fn = eligibility.slice(eligibility.indexOf("async function outstandingBgvCategories"));
    expect(fn).toContain(".catch(() => ({ includeEmployment: false, includeCriminal: false }))");
  });
});
