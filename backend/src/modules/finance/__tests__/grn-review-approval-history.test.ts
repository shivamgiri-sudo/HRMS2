import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Approving and rejecting a GRN must leave a trail.
 *
 * finance_approval_event was written by the billing-cycle, return and resubmit paths and by
 * imprest — but not by reviewGrn, which is the approve/reject path. GET
 * /grns/:id/approval-history reads that table and nothing else, so a GRN that went
 * submitted -> branch_head_approved -> approved showed an empty timeline while the queue told
 * reviewers "the reason is kept on the voucher's history". Only a RETURNED voucher produced any
 * rows, which is why the endpoint looked half-alive rather than dead. Confirmed against
 * production before the fix: the table held zero rows.
 *
 * Two properties are load-bearing and neither is visible from the endpoint:
 *
 *   1. The event is written on the REVIEW'S OWN connection, before its commit. Written outside
 *      the transaction it would survive a rolled-back approval and assert a transition that
 *      never happened — see setBillingCycleStatus, which commits first and then records, and is
 *      the shape this deliberately does not copy.
 *   2. actorRole records the STAGE that was cleared, not the actor's primary role. A super_admin
 *      acting at the Branch Head stage must read as branch_head, because the question a reader
 *      asks later is "which stage was passed".
 */

vi.setConfig({ testTimeout: 20_000 });

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

vi.mock("../../process-pnl/budget-consumption.service.js", () => ({
  budgetConsumptionService: {
    reserve: vi.fn(), consume: vi.fn(), release: vi.fn(), reverseConsumption: vi.fn(),
  },
}));

let grnService: typeof import("../grn.service.js")["grnService"];
beforeAll(async () => {
  ({ grnService } = await import("../grn.service.js"));
}, 120_000);

/** Records every statement in order, and when commit happened relative to them. */
function makeConnection(grn: Record<string, unknown>) {
  const statements: string[] = [];
  let commitIndex = -1;
  const conn = {
    statements,
    get commitIndex() { return commitIndex; },
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      (conn as unknown as { params: unknown[][] }).params.push(params ?? []);
      if (/SELECT \* FROM grn_request/.test(sql)) return [[grn], []];
      if (/^\s*UPDATE grn_request/.test(sql)) return [{ affectedRows: 1 }, []];
      return [[], []];
    }),
    params: [] as unknown[][],
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => { commitIndex = statements.length; }),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
  return conn;
}

const SUBMITTED = {
  id: "g1", status: "submitted", budget_line_id: "bl1",
  amount_with_tax: 5000, amount: 5000, quantity: 1, grn_type: "expense",
};

const eventIndex = (statements: string[]) =>
  statements.findIndex((s) => /INSERT INTO finance_approval_event/i.test(s));

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
});

describe("reviewGrn writes the approval history", () => {
  it("records an approval", async () => {
    const conn = makeConnection(SUBMITTED);
    getConnection.mockResolvedValue(conn);
    await grnService.reviewGrn("g1", { decision: "approved" }, "u1", "branch_head");

    const at = eventIndex(conn.statements);
    expect(at, "an approved GRN must leave a history row").toBeGreaterThan(-1);
    const params = conn.params[at];
    expect(params).toContain("grn");
    expect(params).toContain("g1");
    expect(params).toContain("approve");
    expect(params).toContain("submitted");           // from
    expect(params).toContain("branch_head_approved"); // to
  });

  it("records a rejection, with its reason", async () => {
    const conn = makeConnection(SUBMITTED);
    getConnection.mockResolvedValue(conn);
    await grnService.reviewGrn(
      "g1", { decision: "rejected", reviewNote: "Bill does not match the PO" }, "u1", "branch_head"
    );

    const at = eventIndex(conn.statements);
    expect(at).toBeGreaterThan(-1);
    expect(conn.params[at]).toContain("reject");
    expect(conn.params[at]).toContain("Bill does not match the PO");
  });

  it("writes the event inside the review's transaction, before the commit", async () => {
    // Outside it, the row would outlive a rolled-back approval and assert a transition that
    // never happened.
    const conn = makeConnection(SUBMITTED);
    getConnection.mockResolvedValue(conn);
    await grnService.reviewGrn("g1", { decision: "approved" }, "u1", "branch_head");

    const at = eventIndex(conn.statements);
    // Assert it exists before asserting where it is — otherwise -1 satisfies "before the
    // commit" and this passes vacuously when the write is missing entirely.
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(conn.commitIndex);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("records the stage that was cleared, not the actor's own role", async () => {
    // super_admin reviewing a 'submitted' GRN acts AT the Branch Head stage.
    const conn = makeConnection(SUBMITTED);
    getConnection.mockResolvedValue(conn);
    await grnService.reviewGrn("g1", { decision: "approved" }, "u-super", "super_admin");

    const params = conn.params[eventIndex(conn.statements)];
    expect(params).toContain("branch_head");
    expect(params).not.toContain("super_admin");
  });

  it("leaves no history when the review is refused", async () => {
    // A Branch Head cannot review a GRN that is already past their stage; nothing should be
    // recorded for a transition that did not occur.
    const conn = makeConnection({ ...SUBMITTED, status: "approved" });
    getConnection.mockResolvedValue(conn);
    await expect(
      grnService.reviewGrn("g1", { decision: "approved" }, "u1", "branch_head")
    ).rejects.toThrow();

    expect(eventIndex(conn.statements)).toBe(-1);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

/**
 * A review role list may only contain roles the stage resolver can actually return.
 *
 * accounts_head sat in GRN_REVIEW_ROLES and could never complete a review:
 * resolveFinanceStageRole(workflow: "grn") maps submitted -> branch_head and
 * branch_head_approved -> finance_head and returns nothing else. The role passed the gate and
 * then met "The current grn stage requires the finance_head role" — a 400 where a 403 was the
 * truth, and a grant that advertised an authority the workflow does not have.
 *
 * It is not a shut-out: accounts_head owns the PAYMENT step that follows approval.
 */
describe("GRN review roles match the stages that exist", () => {
  // This file lives beside the sources it reads, so resolve from __dirname rather than cwd.
  const srcFile = (name: string) => readFileSync(resolve(__dirname, "..", name), "utf8");
  const routes = srcFile("grn.routes.ts");
  const smart = srcFile("grn-smart.routes.ts");
  const resolver = srcFile("finance-workflow-role.ts");
  const payments = srcFile("vendor-payment.routes.ts");

  it("the GRN chain really is two stages", () => {
    // If a third stage is ever added, this test should fail and be reconsidered — not the
    // role list quietly widened to match a stage that does not exist.
    //
    // Updated 2026-08-21: the budget header workflow's Accounts Head stage was removed (owner
    // decision), so resolveFinanceStageRole's budget and grn branches collapsed into ONE shared
    // 2-stage ternary — there is no longer a separate "grn branch" to slice out.
    const expectedRoleBlock = resolver.slice(
      resolver.indexOf("const expectedRole ="),
      resolver.indexOf(";", resolver.indexOf("const expectedRole =")) + 1
    );
    expect(expectedRoleBlock).toContain('"branch_head"');
    expect(expectedRoleBlock).toContain('"finance_head"');
    expect(expectedRoleBlock).not.toContain('"accounts_head"');
  });

  it("neither review role list grants a stage the resolver cannot return", () => {
    for (const [name, source, decl] of [
      ["legacy", routes, "const GRN_REVIEW_ROLES: RoleKey[] = ["],
      ["smart", smart, "const SMART_REVIEW_ROLES = ["],
    ] as const) {
      // Sliced from the opening bracket of the ARRAY, not from the declaration: the legacy
      // list is typed `RoleKey[]`, whose own "]" would otherwise end the slice before the
      // contents and make every assertion below vacuous.
      const open = source.indexOf("[", source.indexOf(decl) + decl.length - 1);
      const list = source.slice(open, source.indexOf("]", open));
      expect(list, `${name} review roles must not include accounts_head`).not.toContain("accounts_head");
      expect(list).toContain("branch_head");
      expect(list).toContain("finance_head");
    }
  });

  it("accounts_head keeps the payment authority that is actually theirs", () => {
    // Removing them from review must not be mistaken for removing them from GRN entirely.
    expect(payments).toContain('const PAYMENT_WRITE_ROLES = ["accounts_head", "super_admin"]');
  });
});
