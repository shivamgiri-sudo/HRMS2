import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Branch Head could approve another branch's imprest allocation.
 *
 * POST /allocations/:id/review admits branch_head — a branch-scoped role — and had no branch
 * check. The GET /allocations/:id/approval-history endpoint immediately below it DID have one,
 * with a comment spelling out the rule: "the allocation's own branch decides who may read its
 * history... without this a reviewer at one branch could read another branch's rejection reasons
 * by id."
 *
 * So the read was guarded and the write was not, on the same :id, in the same file. Money moves
 * on the write: approving an allocation releases float against a branch's imprest.
 *
 * Both now share one helper, so the next endpoint here inherits the rule rather than
 * reimplementing it — and the two cannot drift apart again.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { reviewAllocation } = vi.hoisted(() => ({ reviewAllocation: vi.fn() }));
vi.mock("../imprest.service.js", () => ({
  imprestService: {
    reviewAllocation,
    listManagers: vi.fn(async () => []),
    getManager: vi.fn(),
    saveManager: vi.fn(),
    listAllocations: vi.fn(async () => []),
    createAllocation: vi.fn(),
    listManagerCandidates: vi.fn(async () => []),
  },
}));
vi.mock("../imprest-ledger.service.js", () => ({
  imprestLedgerService: {
    listEntries: vi.fn(async () => []),
    getPeriodSummary: vi.fn(async () => ({})),
    getDetails: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  listFinanceApprovalEvents: vi.fn(async () => []),
  recordFinanceApprovalEvent: vi.fn(),
}));

const OWN = "branch-A";
const OTHER = "branch-B";

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { imprestRouter } from "../imprest.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; req.userRoles = actor.roles; next(); });
  app.use("/api/finance/imprest", imprestRouter);
  return app;
}

/** The allocation lives in `allocationBranch`; the caller's own employee branch is branch-A. */
let allocationBranch = OTHER;
beforeEach(() => {
  reviewAllocation.mockReset().mockResolvedValue({ id: "a1", status: "approved" });
  execute.mockReset().mockImplementation(async (sql: string) => {
    if (/FROM imprest_allocation/i.test(String(sql))) return [[{ branch_id: allocationBranch }], []];
    // Everything else is the scope resolver asking which branch this user belongs to.
    return [[{ branch_id: OWN, id: OWN }], []];
  });
  allocationBranch = OTHER;
});

describe("POST /allocations/:id/review", () => {
  it("refuses a Branch Head reviewing another branch's allocation", async () => {
    const res = await request(appFor("branch_head"))
      .post("/api/finance/imprest/allocations/a1/review")
      .send({ decision: "approve" });
    expect(res.status, "approving another branch's float must not be possible").toBe(403);
    expect(reviewAllocation, "the service must not be reached at all").not.toHaveBeenCalled();
  });

  it("allows a Branch Head reviewing their own branch's allocation", async () => {
    allocationBranch = OWN;
    const res = await request(appFor("branch_head"))
      .post("/api/finance/imprest/allocations/a1/review")
      .send({ decision: "approve" });
    expect(res.status).toBe(200);
    expect(reviewAllocation).toHaveBeenCalledOnce();
  });

  it("leaves a global finance role unrestricted", async () => {
    const res = await request(appFor("finance_head"))
      .post("/api/finance/imprest/allocations/a1/review")
      .send({ decision: "approve" });
    expect(res.status).toBe(200);
  });

  it("404s a missing allocation rather than leaking that it is out of scope", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM imprest_allocation/i.test(String(sql))) return [[], []];
      return [[{ branch_id: OWN, id: OWN }], []];
    });
    const res = await request(appFor("branch_head"))
      .post("/api/finance/imprest/allocations/nope/review")
      .send({ decision: "approve" });
    expect(res.status).toBe(404);
  });
});

describe("the read and the write agree", () => {
  it("the history read still refuses another branch", async () => {
    // It always did; this pins it while both move to a shared helper.
    const res = await request(appFor("branch_head"))
      .get("/api/finance/imprest/allocations/a1/approval-history");
    expect(res.status).toBe(403);
  });

  it("both go through the one helper, not two copies", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../imprest.routes.ts"), "utf8");
    const uses = source.match(/assertAllocationBranch\(req, req\.params\.id\)/g) ?? [];
    expect(uses.length, "the review and the history read").toBe(2);
  });
});
