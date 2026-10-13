import { describe, expect, it } from "vitest";
import {
  groupRejectsByReason, parseDate, parseSalesNumber, planDateCorrections, rejectInFileDuplicates, rejectMessage,
  uploadSummary, validateSalesRow, type SalesReject,
} from "../bla-bli-blu-sales-validation.js";

const good = {
  OrderID: "#BBB2484825", Date: "01-09-26", "EMP ID": "MAS61416", Emp_Name: "ARUN JOSHI", Amount: "1041",
  Campaign: "Inbound", Business: "Real Time Sales", "Payment Status": "Paid",
};

describe("parseSalesNumber (numbers stored as text)", () => {
  it.each([
    ["1,234", 1234], ["₹1,234.50", 1234.5], ["Rs. 1,234", 1234], ["INR 999", 999], ["1 234", 1234], ["1,234/-", 1234],
    [1041, 1041], ["-50", -50],
  ])("reads %s as %s", (raw, want) => {
    expect(parseSalesNumber(raw)).toEqual({ ok: true, value: want });
  });
  it.each(["", "-", "NA", "n/a", null, undefined])("reads %s as blank", (raw) => {
    expect(parseSalesNumber(raw)).toEqual({ ok: true, value: null });
  });
  it.each(["abc", "12abc", "#N/A", "1.2.3"])("refuses %s instead of storing blank", (raw) => {
    expect(parseSalesNumber(raw)).toEqual({ ok: false });
  });
});

describe("parseDate (sales date formats)", () => {
  it.each([
    ["01-09-26", "2026-09-01"], ["01-09-2026", "2026-09-01"], ["2026-09-01", "2026-09-01"], ["1-Sep-26", "2026-09-01"],
    [46235, "2026-08-01"], ["46266", "2026-09-01"], [" 03-08-2026 ", "2026-08-03"],
  ])("reads %s as %s", (raw, want) => {
    expect(parseDate(raw)).toBe(want);
  });
  it("returns null for an impossible date", () => {
    expect(parseDate("32-13-2026")).toBeNull();
    expect(parseDate("Sept first")).toBeNull();
  });
});

describe("validateSalesRow", () => {
  it("accepts a valid September row and converts numeric text", () => {
    const v = validateSalesRow({ ...good, Amount: "₹1,041", Count: "2" }, 2);
    expect(v.issues).toEqual([]);
    expect(v.record).toMatchObject({ orderId: "#BBB2484825", reportDate: "2026-09-01", amount: 1041, itemCount: 2, empCode: "MAS61416" });
  });

  it("matches header spellings case/space-insensitively (Order ID, Emp Name)", () => {
    const v = validateSalesRow({ "Order ID": "X1", date: "2026-09-02", "Emp Name": "A", Campaign: "Inbound", Business: "Real Time Sales" }, 3);
    expect(v.record).toMatchObject({ orderId: "X1", reportDate: "2026-09-02", empName: "A" });
  });

  it("rejects an invalid date with row, field, value, code, format and business category", () => {
    const v = validateSalesRow({ ...good, Date: "31-02-2026" }, 7);
    expect(v.record).toBeNull();
    expect(v.issues).toEqual([expect.objectContaining({
      row: 7, field: "Date", value: "31-02-2026", code: "INVALID_DATE", category: "business", severity: "reject",
      requiredFormat: expect.stringContaining("DD-MM-YYYY"),
    })]);
  });

  it("rejects a missing OrderID and a missing Date separately", () => {
    const v = validateSalesRow({ ...good, OrderID: " ", Date: "" }, 4);
    expect(v.record).toBeNull();
    expect(v.issues.map((i) => [i.field, i.code])).toEqual([["OrderID", "MISSING_FIELD"], ["Date", "MISSING_FIELD"]]);
  });

  it("rejects an unreadable Amount instead of silently storing NULL", () => {
    const v = validateSalesRow({ ...good, Amount: "twelve" }, 5);
    expect(v.record).toBeNull();
    expect(v.issues[0]).toMatchObject({ field: "Amount", value: "twelve", code: "INVALID_NUMBER" });
  });

  it("imports the row but warns when a secondary column is unreadable or Campaign is blank", () => {
    const v = validateSalesRow({ ...good, Campaign: "", Count: "x", "Call Date & Time": "yesterday" }, 6);
    expect(v.record).not.toBeNull();
    expect(v.record!.itemCount).toBeNull();
    expect(v.issues.every((i) => i.severity === "warning")).toBe(true);
    expect(v.issues.map((i) => i.field).sort()).toEqual(["Call Date & Time", "Campaign", "Count"]);
  });

  it("never produces a reject without a code and a non-blank reason", () => {
    const v = validateSalesRow({}, 9);
    expect(v.issues.length).toBeGreaterThan(0);
    for (const i of v.issues) { expect(i.code).toBeTruthy(); expect(i.reason.trim()).not.toBe(""); }
  });
});

describe("rejectInFileDuplicates", () => {
  it("keeps the last row of a repeated OrderID and rejects the earlier ones", () => {
    const r = rejectInFileDuplicates([
      { row: 1, orderId: "A" }, { row: 2, orderId: "B" }, { row: 3, orderId: "A" }, { row: 4, orderId: "A" },
    ]);
    expect(r.map((x) => x.row)).toEqual([1, 3]);
    expect(r[0]).toMatchObject({ code: "DUPLICATE_KEY", field: "OrderID", value: "A", category: "business", severity: "reject" });
    expect(r[0].reason).toContain("row 4");
  });
});

describe("uploadSummary (Upload Success %)", () => {
  it("is Accepted / Total x 100 and Rejection % = Rejected / Total x 100", () => {
    expect(uploadSummary(200, 150, 50)).toEqual({ totalRows: 200, acceptedRows: 150, rejectedRows: 50, successPct: 75, rejectionPct: 25 });
    expect(uploadSummary(3, 2, 1)).toMatchObject({ successPct: 66.67, rejectionPct: 33.33 });
  });
  it("is 0 for an empty file, not NaN", () => {
    expect(uploadSummary(0, 0, 0)).toMatchObject({ successPct: 0, rejectionPct: 0 });
  });
});

describe("groupRejectsByReason and rejectMessage", () => {
  const rej = (row: number, code: SalesReject["code"], severity: SalesReject["severity"] = "reject"): SalesReject =>
    ({ row, field: "f", value: null, code, reason: "r", requiredFormat: null, category: code === "DB_ERROR" ? "technical" : "business", severity });
  it("counts rejected rows per reason, ignores warnings, and separates technical errors", () => {
    const g = groupRejectsByReason([
      rej(1, "INVALID_DATE"), rej(2, "INVALID_DATE"), rej(2, "INVALID_DATE"), rej(3, "MISSING_FIELD"), rej(4, "DB_ERROR"), rej(5, "INVALID_NUMBER", "warning"),
    ]);
    expect(g).toEqual([
      { code: "INVALID_DATE", label: "Invalid date", category: "business", rows: 2 },
      { code: "DB_ERROR", label: "Database / system error", category: "technical", rows: 1 },
      { code: "MISSING_FIELD", label: "Missing mandatory field", category: "business", rows: 1 },
    ]);
  });
  it("writes a readable sentence with code, category, field and required format", () => {
    const v = validateSalesRow({ ...good, Date: "abc" }, 2);
    expect(rejectMessage(v.issues[0])).toMatch(/^Rejected \[INVALID_DATE, business\] Date: "abc" is not a recognised date\. Required: A date/);
  });
});

describe("planDateCorrections (1-3 Aug re-import)", () => {
  it("reports existing vs uploaded per date, updates vs inserts, and variance = new - existing", () => {
    const plan = planDateCorrections(
      [
        { orderId: "A", reportDate: "2026-08-01" }, { orderId: "B", reportDate: "2026-08-01" }, { orderId: "C", reportDate: "2026-08-01" },
        { orderId: "D", reportDate: "2026-08-02" },
      ],
      new Map([["2026-08-01", 5], ["2026-08-02", 1], ["2026-08-03", 4]]),
      new Set(["A", "B", "D"]),
    );
    expect(plan).toEqual([
      { reportDate: "2026-08-01", existingCount: 5, uploadCount: 3, updatedCount: 2, insertedCount: 1, variance: -2 },
      { reportDate: "2026-08-02", existingCount: 1, uploadCount: 1, updatedCount: 1, insertedCount: 0, variance: 0 },
    ]);
  });
});
