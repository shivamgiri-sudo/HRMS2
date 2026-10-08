import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The payability guards that used to live on the secondary disbursal exporter.
 *
 * That route was retired on 2026-08-17 (see payment-export-single-path.contract.test.ts). It had
 * accumulated real controls — IFSC validation, corrupted-account classification, exclusion of
 * unroutable rows, and refusal to emit a file when nobody was payable — while enforcing none of
 * the release controls the canonical exporter has. Retiring it would have thrown those guards away
 * silently, so they are asserted here against the exporter that survives.
 *
 * These were previously covered by bank-export-corruption-guard.contract.test.ts and
 * disbursal-bank-export-ifsc.test.ts, both of which tested a route that no longer exists.
 *
 * Source-level assertions, deliberately: the handler needs a closed run, a validated run, Finance
 * sign-off and a bank-readiness reconciliation before it reaches this code, so exercising it
 * through the router costs far more setup than it proves. What matters is that the classification
 * cannot be quietly loosened.
 */
const CANONICAL = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll.routes.ts"),
  "utf8",
);
const block = (() => {
    // The payment file is now registered at both /runs/:id/neft-export and
    // /month/:month/neft-export against one handler, because a month split into several runs
    // must still produce a single bank file. Locate the handler itself, not the registration.
  const at = CANONICAL.indexOf('const neftExportHandler');
  return CANONICAL.slice(at, CANONICAL.indexOf("router.", at + 50));
})();

describe("the bank file only ever contains rows a bank can route", () => {
  it("validates IFSC against the RBI format", () => {
    // 4 letters, a literal zero at position 5, then 6 alphanumerics. The zero matters: a live
    // import wrote the letter O there on hundreds of rows (BARBOSFSMAN for BARB0SFSMAN).
    expect(block).toContain("/^[A-Z]{4}0[A-Z0-9]{6}$/");
    expect(block).toContain("IFSC_MISSING");
    expect(block).toContain("IFSC_INVALID_FORMAT");
  });

  it("rejects scientific-notation account numbers", () => {
    // Excel turns a long account number into 8.5231E+11 on export. Written to a bank file it is
    // both wrong and unrecoverable, so it must never be classified payable.
    expect(block).toContain("/[Ee][+-]/");
    expect(block).toContain("/^[0-9]{6,20}$/");
    expect(block).toContain("ACCOUNT_INVALID_FORMAT");
  });

  it("treats a missing primary account as unpayable rather than blank", () => {
    expect(block).toContain("NO_ACTIVE_PRIMARY_ACCOUNT");
  });

  it("excludes unpayable rows from the file instead of writing them with blanks", () => {
    // The original defect: an employee with no account was written into the payment file with an
    // empty account column while their net_salary still counted toward TOTAL, so the file's stated
    // total stopped matching what the bank could actually move.
    const loop = block.slice(block.indexOf("const unpayable"));
    expect(loop).toMatch(/unpayable\.push\(/);
    expect(loop).toMatch(/continue;/);
  });

  it("surfaces excluded employees rather than dropping them silently", () => {
    expect(block).toContain("EXCLUDED — NOT PAYABLE, NOT INCLUDED IN TOTAL ABOVE");
    expect(block).toContain("EXCLUDED_TOTAL");
    expect(block).toContain("X-Payroll-Excluded-Count");
  });
});

describe("it refuses to hand over a payment file with no payments in it", () => {
  it("returns 422 NO_PAYABLE_EMPLOYEES when every row is unpayable", () => {
    // Ported from the retired exporter, which had this guard while the canonical one did not.
    // Otherwise a run where everyone fails validation still yields a well-formed CSV with
    // TOTAL 0.00 — indistinguishable from a completed export.
    expect(block).toContain("NO_PAYABLE_EMPLOYEES");
    expect(block).toContain("paidEmployeeIds.length === 0");
    expect(block).toContain("422");
  });

  it("refuses BEFORE writing the TOTAL line, the hash and the export-log row", () => {
    // A refusal recorded as an export would leave an audit trail claiming a payment file was
    // released for a run where nothing was payable.
    const guardAt = block.indexOf("NO_PAYABLE_EMPLOYEES");
    const totalAt = block.indexOf("csvRows.push(`TOTAL");
    const hashAt = block.indexOf("createHash");
    const logAt = block.indexOf("payroll_register_export_log");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(totalAt);
    expect(guardAt).toBeLessThan(hashAt);
    expect(guardAt).toBeLessThan(logAt);
  });
});
