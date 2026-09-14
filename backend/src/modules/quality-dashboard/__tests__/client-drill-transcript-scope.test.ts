import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Section M RBAC audit, 2026-08-17: GET /client-drill/transcript was the one endpoint in
 * client-drill.routes.ts with no clientId scope at all. Every sibling (kpis, daily, agents,
 * fatal, scenarios, repeat) requires clientId via filters() and scopes its query on
 * q.ClientId = ?. This one took only leadId, and getClientTranscript()'s query was
 * `WHERE q.lead_id = ?` with no client predicate — any caller holding a router role
 * (process_manager, manager, qa, quality_analyst, operations_manager, none inherently
 * org-wide) could pass any leadId and read the transcript + agent name for any client's call,
 * not just their own, by guessing or enumerating lead ids.
 *
 * Fixed: clientId is now required on the route and passed into the query's WHERE.
 */

const { querySource } = vi.hoisted(() => ({ querySource: vi.fn() }));
vi.mock("../../../db/sourceDb.js", () => ({ querySource }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { clientDrillRouter } from "../client-drill.routes.js";
import { errorHandler } from "../../../middleware/errorHandler.js";

function buildApp() {
  const app = express();
  app.use("/api/quality-dashboard/client-drill", clientDrillRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  querySource.mockReset();
});

describe("GET /client-drill/transcript requires clientId", () => {
  it("refuses with 400 when clientId is missing, even with a valid leadId", async () => {
    const res = await request(buildApp()).get("/api/quality-dashboard/client-drill/transcript?leadId=lead-1");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/clientId is required/);
    expect(querySource).not.toHaveBeenCalled();
  });

  it("refuses with 400 when leadId is missing", async () => {
    const res = await request(buildApp()).get("/api/quality-dashboard/client-drill/transcript?clientId=client-1");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/leadId is required/);
  });

  it("passes clientId into the query, scoping the lookup to that client", async () => {
    querySource.mockResolvedValue([]);

    await request(buildApp()).get("/api/quality-dashboard/client-drill/transcript?leadId=lead-1&clientId=client-1");

    expect(querySource).toHaveBeenCalledTimes(1);
    const [sql, params] = querySource.mock.calls[0];
    expect(String(sql)).toMatch(/q\.lead_id = \?\s+AND q\.ClientId = \?/);
    expect(params).toEqual(["lead-1", "client-1"]);
  });

  it("returns the transcript for a leadId that belongs to the requested client", async () => {
    // Mocking querySource replaces the whole SQL round-trip, so the fixture must use the
    // query's OUTPUT column names (post-alias), not the raw db_audit column names — the SQL
    // aliases Transcribe_Text to transcript_text, but that aliasing never runs here.
    querySource.mockResolvedValue([{
      lead_id: "lead-1", date: "2026-08-01", agent_name: "Agent One",
      cq_score: 92, transcript_text: "hello",
    }]);

    const res = await request(buildApp()).get("/api/quality-dashboard/client-drill/transcript?leadId=lead-1&clientId=client-1");

    expect(res.status).toBe(200);
    expect(res.body.data.lead_id).toBe("lead-1");
    expect(res.body.data.transcript_text).toBe("hello");
  });

  it("a leadId that exists but belongs to a DIFFERENT client returns null, not another client's data", async () => {
    // The query itself carries the AND q.ClientId = ? predicate (asserted above), so a
    // mismatched clientId naturally yields no row from the real database. This asserts the
    // route/service correctly surfaces that as null rather than papering over it.
    querySource.mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/quality-dashboard/client-drill/transcript?leadId=lead-1&clientId=client-OTHER");

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
