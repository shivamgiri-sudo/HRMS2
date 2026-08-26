import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * Cross-client negative testing, as a real request.
 *
 * process-scope-boundary.contract.test.ts already proves every /processes/:id handler CALLS
 * assertProcessAccess. That is a source-level property. It cannot prove that a request from
 * client A carrying client B's process id is actually refused end to end — middleware order,
 * a mis-mounted requireClientAuth, or a scope list that never reaches the handler would all
 * leave that test green and the boundary open.
 *
 * So this suite issues the request.
 *
 * It also pins the fix for the staleness hole: processIds was minted into a 7-day JWT at
 * login and never re-read, so REMOVING a process from a client_user left that client reading
 * it until the token expired. The middleware now re-binds the scope from the row it was
 * already fetching. The "revoked" case below fails against the old middleware — the token
 * still lists p-b, and nothing checked the database's narrower answer.
 */

const dbExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }));

const SECRET = "test-portal-secret-at-least-32-characters-long";
vi.mock("../../../config/env.js", () => ({ env: { PORTAL_JWT_SECRET: SECRET } }));

const { requireClientAuth } = await import("../../../middleware/requireClientAuth.js");

/** A client_user row as the middleware's single query returns it. */
function row(processIds: string[] | null, opts: { active?: number; revoked?: number } = {}) {
  return [[{
    is_active: opts.active ?? 1,
    process_ids: processIds === null ? null : JSON.stringify(processIds),
    session_revoked: opts.revoked ?? 0,
  }]];
}

function app() {
  const a = express();
  a.use("/processes", requireClientAuth);
  // Stands in for the real handlers: same guard, same source of truth.
  a.get("/processes/:id/kpis", (req, res) => {
    const scope = (req as unknown as { portalUser: { processIds: string[] } }).portalUser;
    if (!scope.processIds.includes(req.params.id)) {
      return res.status(403).json({ error: "Process not in your access list" });
    }
    return res.json({ ok: true, scope: scope.processIds });
  });
  return a;
}

const tokenFor = (processIds: string[]) =>
  jwt.sign({ clientUserId: "u-1", clientId: "c-a", processIds, role: "client", jti: "j-1" }, SECRET, { expiresIn: "7d" });

beforeEach(() => { dbExecute.mockReset(); delete process.env.PORTAL_DEMO_BYPASS; });

describe("client portal cross-client isolation (live request)", () => {
  it("refuses another client's process id even though the token is valid", async () => {
    dbExecute.mockResolvedValue(row(["p-a"]));
    const res = await request(app())
      .get("/processes/p-b/kpis")
      .set("Authorization", `Bearer ${tokenFor(["p-a"])}`);
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty("scope");
  });

  it("still serves the client's own process", async () => {
    dbExecute.mockResolvedValue(row(["p-a"]));
    const res = await request(app())
      .get("/processes/p-a/kpis")
      .set("Authorization", `Bearer ${tokenFor(["p-a"])}`);
    expect(res.status).toBe(200);
  });

  it("honours a process REVOKED after the token was minted", async () => {
    // The token still says p-b. The row no longer does. The row wins.
    dbExecute.mockResolvedValue(row(["p-a"]));
    const res = await request(app())
      .get("/processes/p-b/kpis")
      .set("Authorization", `Bearer ${tokenFor(["p-a", "p-b"])}`);
    expect(res.status).toBe(403);
  });

  it("honours a process GRANTED after the token was minted", async () => {
    dbExecute.mockResolvedValue(row(["p-a", "p-b"]));
    const res = await request(app())
      .get("/processes/p-b/kpis")
      .set("Authorization", `Bearer ${tokenFor(["p-a"])}`);
    expect(res.status).toBe(200);
  });

  it("fails closed when the scope column is unreadable, rather than trusting the token", async () => {
    // Falling back to payload.processIds here would silently restore the bug.
    dbExecute.mockResolvedValue([[{ is_active: 1, process_ids: "{not json", session_revoked: 0 }]]);
    const res = await request(app())
      .get("/processes/p-a/kpis")
      .set("Authorization", `Bearer ${tokenFor(["p-a"])}`);
    expect(res.status).toBe(503);
  });

  it("refuses a client whose scope has been emptied", async () => {
    dbExecute.mockResolvedValue(row([]));
    const res = await request(app())
      .get("/processes/p-a/kpis")
      .set("Authorization", `Bearer ${tokenFor(["p-a"])}`);
    expect(res.status).toBe(403);
  });

  it("still cuts off a deactivated account", async () => {
    dbExecute.mockResolvedValue(row(["p-a"], { active: 0 }));
    const res = await request(app())
      .get("/processes/p-a/kpis")
      .set("Authorization", `Bearer ${tokenFor(["p-a"])}`);
    expect(res.status).toBe(401);
  });

  it("still cuts off a revoked session", async () => {
    dbExecute.mockResolvedValue(row(["p-a"], { revoked: 1 }));
    const res = await request(app())
      .get("/processes/p-a/kpis")
      .set("Authorization", `Bearer ${tokenFor(["p-a"])}`);
    expect(res.status).toBe(401);
  });

  it("rejects an internal (non-client) token on a portal route", async () => {
    const internal = jwt.sign({ clientUserId: "u-1", processIds: ["p-a"], role: "admin" }, SECRET);
    const res = await request(app()).get("/processes/p-a/kpis").set("Authorization", `Bearer ${internal}`);
    expect(res.status).toBe(403);
    expect(dbExecute).not.toHaveBeenCalled();
  });
});
