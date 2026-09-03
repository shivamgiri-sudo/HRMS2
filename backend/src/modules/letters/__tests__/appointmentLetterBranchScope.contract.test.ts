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
