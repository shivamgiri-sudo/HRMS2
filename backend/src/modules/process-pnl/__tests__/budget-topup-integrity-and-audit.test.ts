import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Three things a top-up request must be true about, all of which it was not.
 *
 *  1. THE APPROVED AMOUNT IS THE APPLIED AMOUNT. The reviewer reads `requested_amount`;
 *     applyTopupToLine applies `requested_quantity`. Both arrive from the client and nothing
 *     tied them together, so a request could be approved for one figure and raise the budget
 *     by another — with the queue, the approval and the audit trail all naming the figure that
 *     was NOT applied. `requestedQuantity: 0` was the same defect at its limit: it validated,
 *     reached 'applied', and granted nothing.
 *
 *  2. IT NAMES THE MONTH IT INCREASES. A top-up carries no period of its own — it is always
 *     the parent header's period_code — and list() did not select that column, so the queue
 *     could not tell a reviewer which month's budget they were about to enlarge.
 *
 *  3. IT LEAVES A TRAIL. 1089's own schema comment names `budget_topup` as an entity_type of
 *     finance_approval_event, and nothing had ever written one. Every top-up decision in
 *     production was unaudited: two live requests, zero events.
 */

const { execute, query, getConnection } = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), getConnection: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query, getConnection } }));

const isPeriodLocked = vi.fn(async () => false);
vi.mock("../finance-period-lock.js", () => ({ isPeriodLocked }));

const { budgetTopupService } = await import("../budget-topup.service.js");

/** One active budget line: 10 units at Rs 1,000, August budget. */
const LINE = {
  id: "line-1",
  budget_id: "budget-1",
  unit_rate: 1000,
  budget_status: "active",
  branch_id: "branch-A",
  period_code: "2026-08",
};

const eventsWritten = () =>
  [...execute.mock.calls, ...query.mock.calls]
    .filter(([sql]) => /INSERT INTO finance_approval_event/i.test(String(sql)))
    .map(([, params]) => params as unknown[]);

/** Column order in the INSERT: id, entity_type, entity_id, action, from_status, to_status, ... */
const eventShape = (params: unknown[]) => ({
  entityType: params[1], entityId: params[2], action: params[3],
  fromStatus: params[4], toStatus: params[5], actorRole: params[8],
  details: params[10] ? JSON.parse(String(params[10])) : null,
});

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
  getConnection.mockReset();
  isPeriodLocked.mockReset().mockResolvedValue(false);
  execute.mockImplementation(async (sql: string) => {
    if (/FROM finance_budget_line l/i.test(String(sql))) return [[LINE], []];
    if (/FROM finance_budget_topup_request t/i.test(String(sql))) return [[{ id: "t-1" }], []];
    // Group D: create() validates every split's cost centre exists, is active, and belongs to
    // the line's branch — same lookup grn.service.ts's createUnbudgetedDraft() already applies.
    if (/FROM cost_centre_master/i.test(String(sql))) {
      return [[{ id: "cc-1", branch_id: LINE.branch_id, active_status: 1 }], []];
    }
    return [[], []];
  });
  query.mockResolvedValue([[], []]);
  // Group D: create() now inserts into finance_budget_topup_request AND
  // finance_budget_topup_request_split in one transaction, so it needs a real connection
  // instead of the bare pool. Reusing the SAME `execute` mock as the pool means any
  // test-specific execute.mockImplementation override (a different LINE shape, etc.) applies
  // identically whichever one create() happens to call through.
  getConnection.mockResolvedValue({
    execute,
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  });
});

/** Default cost-centre split always covers the whole requestedAmount/requestedQuantity (whether
 *  the defaults above or an override), so a test that only overrides requestedAmount/Quantity
 *  doesn't also have to hand-derive a matching split every time. Passing an explicit
 *  costCentreSplits override still wins (spread last). */
const create = (overrides: Record<string, unknown> = {}) => {
  const requestedAmount = (overrides as any).requestedAmount ?? 5000;
  const requestedQuantity = (overrides as any).requestedQuantity ?? 5;
  return budgetTopupService.create(
    {
      budgetLineId: "line-1",
      requestedAmount,
      requestedQuantity,
      reason: "Headcount added",
      costCentreSplits: [{ costCentreId: "cc-1", amount: requestedAmount, quantity: requestedQuantity }],
      ...overrides,
    } as any,
    "user-raiser",
    "branch_admin",
  );
};

describe("the approved amount is the amount that gets applied", () => {
  it("accepts a quantity that matches the amount at the line's unit rate", async () => {
    await expect(create()).resolves.toBeDefined();
    const insert = execute.mock.calls.find(([sql]) =>
      /INSERT INTO finance_budget_topup_request/i.test(String(sql)));
    expect(insert, "the request must actually be written").toBeTruthy();
  });

  it("refuses a quantity that does not match the amount", async () => {
    // Rs 5,000 asked for, but 50 units x Rs 1,000 = Rs 50,000 would be applied — a 10x
    // increase approved as if it were the smaller figure.
    await expect(create({ requestedQuantity: 50 })).rejects.toThrow(/disagree/i);
    expect(eventsWritten(), "nothing may be recorded for a refused request").toHaveLength(0);
  });

  it("refuses a zero quantity, which used to reach 'applied' having granted nothing", async () => {
    await expect(create({ requestedQuantity: 0 })).rejects.toThrow(/greater than zero/i);
  });

  it("refuses a line with no unit rate rather than sizing an increase it cannot size", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM finance_budget_line l/i.test(String(sql))) return [[{ ...LINE, unit_rate: 0 }], []];
      return [[], []];
    });
    await expect(create()).rejects.toThrow(/unit rate/i);
  });

  it("tolerates the client's float division on an expensive line", async () => {
    // requested_quantity is DECIMAL(18,4). On a Rs 1,20,000 unit rate the last 0.0001 of a unit
    // is worth Rs 12, so a flat +/- Rs 1 tolerance would refuse an honest request. The tolerance
    // scales with the unit rate for exactly this case.
    execute.mockImplementation(async (sql: string) => {
      if (/FROM finance_budget_line l/i.test(String(sql))) return [[{ ...LINE, unit_rate: 120000 }], []];
      if (/FROM finance_budget_topup_request t/i.test(String(sql))) return [[{ id: "t-1" }], []];
      if (/FROM cost_centre_master/i.test(String(sql))) {
        return [[{ id: "cc-1", branch_id: LINE.branch_id, active_status: 1 }], []];
      }
      return [[], []];
    });
    await expect(create({ requestedAmount: 400000, requestedQuantity: 3.3333 })).resolves.toBeDefined();
  });
});

describe("a closed month refuses the request up front", () => {
  it("refuses at raise time, not only at final approval", async () => {
    // The lock was checked only inside review()'s finance_head branch, so a request against a
    // closed month could be raised and branch-approved before dying at the last stage.
    isPeriodLocked.mockResolvedValue(true);
    await expect(create()).rejects.toThrow(/locked for P&L close/i);
  });
});

describe("the queue can name the month it is asking about", () => {
  it("selects the parent header's period_code, which the request has no copy of", async () => {
    await budgetTopupService.list({ branchId: "branch-A" });
    const listSql = String(query.mock.calls.at(-1)?.[0] ?? "").replace(/\s+/g, " ");
    expect(listSql).toContain("h.period_code");
    expect(listSql).toContain("FROM finance_budget_topup_request t");
  });
});

describe("every top-up decision leaves an event", () => {
  it("records the submission, with the period and both figures", async () => {
    await create();
    const events = eventsWritten().map(eventShape);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "budget_topup", action: "submit", fromStatus: null, toStatus: "submitted",
    });
    expect(events[0].details).toMatchObject({
      periodCode: "2026-08", requestedAmount: 5000, requestedQuantity: 5, unitRate: 1000,
    });
  });

  it("records an approval on the SAME connection as the status update", async () => {
    const connectionExecute = vi.fn(async (sql: string) => {
      if (/FROM finance_budget_topup_request t/i.test(String(sql))) {
        return [[{
          id: "t-1", status: "submitted", requested_by: "user-raiser",
          budget_line_id: "line-1", requested_amount: 5000, requested_quantity: 5,
          period_code: "2026-08",
        }], []];
      }
      return [[], []];
    });
    const connection = {
      execute: connectionExecute,
      beginTransaction: vi.fn(async () => {}), commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}), release: vi.fn(() => {}),
    };
    getConnection.mockResolvedValue(connection);

    await budgetTopupService.review("t-1", "approve", "user-reviewer", "branch_head", "ok");

    const onConnection = connectionExecute.mock.calls
      .filter(([sql]) => /INSERT INTO finance_approval_event/i.test(String(sql)));
    expect(onConnection, "an event on the pool could survive a rolled-back approval").toHaveLength(1);
    expect(eventShape(onConnection[0][1] as unknown[])).toMatchObject({
      entityType: "budget_topup", action: "approve",
      fromStatus: "submitted", toStatus: "branch_head_approved", actorRole: "branch_head",
    });
    // The event must be written before the commit, or it is not in the transaction at all.
    expect(connection.commit).toHaveBeenCalled();
    const commitOrder = connection.commit.mock.invocationCallOrder[0];
    const eventOrder = connectionExecute.mock.invocationCallOrder[
      connectionExecute.mock.calls.findIndex(([sql]) => /INSERT INTO finance_approval_event/i.test(String(sql)))
    ];
    expect(eventOrder).toBeLessThan(commitOrder);
  });
});
