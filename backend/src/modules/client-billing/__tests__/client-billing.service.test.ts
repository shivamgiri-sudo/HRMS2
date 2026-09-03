import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const conn = {
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { mintProformaNumber } = vi.hoisted(() => ({ mintProformaNumber: vi.fn() }));
vi.mock("../client-billing-numbering.service.js", () => ({
  clientBillingNumberingService: { mintProformaNumber },
}));

let clientBillingService: typeof import("../client-billing.service.js")["clientBillingService"];
beforeAll(async () => {
  ({ clientBillingService } = await import("../client-billing.service.js"));
});

beforeEach(() => {
  getConnection.mockResolvedValue(conn);
  conn.execute.mockReset();
  conn.beginTransaction.mockReset();
  conn.commit.mockReset();
  conn.rollback.mockReset();
  conn.release.mockReset();
  mintProformaNumber.mockReset();
});

/** cost_centre_master + branch_master lookup row the SELECT returns. */
function mockCostCentreLookup(overrides: Partial<{ gstType: string; stateCode: string; tallyHead: string | null; clientTallyName: string | null }> = {}) {
  conn.execute.mockResolvedValueOnce([
    [{ gstType: "Integrated", stateCode: "09", tallyHead: null, clientTallyName: null, ...overrides }],
    [],
  ]);
}

describe("createProforma", () => {
  it("rejects an empty line list before touching the database", async () => {
    await expect(
      clientBillingService.createProforma({
        costCentreId: "cc-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18", lines: [], createdBy: "u-1",
      })
    ).rejects.toThrow("At least one line item is required");
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("throws when the cost centre does not exist", async () => {
    conn.execute.mockResolvedValueOnce([[], []]);
    await expect(
      clientBillingService.createProforma({
        costCentreId: "missing", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18",
        lines: [{ particulars: "Seat charge", qty: 1, rate: 30000 }], createdBy: "u-1",
      })
    ).rejects.toThrow("cost_centre_master missing not found");
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("throws when the cost centre's branch has no GST state code", async () => {
    mockCostCentreLookup({ stateCode: null as unknown as string });
    await expect(
      clientBillingService.createProforma({
        costCentreId: "cc-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18",
        lines: [{ particulars: "Seat charge", qty: 1, rate: 30000 }], createdBy: "u-1",
      })
    ).rejects.toThrow(/no branch GST state code/);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("throws when the cost centre has an unrecognized/NULL GST type", async () => {
    mockCostCentreLookup({ gstType: null as unknown as string, stateCode: "09" });
    await expect(
      clientBillingService.createProforma({
        costCentreId: "cc-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18",
        lines: [{ particulars: "Seat charge", qty: 1, rate: 30000 }], createdBy: "u-1",
      })
    ).rejects.toMatchObject({ message: expect.stringMatching(/unrecognized GST type/), statusCode: 400 });
    expect(conn.execute).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("computes 18% IGST for an Integrated cost centre and mints/saves the proforma", async () => {
    mockCostCentreLookup({ gstType: "Integrated", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7971");
    conn.execute.mockResolvedValueOnce([{}, []]); // invoice INSERT
    conn.execute.mockResolvedValueOnce([{}, []]); // line INSERT

    const result = await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18",
      lines: [{ particulars: "OB Dedicated Seat 1", qty: 1, rate: 30000 }], createdBy: "u-1",
    });

    // Gap 3 fix: createProforma passes its own open-transaction `conn` through so the mint
    // runs on that connection instead of a separate pool-level call.
    expect(mintProformaNumber).toHaveBeenCalledWith("09", conn);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: expect.any(String), proformaNo: "PI/09/7971",
      totalAmount: 30000, igstAmount: 5400, cgstAmount: 0, sgstAmount: 0, grandTotal: 35400,
    });
  });

  it("computes 9%+9% CGST/SGST for an Intrastate cost centre", async () => {
    mockCostCentreLookup({ gstType: "Intrastate", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7972");
    conn.execute.mockResolvedValueOnce([{}, []]);
    conn.execute.mockResolvedValueOnce([{}, []]);

    const result = await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18",
      lines: [{ particulars: "Email ticket creation service", qty: 1, rate: 4678 }], createdBy: "u-1",
    });

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: expect.any(String), proformaNo: "PI/09/7972",
      totalAmount: 4678, igstAmount: 0, cgstAmount: 421.02, sgstAmount: 421.02, grandTotal: 5520.04,
    });
  });

  it("subtracts deduction lines from the taxable total", async () => {
    mockCostCentreLookup({ gstType: "Integrated", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7973");
    conn.execute.mockResolvedValueOnce([{}, []]); // invoice INSERT
    conn.execute.mockResolvedValueOnce([{}, []]); // line 1 INSERT
    conn.execute.mockResolvedValueOnce([{}, []]); // line 2 INSERT

    const result = await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18",
      lines: [
        { particulars: "Base charge", qty: 1, rate: 10000 },
        { particulars: "Waiver", qty: 1, rate: 1000, lineType: "deduction" },
      ],
      createdBy: "u-1",
    });

    expect(result.totalAmount).toBe(9000);
    expect(result.igstAmount).toBe(1620);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("skips GST entirely when applyGst is false", async () => {
    mockCostCentreLookup({ gstType: "Integrated", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7974");
    conn.execute.mockResolvedValueOnce([{}, []]);
    conn.execute.mockResolvedValueOnce([{}, []]);

    const result = await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18", applyGst: false,
      lines: [{ particulars: "Base charge", qty: 1, rate: 10000 }], createdBy: "u-1",
    });

    expect(result).toMatchObject({ igstAmount: 0, cgstAmount: 0, sgstAmount: 0, grandTotal: 10000 });
  });

  it("snapshots tally_head/client_tally_name from cost_centre_master at creation time", async () => {
    mockCostCentreLookup({
      gstType: "Integrated", stateCode: "09",
      tallyHead: "VODAFONE MOBILE SERVICES LTD. (DELHI)", clientTallyName: "Vodafone Mobile Services Ltd",
    });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7976");
    conn.execute.mockResolvedValueOnce([{}, []]); // invoice INSERT
    conn.execute.mockResolvedValueOnce([{}, []]); // line INSERT

    await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18",
      lines: [{ particulars: "Base charge", qty: 1, rate: 10000 }], createdBy: "u-1",
    });

    // Second conn.execute call is the client_invoice INSERT; its param array's last two
    // positional values are tally_head/client_tally_name per the INSERT column list.
    const insertCall = conn.execute.mock.calls[1];
    const params = insertCall[1] as unknown[];
    expect(params[params.length - 2]).toBe("VODAFONE MOBILE SERVICES LTD. (DELHI)");
    expect(params[params.length - 1]).toBe("Vodafone Mobile Services Ltd");
  });

  it("stores tally_head/client_tally_name as NULL when the cost centre has neither set", async () => {
    mockCostCentreLookup({ gstType: "Integrated", stateCode: "09" }); // tallyHead/clientTallyName default to null
    mintProformaNumber.mockResolvedValueOnce("PI/09/7977");
    conn.execute.mockResolvedValueOnce([{}, []]);
    conn.execute.mockResolvedValueOnce([{}, []]);

    await clientBillingService.createProforma({
      costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", invoiceDate: "2026-08-18",
      lines: [{ particulars: "Base charge", qty: 1, rate: 10000 }], createdBy: "u-1",
    });

    const params = conn.execute.mock.calls[1][1] as unknown[];
    expect(params[params.length - 2]).toBeNull();
    expect(params[params.length - 1]).toBeNull();
  });

  it("rolls back and releases the connection when a line insert fails", async () => {
    mockCostCentreLookup({ gstType: "Integrated", stateCode: "09" });
    mintProformaNumber.mockResolvedValueOnce("PI/09/7975");
    conn.execute.mockResolvedValueOnce([{}, []]); // invoice INSERT
    conn.execute.mockRejectedValueOnce(new Error("line insert failed")); // line INSERT fails

    await expect(
      clientBillingService.createProforma({
        costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18",
        lines: [{ particulars: "Base charge", qty: 1, rate: 10000 }], createdBy: "u-1",
      })
    ).rejects.toThrow("line insert failed");

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});
