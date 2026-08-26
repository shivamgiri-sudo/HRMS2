import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * checkDpdpRestriction shipped in 45b13ab1 (2026-07-20) alongside the rest of the
 * privacy-engine layer and was then imported by nothing. A grep for its name across
 * backend/src returned exactly one hit: its own definition. So an approved DPDP §13
 * restriction order blocked no employee-scoped read anywhere — the only place a
 * processing hold was honoured was the document vault, via a different helper
 * (files.routes.ts -> documentVaultAuth -> privacyHold.isHoldActive).
 *
 * These tests pin both halves of the fix: the guard's own behaviour, and the fact
 * that app.ts actually mounts it. The mount assertion is what would have caught the
 * original defect — the behavioural tests below all passed on the dead code too.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { checkDpdpRestriction } = await import("../dpdpRestrictionGuard.js");

const RESTRICTED = "11111111-2222-3333-4444-555555555555";

function app() {
  const a = express();
  a.use("/api/employees/:employeeId", checkDpdpRestriction);
  a.get("/api/employees/:employeeId", (_req, res) => { res.json({ success: true, reached: true }); });
  a.get("/api/employees/:employeeId/joining-documents", (_req, res) => { res.json({ success: true, reached: true }); });
  return a;
}

beforeEach(() => { execute.mockReset(); });

describe("checkDpdpRestriction", () => {
  it("blocks a read for an employee under an approved restriction order", async () => {
    execute.mockResolvedValue([[{ id: "withdrawal-1" }]]);
    const res = await request(app()).get(`/api/employees/${RESTRICTED}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DPDP_RESTRICTION_ACTIVE");
  });

  it("blocks the nested document routes under the same prefix", async () => {
    execute.mockResolvedValue([[{ id: "withdrawal-1" }]]);
    const res = await request(app()).get(`/api/employees/${RESTRICTED}/joining-documents`);
    expect(res.status).toBe(403);
  });

  it("passes an employee with no restriction order through", async () => {
    execute.mockResolvedValue([[]]);
    const res = await request(app()).get(`/api/employees/${RESTRICTED}`);
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
  });

  it("fails CLOSED with 503 when the restriction lookup errors", async () => {
    execute.mockRejectedValue(new Error("db down"));
    const res = await request(app()).get(`/api/employees/${RESTRICTED}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("DPDP_RESTRICTION_CHECK_FAILED");
  });

  it("does not query at all for a non-UUID segment like /bank-quality", async () => {
    const res = await request(app()).get("/api/employees/bank-quality");
    expect(res.status).toBe(200);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("the guard is actually mounted", () => {
  const APP = readFileSync(resolve(process.cwd(), "src/app.ts"), "utf8");

  it("app.ts mounts checkDpdpRestriction on the employee id prefix", () => {
    expect(APP).toMatch(
      /app\.use\("\/api\/employees\/:employeeId",\s*\w+,\s*checkDpdpRestriction\)/
    );
  });

  it("mounts it above the employee routers, so it runs before they answer", () => {
    const guard = APP.indexOf("checkDpdpRestriction)");
    const firstRouter = APP.indexOf('app.use("/api/employees", listEndpointLimiter');
    expect(guard).toBeGreaterThan(-1);
    expect(firstRouter).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstRouter);
  });

  it("runs behind requireAuth, so an anonymous probe cannot test for an order", () => {
    const line = APP.split("\n").find((l) => l.includes('app.use("/api/employees/:employeeId"'));
    expect(line).toMatch(/requireAuth/i);
  });
});
