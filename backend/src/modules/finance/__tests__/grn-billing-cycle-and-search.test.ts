import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Billing cycle status (Requirement 4) and the GRN search filters (Requirement 14).
 *
 * The invariant worth guarding is that billing_cycle_status and grn_request.status never move
 * together. `status` is the twelve-value approval and payment chain; billing_cycle_status
 * answers "is another invoice expected against this service cycle?". A monthly rental GRN can
 * be fully paid and still OPEN. The moment one UPDATE writes both, closing a billing cycle
 * starts dragging GRNs through the payment workflow, and that would be very hard to spot.
 */

const { execute, query, getConnection } = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), getConnection: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query, getConnection } }));

let grnService: typeof import("../grn.service.js")["grnService"];
beforeAll(async () => {
  ({ grnService } = await import("../grn.service.js"));
}, 120_000);

/**
 * setBillingCycleStatus now runs its UPDATE and its history row in one transaction, so its
 * statements arrive on a connection rather than on the pool. Recording both keeps the assertions
 * below indifferent to which one a given call used.
 */
const connectionExecute = vi.fn();
const connection = {
  execute: connectionExecute,
  beginTransaction: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  rollback: vi.fn(async () => {}),
  release: vi.fn(() => {}),
};

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
  connectionExecute.mockReset();
  execute.mockResolvedValue([[{ id: "g1", billing_cycle_status: null }], []]);
  connectionExecute.mockResolvedValue([[{ id: "g1", billing_cycle_status: null }], []]);
  query.mockResolvedValue([[], []]);
  getConnection.mockReset();
  getConnection.mockResolvedValue(connection);
});

function statementMatching(pattern: RegExp) {
  const calls = [...execute.mock.calls, ...query.mock.calls, ...connectionExecute.mock.calls];
  const hit = calls.find(([sql]) => pattern.test(String(sql)));
  if (!hit) throw new Error(`no statement matching ${pattern}`);
  return { sql: String(hit[0]).replace(/\s+/g, " "), params: (hit[1] ?? []) as unknown[] };
}

describe("setBillingCycleStatus", () => {
  it("writes only the billing column, never the workflow status", async () => {
    await grnService.setBillingCycleStatus("g1", "CLOSED", "u1");
    const update = statementMatching(/UPDATE grn_request/);
    expect(update.sql).toContain("billing_cycle_status = ?");
    expect(update.sql, "closing a billing cycle must not move the approval chain")
      .not.toMatch(/\bstatus\s*=/);
    expect(update.params).toContain("CLOSED");
  });

  it("accepts BOOKED, which legacy uses for Tally-posted", async () => {
    await grnService.setBillingCycleStatus("g1", "BOOKED", "u1");
    expect(statementMatching(/UPDATE grn_request/).params).toContain("BOOKED");
  });

  it("allows clearing back to unclassified", async () => {
    // Historical rows are NULL because the column postdates them, so NULL has to stay
    // reachable rather than forcing someone to guess a value.
    await grnService.setBillingCycleStatus("g1", null, "u1");
    expect(statementMatching(/UPDATE grn_request/).params).toContain(null);
  });

  it("rejects a value outside the enum instead of writing it", async () => {
    await expect(
      grnService.setBillingCycleStatus("g1", "PARTIAL" as never, "u1"),
    ).rejects.toThrow(/OPEN, BOOKED or CLOSED/i);
  });

  it("refuses a GRN that does not exist", async () => {
    // The lookup runs on the transaction's connection now, so that is the mock to script.
    connectionExecute.mockResolvedValue([[], []]);
    await expect(grnService.setBillingCycleStatus("nope", "OPEN", "u1")).rejects.toThrow(/not found/i);
  });

  it("records an approval event carrying the previous value", async () => {
    connectionExecute.mockImplementation(async (sql: string) => {
      if (/SELECT id, billing_cycle_status/.test(sql)) {
        return [[{ id: "g1", billing_cycle_status: "OPEN" }], []];
      }
      return [[], []];
    });
    await grnService.setBillingCycleStatus("g1", "CLOSED", "u1");
    const event = statementMatching(/INSERT INTO finance_approval_event/);
    expect(event.params).toContain("billing_cycle_set");
    expect(event.params, "from_status carries what it was").toContain("OPEN");
    expect(event.params, "to_status carries what it became").toContain("CLOSED");
  });
});

describe("listGrns — search filters", () => {
  const call = () => statementMatching(/FROM grn_request/);

  it("matches GRN and invoice numbers partially", async () => {
    await grnService.listGrns({ grnNumber: "08/26", invoiceNumber: "INV-77" });
    const { sql, params } = call();
    expect(sql).toContain("g.grn_number LIKE ?");
    expect(sql).toContain("g.invoice_number LIKE ?");
    expect(params).toContain("%08/26%");
    expect(params).toContain("%INV-77%");
  });

  it("filters an amount range against the gross the list column shows", async () => {
    // Filtering on a different figure from the one on screen is how "the filter is broken"
    // reports start.
    await grnService.listGrns({ amountFrom: 100000, amountTo: 500000 });
    const { sql, params } = call();
    expect(sql).toContain("COALESCE(g.amount_with_tax, g.amount) >= ?");
    expect(sql).toContain("COALESCE(g.amount_with_tax, g.amount) <= ?");
    expect(params).toEqual(expect.arrayContaining([100000, 500000]));
  });

  it("asks for historical rows with UNCLASSIFIED, which is an IS NULL", async () => {
    // Those rows are NULL because the column postdates them; a plain equality returns nothing.
    await grnService.listGrns({ billingCycleStatus: "UNCLASSIFIED" });
    const { sql } = call();
    expect(sql).toContain("g.billing_cycle_status IS NULL");
    expect(sql).not.toContain("g.billing_cycle_status = ?");
  });

  it("filters a real billing status by equality", async () => {
    await grnService.listGrns({ billingCycleStatus: "OPEN" });
    const { sql, params } = call();
    expect(sql).toContain("g.billing_cycle_status = ?");
    expect(params).toContain("OPEN");
  });

  it("falls back to bill_date when filtering by accounting period", async () => {
    // Otherwise a period filter hides every GRN raised before accounting_period existed.
    await grnService.listGrns({ accountingPeriod: "2026-08" });
    const { sql, params } = call();
    expect(sql).toContain("COALESCE(g.accounting_period, DATE_FORMAT(g.bill_date, '%Y-%m')) = ?");
    expect(params).toContain("2026-08");
  });

  it("treats multiMonth=false as a real filter, not as absent", async () => {
    await grnService.listGrns({ multiMonth: false });
    const { sql, params } = call();
    expect(sql).toContain("COALESCE(g.is_multi_month, 0) = ?");
    expect(params).toContain(0);
  });

  it("keeps placeholder count equal to parameter count across many filters", async () => {
    // A mismatch is a runtime bind error, not a compile error.
    await grnService.listGrns({
      grnNumber: "MAS", invoiceNumber: "INV", vendorId: "v1", head: "Office Rent",
      subHead: "Rent", billingCycleStatus: "OPEN", accountingPeriod: "2026-08",
      billDateFrom: "2026-08-01", billDateTo: "2026-08-31",
      amountFrom: 1, amountTo: 2, createdBy: "u1", multiMonth: true,
      branchScope: { mode: "branches", branchIds: ["b1", "b2"] },
    });
    const { sql, params } = call();
    // Counted across the whole statement, not just the WHERE: slicing to the first ORDER BY
    // truncates when a sub-select carries one, and the bind contract mysql2 enforces is
    // whole-statement anyway.
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
  });
});

describe("source contract — the two statuses stay apart", () => {
  it("no statement writes billing_cycle_status and status together", async () => {
    const src = readFileSync(new URL("../grn.service.ts", import.meta.url), "utf8");
    for (const stmt of src.split(/`/)) {
      if (!/UPDATE\s+grn_request/i.test(stmt)) continue;
      const setsBilling = /billing_cycle_status\s*=/.test(stmt);
      const setsStatus = /\bstatus\s*=\s*\?/.test(stmt);
      expect(
        setsBilling && setsStatus,
        `an UPDATE writes both billing_cycle_status and status:\n${stmt.slice(0, 200)}`,
      ).toBe(false);
    }
  });
});
