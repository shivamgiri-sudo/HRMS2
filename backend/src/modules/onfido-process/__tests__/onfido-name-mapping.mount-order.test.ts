import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

/**
 * Regression test for a real routing bug caught while wiring up
 * onfido-name-mapping.routes.ts into app.ts: onfido-process-dashboard.routes.ts
 * applies router.use(requireAuth, requireOnfidoScope) to its ENTIRE router,
 * which is mounted at the broader prefix /api/onfido-process. If that router
 * is registered before /api/onfido-process/name-mapping, Express will run its
 * requireOnfidoScope guard for name-mapping requests too (since the prefix
 * still matches), even though name-mapping is a separate admin/HR capability
 * with no Onfido dashboard process-scope concept — an admin/hr caller who
 * lacks that scope would be wrongly 403'd before ever reaching the
 * name-mapping router's own gate.
 *
 * onfido-process-dashboard.routes.ts is deliberately NOT imported here — it
 * pulls in the full Onfido dashboard service, response cache, and process
 * scope resolver, none of which are relevant to this ordering question. This
 * test reproduces only the one piece of its behavior that matters: a
 * router-level middleware that can reject a request before any inner route
 * is checked, mounted at a prefix that also matches the more specific router.
 */
function buildBroadOnfidoRouterThatAlwaysRejects() {
  const router = express.Router();
  // Stands in for onfido-process-dashboard.routes.ts's own
  // router.use(requireAuth, requireOnfidoScope) — reject-everything is the
  // worst case, proving the more specific router truly runs first rather
  // than merely "usually" winning a race.
  router.use((_req, res) => {
    res.status(403).json({ success: false, message: "Outside Onfido dashboard scope" });
  });
  return router;
}

function buildNameMappingStandIn() {
  const router = express.Router();
  router.get("/", (_req, res) => {
    res.json({ success: true, data: [] });
  });
  return router;
}

describe("app.ts mount order for /api/onfido-process/name-mapping", () => {
  it("reaches the name-mapping router when it is mounted before the broader onfido-process router", async () => {
    const app = express();
    // Mirrors the fixed order in app.ts: the more specific path first.
    app.use("/api/onfido-process/name-mapping", buildNameMappingStandIn());
    app.use("/api/onfido-process", buildBroadOnfidoRouterThatAlwaysRejects());

    const res = await request(app).get("/api/onfido-process/name-mapping");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("documents the bug: mounting the broader router first would incorrectly reject name-mapping requests", async () => {
    const app = express();
    // The order this test intentionally gets wrong, to prove the bug is real
    // and not hypothetical -- do NOT copy this order into app.ts.
    app.use("/api/onfido-process", buildBroadOnfidoRouterThatAlwaysRejects());
    app.use("/api/onfido-process/name-mapping", buildNameMappingStandIn());

    const res = await request(app).get("/api/onfido-process/name-mapping");

    expect(res.status).toBe(403);
  });
});
