import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * GST export staging.
 *
 * The value of this module is entirely in whether it REFUSES to present unfilable data as
 * filing-ready. These tests drive the real check-digit routine and pin the guards that decide
 * `exception` vs `valid`, so removing one fails a test rather than silently widening what gets
 * exported.
 */
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
    query: vi.fn(),
    getConnection: vi.fn(),
  },
}));

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SERVICE = "src/modules/gst/gst-export.service.ts";

describe("GSTIN check-digit validation", () => {
  it("accepts the real MAS and IDC registrations recovered from db_bill", async () => {
    const { isValidGstin } = await import("../gst-export.service.js");
    // All four verified against the statutory modulus-36 algorithm before being trusted.
    expect(isValidGstin("09AAACM5866H1Z6")).toBe(true); // MAS — Uttar Pradesh
    expect(isValidGstin("24AAACM5866H1ZE")).toBe(true); // MAS — Gujarat
    expect(isValidGstin("08AAACM5866H1Z8")).toBe(true); // MAS — Rajasthan
    expect(isValidGstin("09AAFCM4591G1Z7")).toBe(true); // IDC — Uttar Pradesh
  });

  it("rejects a transposition that a structural regex would happily accept", async () => {
    const { isValidGstin } = await import("../gst-export.service.js");
    // Same shape, same length, correct character classes — only the check digit disagrees.
    // This is the realistic failure mode: a typo that reaches the return and mismatches the
    // customer's credit.
    expect(isValidGstin("09AAACM5866H1Z5")).toBe(false);
    expect(isValidGstin("24AAACM5866H1ZA")).toBe(false);
    // Transposed PAN digits — structurally valid, wrong entity.
    expect(isValidGstin("09AAACM5686H1Z6")).toBe(false);
  });

  it("rejects blanks and the junk values that really live in cost_centre_master", async () => {
    const { isValidGstin } = await import("../gst-export.service.js");
    for (const junk of ["", "NA", "N/A", "0", "-", null, undefined, "09AAACM5866H1Z"]) {
      expect(isValidGstin(junk as unknown)).toBe(false);
    }
  });

  it("derives the state code from the first two characters", async () => {
    const { gstinStateCode } = await import("../gst-export.service.js");
    expect(gstinStateCode("09AAACM5866H1Z6")).toBe("09");
    expect(gstinStateCode("24AAACM5866H1ZE")).toBe("24");
    expect(gstinStateCode("garbage")).toBeNull();
  });
});

describe("filing guards", () => {
  it("refuses to generate a batch without a valid supplier GSTIN", () => {
    const src = read(SERVICE);
    // A return is filed per registration. Generating one against a blank or malformed GSTIN
    // would produce a file with no filer.
    expect(src).toContain("if (!isValidGstin(companyGstin))");
    expect(src).toContain("a return is filed per registration");
  });

  it("scopes collection by the supplying branch GSTIN, not by company", () => {
    const src = read(SERVICE);
    // Two branches of one legal entity in different states file separate returns; mixing them
    // is a misdeclaration in both.
    expect(src).toContain("WHERE bm.gstin = ?");
    expect(src).toContain("DATE_FORMAT(ci.invoice_date, '%Y-%m') = ?");
  });

  it("only picks up approved invoices", () => {
    const src = read(SERVICE);
    // A proforma is not a tax invoice and creates no outward liability.
    expect(src).toContain("ci.invoice_status = 'approved'");
  });

  it("carries credit notes negative so they reduce outward liability", () => {
    const src = read(SERVICE);
    expect(src).toContain("row.taxableValue = -Math.abs(row.taxableValue)");
    expect(src).toContain("row.invoiceValue = -Math.abs(row.invoiceValue)");
  });

  it("treats NA / 0 / - in cost_centre_master as absent rather than as a GSTIN", () => {
    const src = read(SERVICE);
    expect(src).toContain("/^(NA|N\\/A|0|-|)$/i.test(rawClientGstin)");
  });

  it("flags a CGST/SGST vs IGST split that disagrees with the place of supply", () => {
    const src = read(SERVICE);
    // Tax raised in the wrong state is not fixable by a later amendment alone.
    expect(src).toContain('push("SPLIT_STATE_MISMATCH"');
    expect(src).toContain('push("TAX_SPLIT_MIXED"');
    expect(src).toContain('push("CGST_SGST_ASYMMETRIC"');
  });

  it("reconciles taxable + tax + charges + round-off against the document total", () => {
    const src = read(SERVICE);
    expect(src).toContain('push(\n      "VALUE_RECONCILIATION"');
    expect(src).toContain("MONEY_TOLERANCE");
  });

  it("writes unfilable rows as exceptions instead of dropping them", () => {
    const src = read(SERVICE);
    // A silently short return is worse than a flagged one — the preparer cannot see what is
    // missing if the row was never written.
    expect(src).toContain('blocked ? "exception" : "valid"');
    expect(src).toContain("validation_errors");
  });

  it("supersedes rather than mutates a previously generated period", () => {
    const src = read(SERVICE);
    // What was filed must stay reproducible byte-for-byte.
    expect(src).toContain("SET status = 'superseded', superseded_by_id = ?");
  });

  it("marks a batch validated only when nothing blocks", () => {
    const src = read(SERVICE);
    expect(src).toContain('exceptionRows > 0 ? "draft" : "validated"');
    expect(src).toContain("filingReady: exceptionRows === 0 && rows.length > 0");
  });
});

describe("export route guards", () => {
  const ROUTES = "src/modules/gst/gst-export.routes.ts";

  it("blocks CSV download of a batch with unresolved exceptions unless forced", () => {
    const src = read(ROUTES);
    expect(src).toContain("if (Number((batch as any).exception_rows) > 0 && !includeExceptions)");
    expect(src).toContain("res.status(409)");
  });

  it("neutralises CSV formula injection", () => {
    const src = read(ROUTES);
    expect(src).toContain("/^[=+\\-@]/.test(s)");
  });

  it("restricts generation to the roles that own filing", () => {
    const src = read(ROUTES);
    expect(src).toContain('const GST_WRITE_ROLES = ["accounts_head", "finance_head", "super_admin"]');
    expect(src).toContain("requireRole(...GST_WRITE_ROLES)");
  });

  it("is mounted on its own prefix so no path can be shadowed", () => {
    const app = read("src/app.ts");
    expect(app).toContain('app.use("/api/gst", gstExportRouter);');
  });
});
