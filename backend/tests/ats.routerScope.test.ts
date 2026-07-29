/**
 * Router-scope guard for the ATS route tree.
 *
 * `atsRouter.use(recruiterHiringRouter)` mounts that router at the root, so any
 * path-less `router.use(middleware)` inside it runs for every request reaching
 * that line — not only for its own routes. requireRole answers 403 instead of
 * calling next(), so a root-level role guard there silently made atsRouter's
 * later routes unreachable: `manager` and `ceo` were refused
 * GET /api/ats/candidates, move-stage, waiting-queue and onboarding-bridge,
 * with a 403 naming roles that belong to a different route.
 *
 * This is an Express mounting subtlety that reads as correct, so it is pinned
 * with a real router rather than described in a comment.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

/** Stands in for requireRole: refuses rather than calling next(). */
const refuse = (_req: express.Request, res: express.Response) =>
  res.status(403).json({ message: "Access denied" });

describe("mounting a sub-router with root-level middleware", () => {
  it("demonstrates the bug: a path-less guard intercepts sibling routes", async () => {
    const sub = express.Router();
    sub.use(refuse); // path-less — the shape that caused the outage
    sub.get("/recruiter/thing", (_req, res) => res.json({ ok: true }));

    const parent = express.Router();
    parent.use(sub);
    parent.get("/candidates", (_req, res) => res.json({ ok: true }));

    const app = express().use("/api/ats", parent);

    // The sibling route is collateral damage.
    expect((await request(app).get("/api/ats/candidates")).status).toBe(403);
  });

  it("scoping the guard to the sub-router's own paths leaves siblings alone", async () => {
    const sub = express.Router();
    sub.use("/recruiter", refuse); // scoped — the fix
    sub.get("/recruiter/thing", (_req, res) => res.json({ ok: true }));

    const parent = express.Router();
    parent.use(sub);
    parent.get("/candidates", (_req, res) => res.json({ ok: true }));

    const app = express().use("/api/ats", parent);

    // The sub-router's own route is still guarded...
    expect((await request(app).get("/api/ats/recruiter/thing")).status).toBe(403);
    // ...and the sibling is reachable again.
    const sibling = await request(app).get("/api/ats/candidates");
    expect(sibling.status, "sibling route is still being intercepted").toBe(200);
  });

  it("the real router scopes its guards rather than applying them at the root", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync(
      new URL("../src/modules/ats/recruiter-hiring.routes.ts", import.meta.url),
      "utf8",
    );
    // A bare `use(requireAuth)` / `use(authRoles)` is the regression.
    expect(source, "guards are applied at the router root and will 403 sibling routes")
      .not.toMatch(/recruiterHiringRouter\.use\(\s*(requireAuth|authRoles)\s*\)/);
    expect(source).toMatch(/recruiterHiringRouter\.use\(\s*"\/recruiter",\s*requireAuth,\s*authRoles\s*\)/);
  });
});
