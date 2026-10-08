import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Branch Head entitled to TWO branches used to get a 500 ("does not support multi-branch
 * access yet") on Live P&L, CEO Overview and YTD. Those views take a list, so they now cover
 * both branches — and only those; asking for a third branch is still refused.
 */
const { execute, recon, ceo, ytd } = vi.hoisted(() => ({ execute: vi.fn(), recon: vi.fn(), ceo: vi.fn(), ytd: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: vi.fn().mockResolvedValue(true) }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../pnl-reconciliation.service.js", async (orig) => ({ ...(await orig<object>()), getPnlReconciliation: recon }));
vi.mock("../ceo-overview.service.js", async (orig) => ({ ...(await orig<object>()), getCeoOverview: ceo, getYtdSummary: ytd }));

const actor = { id: "u-bh", role: "branch_head", roles: ["branch_head"] };
vi.mock("../../../middleware/authMiddleware.js", async (orig) => ({
  ...(await orig<object>()),
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; req.userRoles = actor.roles; next(); },
}));
import { processPnlRouter } from "../process-pnl.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.authUser = actor; req.userRoles = actor.roles; next(); });
  a.use("/api/finance", processPnlRouter);
  return a;
}

beforeEach(() => {
  for (const f of [recon, ceo, ytd]) f.mockReset().mockResolvedValue({ ok: true });
  execute.mockReset().mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (/FROM user_assignment_scope/.test(q)) return [[{ role_key: "branch_head", scope_type: "branch", branch_id: "B1" }, { role_key: "branch_head", scope_type: "branch", branch_id: "B2" }], []];
    if (/SELECT branch_id\s+FROM employees/.test(q)) return [[{ branch_id: "B1" }], []];
    return [[], []];
  });
});

describe("multi-branch Branch Head on P&L views that take a list", () => {
  it("Live P&L covers both entitled branches", async () => {
    const res = await request(app()).get("/api/finance/pnl/reconciliation?period=2026-09");
    expect(res.status).toBe(200);
    expect([...recon.mock.calls[0][1].branchIds].sort()).toEqual(["B1", "B2"]);
  });

  it("CEO Overview and YTD cover both, and the visible branches are exactly those", async () => {
    expect((await request(app()).get("/api/finance/pnl/ceo-overview?period=2026-09")).status).toBe(200);
    expect([...ceo.mock.calls[0][1].branchIds].sort()).toEqual(["B1", "B2"]);
    expect([...ceo.mock.calls[0][1].visibleBranchIds].sort()).toEqual(["B1", "B2"]);
    expect((await request(app()).get("/api/finance/pnl/ytd-summary?upTo=2026-09")).status).toBe(200);
    expect([...ytd.mock.calls[0][1].branchIds].sort()).toEqual(["B1", "B2"]);
  });

  it("one requested branch narrows; a branch outside the grant is refused", async () => {
    await request(app()).get("/api/finance/pnl/reconciliation?period=2026-09&branchId=B2");
    expect(recon.mock.calls[0][1].branchIds).toEqual(["B2"]);
    expect((await request(app()).get("/api/finance/pnl/reconciliation?period=2026-09&branchId=B9")).status).toBe(403);
  });

  it("a single-branch view asks to choose a branch (400), not a server error", async () => {
    const res = await request(app()).get("/api/finance/pnl/daily-trend?period=2026-09");
    expect(res.status).toBe(400);
  });
});
