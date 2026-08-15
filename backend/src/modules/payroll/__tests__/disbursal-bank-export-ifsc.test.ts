import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The second bank-export path (disbursal.routes.ts GET /runs/:runId/bank-export) validated
 * the ACCOUNT NUMBER but never the IFSC, so an employee with a good account and a missing or
 * malformed IFSC was written straight into a real bank payment file. The bank rejects those
 * rows and pays the rest, so the file's declared total never matched what actually moved —
 * the same defect already fixed on the canonical exporter (payroll.routes.ts
 * /runs/:id/neft-export), which validates IFSC against the RBI format and excludes failures.
 *
 * Measured live 2026-08-14 on active primary bank rows: of 12,858, 188 have no IFSC and 874
 * fail the RBI format — so the two exporters disagreed about ~1,062 employees for the same run.
 *
 * Of those 874, 514 are one recoverable typo: the letter O where RBI mandates a zero at
 * position 5 (BARBOSFSMAN for BARB0SFSMAN). They are classified separately so the exclusion
 * list is an actionable remediation list, but they are NOT auto-corrected — rewriting a bank
 * routing code at export time is a money-path change with no audit trail.
 */

const RUN_ID = "run-1";

const { query, execute } = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../shared/fieldEncryption.js", () => ({
  resolveAccountNumber: (r: any) => r.account_number ?? r.account_number_enc ?? null,
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

const { disbursalRouter: router } = await import("../disbursal.routes.js");

function app() {
  const a = express();
  a.use("/api/payroll", router);
  return a;
}

/** One payable control, then one row per failure class. */
const ROWS = [
  { employee_code: "OK1",  full_name: "Payable Person", net_salary: 1000, bank_name: "HDFC",
    account_number_legacy: "1234567890", ifsc_code: "HDFC0001234" },
  { employee_code: "NOIF", full_name: "No Ifsc",        net_salary: 2000, bank_name: "HDFC",
    account_number_legacy: "2234567890", ifsc_code: null },
  { employee_code: "OZERO",full_name: "Letter O Typo",  net_salary: 3000, bank_name: "BOB",
    account_number_legacy: "3234567890", ifsc_code: "BARBOSFSMAN" },
  { employee_code: "SHORT",full_name: "Wrong Length",   net_salary: 4000, bank_name: "PNB",
    account_number_legacy: "4234567890", ifsc_code: "20437" },
];

async function exportCsv(rows = ROWS) {
  query.mockReset(); execute.mockReset();
  query
    .mockResolvedValueOnce([[{ id: RUN_ID, run_month: "2026-04" }]])
    .mockResolvedValueOnce([rows]);
  execute.mockResolvedValue([[], []]);
  return request(app()).get(`/api/payroll/runs/${RUN_ID}/bank-export?format=generic`);
}

beforeEach(() => { query.mockReset(); execute.mockReset(); });

describe("bank-export excludes rows the bank cannot route", () => {
  it("writes only the payable employee into the payment lines", async () => {
    const res = await exportCsv();
    expect(res.status).toBe(200);
    const paymentLines = res.text.split("\r\n").filter((l) => /^\d+,/.test(l));
    expect(paymentLines).toHaveLength(1);
    expect(paymentLines[0]).toContain("OK1");
  });

  it("keeps an employee whose ONLY defect is the IFSC out of the file", async () => {
    // The exact gap: account number is fine, so the old code paid them with a broken IFSC.
    const res = await exportCsv();
    const paymentLines = res.text.split("\r\n").filter((l) => /^\d+,/.test(l));
    for (const code of ["NOIF", "OZERO", "SHORT"]) {
      expect(paymentLines.join("\n"), `${code} must not be a payment instruction`).not.toContain(code);
    }
  });

  it("names why each excluded row was excluded, distinguishing the recoverable typo", async () => {
    const res = await exportCsv();
    expect(res.text).toContain("ifsc:missing");
    expect(res.text).toContain("ifsc:looks_like_letter_O_for_zero");
    expect(res.text).toContain("ifsc:wrong_length");
  });

  it("does NOT silently repair the letter-O IFSC into a zero", async () => {
    // Auto-correcting a routing code at export time would move money on a guess.
    const res = await exportCsv();
    expect(res.text).not.toContain("BARB0SFSMAN");
  });

  it("still normalises case and padding rather than rejecting on whitespace alone", async () => {
    const res = await exportCsv([
      { employee_code: "PAD", full_name: "Padded Ifsc", net_salary: 500, bank_name: "HDFC",
        account_number_legacy: "9234567890", ifsc_code: "  hdfc0001234 " },
    ]);
    const paymentLines = res.text.split("\r\n").filter((l) => /^\d+,/.test(l));
    expect(paymentLines).toHaveLength(1);
    expect(paymentLines[0]).toContain("HDFC0001234");
  });

  it("refuses the whole export when nobody is payable, rather than emitting an empty file", async () => {
    const res = await exportCsv(ROWS.filter((r) => r.employee_code !== "OK1"));
    expect(res.status).toBe(422);
    expect(res.body.unpayableCount).toBe(3);
  });
});
