import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The accounting-period override must be the SAME permission on both requests the GRN form makes.
 *
 * BudgetLinkedGrnForm saves a vendor GRN in two calls: POST /api/finance/grns creates the header,
 * then PUT /api/finance/grns/:id/invoice-components writes the real breakdown. Both carry
 * accountingPeriod, and each is gated by its own role list:
 *
 *   client  BudgetLinkedGrnForm.tsx canOverridePeriod   -> finance_head, accounts_head, super_admin, branch_admin
 *   PUT     grn-smart.routes.ts     canOverridePeriod   -> finance_head, accounts_head, super_admin, branch_admin
 *   POST    grn.routes.ts           periodOverrideRoles -> finance_head, accounts_head, super_admin  <-- was behind
 *
 * 139ee3b7 granted branch_admin the override on the client; 0337e3f3 aligned the PUT and named
 * the divergence in its own message, but the POST — the FIRST call of the save — was missed. So
 * the three live branch_admin accounts saw the period control enabled, picked a different month,
 * and were refused 403 before any row was written. The form showed "GRN could not be saved".
 *
 * These are three copies of one rule in three files, which is why this test reads all three.
 * Only the period override is widened here: the round-off tolerance (grn-smart.service.ts
 * isElevatedRole) and the late-invoice reason requirement (grn-smart.routes.ts isRestrictedRole,
 * which names branch_admin as RESTRICTED) are separate money controls on their own narrower lists.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));
vi.mock("../finance-access-scope.js", () => ({
  resolveFinanceBranchScopeSet: vi.fn(async () => ({ mode: "branches", branchIds: ["branch-A"] })),
  assertFinanceRecordBranch: vi.fn(async () => {}),
}));
const createDraft = vi.fn(async () => ({ id: "grn-1", grnNumber: "GRN/2026/0001" }));
vi.mock("../grn.service.js", () => ({
  grnService: new Proxy({ createDraft }, {
    get: (target: any, prop: string) => target[prop] ?? vi.fn(async () => ({})),
  }),
}));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

const { grnRouter } = await import("../grn.routes.js");

function appFor(roles: string[]) {
  actor = { id: `u-${roles.join("-")}`, role: roles[0], roles };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; next(); });
  app.use("/api/finance", grnRouter);
  return app;
}

/** A cut-off booking: a March invoice booked into February, which is what the control is for. */
const CUTOFF_BOOKING = {
  grnType: "vendor",
  branchId: "branch-A",
  vendorId: "v-1",
  budgetLineId: "bl-1",
  quantity: 1,
  unitRate: 1000,
  billDate: "2026-03-02",
  accountingPeriod: "2026-02",
  paymentTermsDays: 30,
};

const createWith = (roles: string[], body: Record<string, unknown> = CUTOFF_BOOKING) =>
  request(appFor(roles)).post("/api/finance/grns").send(body);

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[], []]);
  createDraft.mockClear();
});

describe("POST /api/finance/grns — accounting-period override", () => {
  it("lets a branch_admin book into a different accounting month", async () => {
    // The exact failing case from the screenshot. Without the fix this is 403 with
    // "Only Finance Head, Accounts Head or Super Admin may book an invoice into a
    // different accounting month", and nothing reaches the service.
    const res = await createWith(["branch_admin"]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect((createDraft.mock.calls[0] as any[])[0]).toMatchObject({ accountingPeriod: "2026-02" });
  });

  it("still lets a finance_head book into a different accounting month", async () => {
    expect((await createWith(["finance_head"])).status).toBe(201);
  });

  it("refuses a branch_head, who is not on the override list", async () => {
    // branch_head may raise GRNs (GRN_WRITE_ROLES) but has never held the period override.
    // Widening for branch_admin must not widen for everyone who can create a GRN.
    const res = await createWith(["branch_head"]);
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toMatch(/different accounting month/);
    expect(createDraft, "the refusal must happen before anything is written").not.toHaveBeenCalled();
  });

  it("refuses a plain admin, which the client never offers the control to either", async () => {
    expect((await createWith(["admin"])).status).toBe(403);
  });

  it("does not gate a booking whose accounting month equals the bill month", async () => {
    // The overwhelmingly common case: no override asked for, so no role check applies.
    const res = await createWith(["branch_head"], {
      ...CUTOFF_BOOKING, billDate: "2026-03-02", accountingPeriod: "2026-03",
    });
    expect(res.status).toBe(201);
  });

  it("does not gate a booking that omits accountingPeriod entirely", async () => {
    const rest = { ...CUTOFF_BOOKING } as Record<string, unknown>;
    delete rest.accountingPeriod;
    expect((await createWith(["branch_head"], rest)).status).toBe(201);
  });
});

describe("the three copies of the override rule stay in step", () => {
  const read = (url: string) => readFileSync(new URL(url, import.meta.url), "utf8");
  const ROLES = ["finance_head", "accounts_head", "super_admin", "branch_admin"];

  it("the create route names all four roles", () => {
    const source = read("../grn.routes.ts");
    const list = source.match(/const periodOverrideRoles = \[([^\]]*)\]/);
    expect(list, "periodOverrideRoles must stay greppable by that name").not.toBeNull();
    for (const role of ROLES) expect(list![1]).toContain(`"${role}"`);
  });

  it("the invoice-components route names the same four", () => {
    const source = read("../grn-smart.routes.ts");
    const list = source.match(/const canOverridePeriod = user\.roles\.some\([\s\S]{0,120}?\[([^\]]*)\]/);
    expect(list).not.toBeNull();
    for (const role of ROLES) expect(list![1]).toContain(`"${role}"`);
  });

  it("the form offers the control to the same four", () => {
    const form = read("../../../../../src/components/finance/grn/BudgetLinkedGrnForm.tsx");
    expect(form).toMatch(
      /const canOverridePeriod = useHasRole\("finance_head",\s*"accounts_head",\s*"super_admin",\s*"branch_admin"\)/,
    );
  });

  it("keeps branch_admin OFF the round-off and late-invoice controls", () => {
    // The two permissions 0337e3f3 deliberately did not grant. If a later change widens the
    // period list by widening a shared flag, these catch it.
    const smartService = read("../grn-smart.service.ts");
    expect(smartService).toMatch(/isElevatedRole[\s\S]{0,200}/);
    expect(smartService).not.toMatch(/isElevatedRole[^\n]*branch_admin/);
    const smartRoutes = read("../grn-smart.routes.ts");
    expect(smartRoutes).toMatch(/isRestrictedRole = \["branch_admin", "branch_head"\]/);
  });
});
