import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Row scope on the LOB router, driven through the real middleware.
 *
 * PNL_READ_ROLES admits branch_head and process_manager, and says why in its own comment:
 * "resolveFinanceBranchScope pins a branch head to their own branch and
 * resolveFinanceProcessScope pins a process manager to their own process. Both refuse a request
 * for someone else's rather than silently ignoring the parameter."
 *
 * No route in process-lob.routes.ts called either resolver, so the promise held nowhere:
 *  - GET /portfolio took branchId straight from the query, so omitting it returned every
 *    branch's process P&L — revenue, agent salary, EBITDA, PAT — to a branch-scoped caller.
 *  - GET /commercial, /plans, /summary, /diagnostics and / took processId the same way, so one
 *    process manager could read another's rate cards, plans and delivery actuals.
 *  - GET /vendor-payment-attribution/:paymentId had no role list and no branch assertion at all,
 *    while its three siblings each assert the record's branch.
 *
 * A string test would pass the moment someone imports the resolver and forgets to await it, so
 * this drives the handlers and asserts on what the service is actually asked for.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { getPortfolio, listPlans, commercialList, vendorGet } = vi.hoisted(() => ({
  getPortfolio: vi.fn(),
  listPlans: vi.fn(),
  commercialList: vi.fn(),
  vendorGet: vi.fn(),
}));

vi.mock("../process-lob.service.js", () => ({
  processLobService: {
    getPortfolio,
    listPlans,
    listLobs: vi.fn(async () => []),
    getProcessSummary: vi.fn(async () => ({})),
    getDiagnostics: vi.fn(async () => ({})),
    saveLob: vi.fn(),
    savePlan: vi.fn(),
    listAssignments: vi.fn(async () => []),
    saveAssignment: vi.fn(),
  },
}));
vi.mock("../process-lob-commercial.service.js", () => ({
  processLobCommercialService: {
    list: commercialList,
    saveRevenueRule: vi.fn(),
    saveDeliveryActual: vi.fn(),
  },
}));
vi.mock("../vendor-payment-lob-attribution.service.js", () => ({
  vendorPaymentLobAttributionService: { get: vendorGet },
}));

/** Branch and process assignments the scope resolvers read out of the database. */
const OWN_BRANCH = "branch-A";
const OTHER_BRANCH = "branch-B";
const OWN_PROCESS = "process-A";
const OTHER_PROCESS = "process-B";

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { processLobRouter } from "../process-lob.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; req.userRoles = actor.roles; next(); });
  app.use("/pnl/lobs", processLobRouter);
  return app;
}

beforeEach(() => {
  execute.mockReset();
  // Whatever the scope resolvers ask the database, this caller owns branch-A / process-A.
  execute.mockResolvedValue([[{ branch_id: OWN_BRANCH, process_id: OWN_PROCESS, id: OWN_BRANCH }], []]);
  getPortfolio.mockReset().mockResolvedValue([]);
  listPlans.mockReset().mockResolvedValue([]);
  commercialList.mockReset().mockResolvedValue({});
  vendorGet.mockReset().mockResolvedValue({
    payment: { id: "p1", branch_id: OTHER_BRANCH },
    allocations: [],
    reconciliation: {},
  });
});

describe("GET /portfolio", () => {
  it("pins a branch_head to their own branch when they ask for none", async () => {
    const res = await request(appFor("branch_head")).get("/pnl/lobs/portfolio?period=2026-08");
    expect(res.status).toBe(200);
    // The whole defect: an absent branchId used to mean "every branch".
    expect(getPortfolio).toHaveBeenCalledWith(expect.objectContaining({ branchId: OWN_BRANCH }));
  });

  it("refuses a branch_head who names another branch", async () => {
    const res = await request(appFor("branch_head"))
      .get(`/pnl/lobs/portfolio?period=2026-08&branchId=${OTHER_BRANCH}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(getPortfolio).not.toHaveBeenCalled();
  });

  it("leaves a global finance role unrestricted", async () => {
    const res = await request(appFor("finance_head")).get("/pnl/lobs/portfolio?period=2026-08");
    expect(res.status).toBe(200);
    expect(getPortfolio).toHaveBeenCalledWith(expect.objectContaining({ branchId: undefined }));
  });
});

describe("process-scoped reads", () => {
  it("refuses a process_manager who names another process", async () => {
    const res = await request(appFor("process_manager"))
      .get(`/pnl/lobs/commercial?processId=${OTHER_PROCESS}&period=2026-08`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(commercialList).not.toHaveBeenCalled();
  });

  it("allows a process_manager their own process", async () => {
    const res = await request(appFor("process_manager"))
      .get(`/pnl/lobs/commercial?processId=${OWN_PROCESS}&period=2026-08`);
    expect(res.status).toBe(200);
    expect(commercialList).toHaveBeenCalledWith(OWN_PROCESS, "2026-08");
  });

  it("pins a process_manager listing plans without a processId", async () => {
    const res = await request(appFor("process_manager")).get("/pnl/lobs/plans?period=2026-08");
    expect(res.status).toBe(200);
    expect(listPlans).toHaveBeenCalledWith("2026-08", OWN_PROCESS);
  });
});

describe("GET /vendor-payment-attribution/:paymentId", () => {
  it("refuses a branch_head the record of another branch", async () => {
    const res = await request(appFor("branch_head")).get("/pnl/lobs/vendor-payment-attribution/p1");
    expect(res.status, "the payment belongs to branch-B; this caller owns branch-A")
      .toBeGreaterThanOrEqual(400);
  });

  it("refuses a role with no attribution grant outright", async () => {
    const res = await request(appFor("process_manager")).get("/pnl/lobs/vendor-payment-attribution/p1");
    expect(res.status).toBe(403);
    expect(vendorGet).not.toHaveBeenCalled();
  });

  it("serves a global finance role", async () => {
    const res = await request(appFor("finance_head")).get("/pnl/lobs/vendor-payment-attribution/p1");
    expect(res.status).toBe(200);
  });
});
