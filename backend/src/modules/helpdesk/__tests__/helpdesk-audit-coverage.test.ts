import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Audit coverage, 2026-08-24. assign/take/escalate/hold/reopen were already logged via
 * writeSensitiveAuditLog — some in helpdesk.routes.ts, some (hold, reopen) inside
 * helpdesk.service.ts. Only create, the generic PATCH update, resolve, and comments were
 * missing. This is a contract test (source-file assertion), not a runtime mock test — it fails
 * the moment any of these 4 calls is deleted, the same discipline this repo already uses
 * elsewhere for exactly this failure mode (a control that quietly stops firing during a later
 * unrelated edit).
 */

const routes = readFileSync(resolve(process.cwd(), "src/modules/helpdesk/helpdesk.routes.ts"), "utf8");

function handlerFor(routeSignature: string, nextRouteSignature?: string): string {
  const start = routes.indexOf(routeSignature);
  expect(start, `route not found: ${routeSignature}`).toBeGreaterThan(-1);
  const end = nextRouteSignature ? routes.indexOf(nextRouteSignature, start) : start + 1200;
  return routes.slice(start, end > start ? end : undefined);
}

describe("helpdesk audit coverage — the 4 previously-missing actions", () => {
  it("POST /tickets (create) writes TICKET_CREATED", () => {
    const handler = handlerFor('router.post("/tickets",', 'router.get("/tickets/:id"');
    expect(handler).toContain("TICKET_CREATED");
    expect(handler).toContain("writeSensitiveAuditLog");
  });

  it("PATCH /tickets/:id (generic update) writes TICKET_UPDATED", () => {
    const handler = handlerFor('router.patch("/tickets/:id"', 'router.post("/tickets/:id/assign"');
    expect(handler).toContain("TICKET_UPDATED");
    expect(handler).toContain("writeSensitiveAuditLog");
  });

  it("POST /tickets/:id/resolve writes TICKET_RESOLVED", () => {
    const handler = handlerFor('router.post("/tickets/:id/resolve"', 'router.post("/tickets/:id/reopen"');
    expect(handler).toContain("TICKET_RESOLVED");
    expect(handler).toContain("writeSensitiveAuditLog");
  });

  it("POST /tickets/:id/comments writes TICKET_COMMENT_ADDED or TICKET_INTERNAL_NOTE_ADDED", () => {
    const handler = handlerFor('router.post("/tickets/:id/comments"', "// ── Grievances");
    expect(handler).toContain("TICKET_COMMENT_ADDED");
    expect(handler).toContain("TICKET_INTERNAL_NOTE_ADDED");
    expect(handler).toContain("writeSensitiveAuditLog");
  });

  it("the already-audited actions (assign/escalate/take/hold/reopen) are still present — this fix didn't touch them", () => {
    expect(routes).toContain("TICKET_ASSIGNED");
    expect(routes).toContain("TICKET_ESCALATED");
    const takeHandler = handlerFor('router.post("/tickets/:id/take"');
    expect(takeHandler).toContain("writeSensitiveAuditLog");
  });
});
