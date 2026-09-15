import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, tableExists, writeAuditLog } = vi.hoisted(() => ({
  execute: vi.fn(),
  tableExists: vi.fn(),
  writeAuditLog: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog }));

import {
  classifyInvoiceLine,
  getSeatBillingEstimate,
  importSeatBillingFromInvoice,
  isEstimateWindow,
  monthProgress,
  validateLineInput,
} from "../pnl-seat-billing.service.js";

const CCS = [
  { id: "cc-idam", cost_centre_code: "BSS/IB/Noida/647", cost_centre_name: "IDAM", branch_id: "b-noida", branch_name: "NOIDA" },
  { id: "cc-onfido", cost_centre_code: "BSS/BO/NOIDA-2/576", cost_centre_name: "Onfido", branch_id: "b-noida2", branch_name: "NOIDA-2" },
  { id: "cc-empty", cost_centre_code: "BSS/OB/Noida/999", cost_centre_name: "No billing", branch_id: "b-noida", branch_name: "NOIDA" },
];

function mockDb(options: { configured?: Record<string, unknown>[]; tableExists?: boolean } = {}) {
  execute.mockReset();
  tableExists.mockReset();
  writeAuditLog.mockReset();
  tableExists.mockImplementation(async (name: string) => (name === "pnl_seat_billing_line" ? options.tableExists ?? true : true));
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM cost_centre_master ccm") && q.includes("LEFT JOIN branch_master")) return [CCS, []];
    if (q.includes("FROM pnl_seat_billing_line") && q.includes("effective_from <= ?")) return [options.configured ?? [], []];
    if (q.includes("FROM billing_invoice_particular_snapshot p")) {
      return [[
        // IDAM: two LOBs at different rates in the latest month, plus an incentive, plus an OLDER month.
        { cost_centre_id: "cc-idam", period_code: "2026-08", bill_source_id: 1, service: "", particulars: "BVO Chat", rate: 38000, qty: 21, amount: 798000 },
        { cost_centre_id: "cc-idam", period_code: "2026-08", bill_source_id: 2, service: "", particulars: "Abandon Cart", rate: 34500, qty: 12.38, amount: 427110 },
        { cost_centre_id: "cc-idam", period_code: "2026-08", bill_source_id: 3, service: "", particulars: "R&R Incentive for Mumbai Aug 26", rate: 34250, qty: 1, amount: 34250 },
        { cost_centre_id: "cc-idam", period_code: "2026-07", bill_source_id: 4, service: "", particulars: "BVO Chat", rate: 38000, qty: 99, amount: 3762000 },
        { cost_centre_id: "cc-onfido", period_code: "2026-08", bill_source_id: 5, service: "Cart2profit (Monthly Retainer)", particulars: "Onfido FTE - 1-31st Aug-26", rate: 53653, qty: 175, amount: 9389275 },
      ], []];
    }
    return [[], []];
  });
}

beforeEach(() => vi.clearAllMocks());

describe("classifyInvoiceLine — against real Aug-26 db_bill lines", () => {
  it("reads Onfido's FTE line as seats even though the service says Monthly Retainer", () => {
    expect(classifyInvoiceLine({ service: "Cart2profit (Monthly Retainer)", particulars: "Onfido FTE - 1-31st Aug-26", rate: 53653, qty: 175, amount: 9389275 }))
      .toEqual({ kind: "seat" });
  });

  it("reads a LOB line with no seat vocabulary as seats from its shape", () => {
    expect(classifyInvoiceLine({ particulars: "BVO Chat", rate: 38000, qty: 21, amount: 798000 })).toEqual({ kind: "seat" });
    expect(classifyInvoiceLine({ particulars: "Abandon Cart", rate: 34500, qty: 12.38, amount: 427110 })).toEqual({ kind: "seat" });
  });

  it("excludes incentives, one-time charges and usage", () => {
    expect(classifyInvoiceLine({ particulars: "R&R Incentive for Mubai Aug 26", rate: 34250, qty: 1, amount: 34250 }))
      .toEqual({ kind: "excluded", reason: "incentive" });
    expect(classifyInvoiceLine({ particulars: "July CSR Incentives", rate: 105950, qty: 1, amount: 105950 }))
      .toEqual({ kind: "excluded", reason: "incentive" });
    expect(classifyInvoiceLine({ service: "Customization or Development", particulars: "Software Development Charges", rate: 1800000, qty: 1, amount: 1800000 }))
      .toEqual({ kind: "excluded", reason: "one_time" });
    expect(classifyInvoiceLine({ particulars: "Sim recharge", rate: 29702, qty: 0.06, amount: 1782 }))
      .toEqual({ kind: "excluded", reason: "usage" });
  });

  it("keeps small recurring licence charges as fixed monthly lines", () => {
    expect(classifyInvoiceLine({ particulars: "Dialer Licenses for the month of Aug-26", rate: 1000, qty: 11, amount: 11000 })).toEqual({ kind: "fixed" });
    expect(classifyInvoiceLine({ particulars: "Extra DID", rate: 100, qty: 13, amount: 1300 })).toEqual({ kind: "fixed" });
  });
});

describe("estimate window and month progress", () => {
  it("covers the current month and the one before it only", () => {
    expect(isEstimateWindow("2026-09", "2026-09-15")).toBe(true);
    expect(isEstimateWindow("2026-08", "2026-09-15")).toBe(true);
    expect(isEstimateWindow("2026-07", "2026-09-15")).toBe(false);
    expect(isEstimateWindow("2026-10", "2026-09-15")).toBe(false);
  });

  it("counts elapsed days for the open month and the whole of a closed one", () => {
    expect(monthProgress("2026-09", "2026-09-15")).toEqual({ daysInMonth: 30, daysElapsed: 15 });
    expect(monthProgress("2026-08", "2026-09-15")).toEqual({ daysInMonth: 31, daysElapsed: 31 });
    expect(monthProgress("2026-10", "2026-09-15")).toEqual({ daysInMonth: 31, daysElapsed: 0 });
  });
});

describe("getSeatBillingEstimate", () => {
  it("prices every LOB line at its own rate from the latest invoiced month, excluding incentives", async () => {
    mockDb();
    const out = await getSeatBillingEstimate("2026-09", { asOfDate: "2026-09-15" });
    const idam = out.costCentres.find((cc) => cc.costCentreId === "cc-idam")!;

    expect(idam.source).toBe("invoice");
    expect(idam.sourcePeriod).toBe("2026-08"); // not the older July line
    expect(idam.lines.map((l) => [l.lineLabel, l.rateMonthly, l.seats])).toEqual([
      ["BVO Chat", 38000, 21],
      ["Abandon Cart", 34500, 12.38],
    ]);
    expect(idam.excludedLines).toEqual([expect.objectContaining({ reason: "incentive", amount: 34250 })]);
    expect(idam.monthlyValue).toBe(1225110); // 38000*21 + 34500*12.38
    expect(idam.perDay).toBeCloseTo(1225110 / 30, 1);
    expect(idam.toDate).toBeCloseTo((1225110 / 30) * 15, 0);

    const onfido = out.costCentres.find((cc) => cc.costCentreId === "cc-onfido")!;
    expect(onfido.monthlyValue).toBe(9389275);
    expect(out.costCentres.find((cc) => cc.costCentreId === "cc-empty")!.source).toBe("none");
    expect(out.totals).toMatchObject({ costCentres: 3, fromInvoice: 2, withoutRate: 1, configured: 0 });
  });

  it("uses configured lines instead of the invoice, never both", async () => {
    mockDb({
      configured: [{
        id: "line-1", cost_centre_id: "cc-idam", line_label: "BVO Chat", line_kind: "seat",
        rate_monthly: 40000, seats: 25, monthly_amount: null, effective_from: "2026-09", effective_to: null, notes: null,
      }],
    });
    const out = await getSeatBillingEstimate("2026-09", { asOfDate: "2026-09-15" });
    const idam = out.costCentres.find((cc) => cc.costCentreId === "cc-idam")!;

    expect(idam.source).toBe("configured");
    expect(idam.lines).toHaveLength(1);
    expect(idam.monthlyValue).toBe(1000000);
    expect(idam.excludedLines).toEqual([]);
    // Onfido has no configuration, so it still falls back to its invoice.
    expect(out.costCentres.find((cc) => cc.costCentreId === "cc-onfido")!.source).toBe("invoice");
  });

  it("rejects impossible months", async () => {
    mockDb();
    await expect(getSeatBillingEstimate("2026-13")).rejects.toMatchObject({ statusCode: 400 });
    await expect(getSeatBillingEstimate("2026-00")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("still estimates from invoices when the configuration table does not exist yet", async () => {
    mockDb({ tableExists: false });
    const out = await getSeatBillingEstimate("2026-09", { asOfDate: "2026-09-15" });
    expect(out.configurationAvailable).toBe(false);
    expect(out.totals.fromInvoice).toBe(2);
  });
});

describe("configuration writes", () => {
  it("validates seat lines and fixed lines", () => {
    expect(() => validateLineInput({ lineLabel: "", rateMonthly: 1, seats: 1, effectiveFrom: "2026-09" })).toThrow(/Line name/);
    expect(() => validateLineInput({ lineLabel: "X", lineKind: "hourly", rateMonthly: 1, seats: 1, effectiveFrom: "2026-09" })).toThrow(/seat or fixed/);
    expect(() => validateLineInput({ lineLabel: "X", rateMonthly: 0, seats: 1, effectiveFrom: "2026-09" })).toThrow(/Seat rate/);
    expect(() => validateLineInput({ lineLabel: "X", rateMonthly: 1, seats: 0, effectiveFrom: "2026-09" })).toThrow(/Seats/);
    expect(() => validateLineInput({ lineLabel: "X", rateMonthly: 1, seats: 1, effectiveFrom: "2026-09", effectiveTo: "2026-08" })).toThrow(/before/);
    expect(() => validateLineInput({ lineLabel: "X", rateMonthly: 1, seats: 1, effectiveFrom: "2026-13" })).toThrow(/Effective from/);
    expect(() => validateLineInput({ lineLabel: "X", rateMonthly: 1, seats: 1, effectiveFrom: "2026-09", effectiveTo: "2026-00" })).toThrow(/Effective to/);
    expect(validateLineInput({ lineLabel: " Licences ", lineKind: "fixed", monthlyAmount: 11000, effectiveFrom: "2026-09" }))
      .toMatchObject({ lineLabel: "Licences", lineKind: "fixed", monthlyAmount: 11000, seats: 0 });
  });

  it("refuses to import on top of lines already configured for the month", async () => {
    mockDb({
      configured: [{
        id: "line-1", cost_centre_id: "cc-idam", line_label: "BVO Chat", line_kind: "seat",
        rate_monthly: 40000, seats: 25, monthly_amount: null, effective_from: "2026-09", effective_to: null, notes: null,
      }],
    });
    execute.mockImplementationOnce(async () => [[{ branch_id: "b-noida" }], []]); // getOwnCostCentreBranch
    await expect(importSeatBillingFromInvoice("cc-idam", "2026-09", "user-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns 503 rather than writing when the table has not been created", async () => {
    mockDb({ tableExists: false });
    await expect(importSeatBillingFromInvoice("cc-idam", "2026-09", "user-1")).rejects.toMatchObject({ statusCode: 503 });
  });
});
