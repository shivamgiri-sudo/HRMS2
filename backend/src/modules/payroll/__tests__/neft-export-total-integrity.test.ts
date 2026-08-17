/**
 * The NEFT export's declared TOTAL must equal what the bank can actually pay, and the summary
 * Finance reads beforehand must agree with it.
 *
 * The export previously emitted every payable line, substituting "NOT_LINKED" where the account
 * or IFSC was missing, while still adding that employee's net_salary to TOTAL. A bank rejects
 * those rows and pays the rest, so the file's own total never matched the money that moved.
 * Measured live against the FINALIZED 2026-04 run — now the certification golden month — 143 of
 * 982 payable employees have no usable account, carrying Rs 19,37,731 of the Rs 1,76,04,080
 * declared (11.0%). On 2025-10 it is 572 employees and ~43%.
 *
 * It was never producing a wrong file in production: all 66 runs sit at
 * validation_status = 'pending' and the route refuses anything not 'validated'. That is exactly
 * why it is worth fixing now rather than after April is validated for certification.
 *
 * Three endpoints shared the defect — /neft-summary, /neft-lines and /neft-export — so all three
 * are covered here. Asserted against the shipped source: the handlers are large inline Express
 * closures with no seam to call, and the property that matters (which rows reach the total) is a
 * property of the statement and the loop, not of a return value.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Assert on code, not on the prose that necessarily quotes the old behaviour. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const ROUTES = read("src/modules/payroll/payroll.routes.ts");
const CODE = stripComments(ROUTES);

function slice(startMarker: string, endMarker: string): string {
  const start = CODE.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = CODE.indexOf(endMarker, start);
  return CODE.slice(start, end > start ? end : start + 8000);
}

const EXPORT_HANDLER = slice('router.get("/runs/:id/neft-export"', 'router.patch("/runs/:id/validate"');
const SUMMARY_HANDLER = slice('router.get("/runs/:id/neft-summary"', '"/runs/:runId/neft-lines"');

describe("only payable rows reach the declared total", () => {
  it("no longer substitutes NOT_LINKED for a missing account or IFSC", () => {
    // NOT_LINKED was the mechanism: it let an unpayable row look like a payment instruction.
    expect(EXPORT_HANDLER).not.toContain("NOT_LINKED");
  });

  it("classifies why an employee cannot be paid instead of papering over it", () => {
    expect(EXPORT_HANDLER).toContain("NO_ACTIVE_PRIMARY_ACCOUNT");
    expect(EXPORT_HANDLER).toContain("ACCOUNT_INVALID_FORMAT");
    expect(EXPORT_HANDLER).toContain("IFSC_MISSING");
    expect(EXPORT_HANDLER).toContain("IFSC_INVALID_FORMAT");
  });

  it("rejects a scientific-notation-mangled account number, not just an empty one", () => {
    // "3.03801E+13" is truthy, so `!accountNo` alone always let it through. Live case: a 2026-04
    // FINALIZED-run employee whose legacy account_number was exactly that string reached the
    // fixed total below with Rs 55,414 before this check existed.
    expect(EXPORT_HANDLER).toMatch(/SCIENTIFIC_RE\s*=\s*\/\[Ee\]\[\+-\]\//);
    expect(EXPORT_HANDLER).toMatch(/VALID_ACCT_RE\s*=\s*\/\^\[0-9\]\{6,20\}\$\//);
    // Both checks must gate the same `reason` assignment the presence check gates, not sit
    // unused elsewhere in the handler.
    const reasonBlock = EXPORT_HANDLER.slice(
      EXPORT_HANDLER.indexOf("const reason ="),
      EXPORT_HANDLER.indexOf(": null;") + 8,
    );
    expect(reasonBlock).toContain("SCIENTIFIC_RE.test(accountNo)");
    expect(reasonBlock).toContain("VALID_ACCT_RE.test(accountNo)");
  });

  it("skips unpayable rows before the total is accumulated", () => {
    // The `continue` must precede totalAmount, or the fix is cosmetic.
    const iReason = EXPORT_HANDLER.indexOf("if (reason) {");
    const iContinue = EXPORT_HANDLER.indexOf("continue;", iReason);
    const iTotal = EXPORT_HANDLER.indexOf("totalAmount += net");
    expect(iReason).toBeGreaterThan(-1);
    expect(iContinue).toBeGreaterThan(iReason);
    expect(iTotal).toBeGreaterThan(iContinue);
  });

  it("validates IFSC against the RBI format, so an unroutable value is unpayable", () => {
    expect(EXPORT_HANDLER).toMatch(/\^\[A-Z\]\{4\}0\[A-Z0-9\]\{6\}\$/);
  });
});

describe("excluded employees are surfaced, never silently dropped", () => {
  it("lists them under an explicit heading after TOTAL", () => {
    expect(EXPORT_HANDLER).toContain("EXCLUDED — NOT PAYABLE, NOT INCLUDED IN TOTAL ABOVE");
    expect(EXPORT_HANDLER).toContain("EXCLUDED_TOTAL");
  });

  it("reports counts and amounts in response headers for machine reconciliation", () => {
    for (const h of [
      "X-Payroll-Payable-Count",
      "X-Payroll-Payable-Total",
      "X-Payroll-Excluded-Count",
      "X-Payroll-Excluded-Total",
    ]) {
      expect(EXPORT_HANDLER).toContain(h);
    }
  });

  it("emits the EXCLUDED block only when there is something to report", () => {
    expect(EXPORT_HANDLER).toMatch(/if \(unpayable\.length > 0\)/);
  });
});

describe("the summary Finance reads first agrees with the file they get", () => {
  it("reports payable and unpayable net separately, not one blended total", () => {
    expect(SUMMARY_HANDLER).toContain("payable_net");
    expect(SUMMARY_HANDLER).toContain("unpayable_net");
  });

  it("uses the same payability definition as the export", () => {
    // account present AND IFSC matching the RBI format — not merely "an ifsc_code is not null",
    // which is what let the summary call an employee banked when the export could not pay them.
    expect(SUMMARY_HANDLER).toMatch(/\^\[A-Z\]\{4\}0\[A-Z0-9\]\{6\}\$/);
    expect(SUMMARY_HANDLER).toMatch(/account_number_enc/);
    expect(SUMMARY_HANDLER).not.toMatch(/ebd\.id IS NOT NULL AND ebd\.ifsc_code IS NOT NULL/);
  });

  it("also rejects a scientific-notation-mangled plaintext account, matching the export", () => {
    // Same drift class this describe block exists to prevent, for the format check specifically:
    // the export excludes "3.03801E+13"-shaped values, so the summary's is_payable must too, or
    // the preview keeps counting a row the file itself won't include.
    expect(SUMMARY_HANDLER).toMatch(/\^\[0-9\]\{6,20\}\$/);
    expect(SUMMARY_HANDLER).toMatch(/\[Ee\]\[\+-\]/);
  });

  it("reads the account columns only to test presence, never into its response", () => {
    // The summary must establish payability without becoming another place an account number
    // reaches a caller. bank-export-gating.contract.test.ts counts this site, so the claim that
    // it is a presence test rather than an export is enforced here rather than merely asserted
    // in a comment there.
    //
    // Every reference to either column must sit inside the COALESCE(...) IS NOT NULL guard, and
    // the SELECT list must be aggregates only — no per-employee row leaves this endpoint.
    const guarded = SUMMARY_HANDLER.match(
      /COALESCE\(NULLIF\(TRIM\(ebd\.account_number\), ''\),\s*NULLIF\(TRIM\(ebd\.account_number_enc\), ''\)\) IS NOT NULL/,
    );
    expect(guarded, "account columns must be read inside a presence guard").not.toBeNull();

    const legacyReads = (SUMMARY_HANDLER.match(/ebd\.account_number(?!_enc)\b/g) ?? []).length;
    const encReads = (SUMMARY_HANDLER.match(/ebd\.account_number_enc\b/g) ?? []).length;
    // 1 presence read (inside the COALESCE guard) + 3 format-check reads (a null-check plus the
    // REGEXP and NOT REGEXP tests) — all four still inside guard clauses, never in the SELECT
    // list. account_number_enc is ciphertext and can't be format-checked in SQL, so it keeps its
    // single presence read.
    expect(legacyReads, "presence + format-check reads, still guard-only").toBe(4);
    expect(encReads, "one presence read only").toBe(1);

    // No aliasing an account column out of the query.
    expect(SUMMARY_HANDLER).not.toMatch(/account_number(_enc)?\s+AS\s/i);
    expect(SUMMARY_HANDLER).not.toMatch(/resolveAccountNumber/);
  });

  it("computes payability ONCE, then reuses it, rather than repeating the predicate", () => {
    // Repetition is how the summary and the export drifted apart originally, so the property
    // worth pinning is "defined once, referenced many times" — not the alias's spelling.
    //
    // An earlier version of this test asserted toContain(") scored"), which a rename to
    // ") scoredRenamed" still satisfies as a substring. It could never fail, and a mutation run
    // proved exactly that. Asserting counts is what makes it bite.
    const definitions = SUMMARY_HANDLER.match(/AS is_payable\b/g) ?? [];
    expect(definitions, "payability must be defined exactly once").toHaveLength(1);

    const references = SUMMARY_HANDLER.match(/\bis_payable\b/g) ?? [];
    expect(references.length, "the single definition must be reused by the aggregates").toBeGreaterThanOrEqual(4);

    // The routability predicate itself must appear once, in that one definition.
    const ifscChecks = SUMMARY_HANDLER.match(/\^\[A-Z\]\{4\}0\[A-Z0-9\]\{6\}\$/g) ?? [];
    expect(ifscChecks, "the IFSC predicate must not be repeated per aggregate").toHaveLength(1);
  });
});

describe("one payment instruction per employee, on all three endpoints", () => {
  it("every bank join in this file filters to the active primary account", () => {
    // Unfiltered, the LEFT JOIN emits a row per bank record, each with the full net amount.
    // Latent rather than live today (max 1 row per employee across 12,858), but the
    // bank-change workflow exists to create the second one.
    const unfiltered = CODE.match(/LEFT JOIN employee_bank_detail ebd ON ebd\.employee_id = spl\.employee_id/g) ?? [];
    expect(unfiltered, "an unfiltered employee_bank_detail join remains").toHaveLength(0);

    const filtered = CODE.match(/LEFT JOIN employee_bank_detail ebd\s+ON ebd\.employee_id = spl\.employee_id\s+AND ebd\.active_status = 1\s+AND ebd\.is_primary = 1/g) ?? [];
    expect(filtered.length, "expected all three NEFT joins to be filtered").toBeGreaterThanOrEqual(3);
  });

  it("export and summary exclude lines the run itself marks excluded or blocked", () => {
    expect(EXPORT_HANDLER).toMatch(/NOT IN \('excluded', 'blocked'\)/);
    expect(SUMMARY_HANDLER).toMatch(/NOT IN \('excluded', 'blocked'\)/);
  });
});

describe("the shadowed second copy cannot silently become the live one", () => {
  // payroll-extended.routes.ts declares the same GET /runs/:id/neft-export and still carries the
  // old NOT_LINKED behaviour. It is unreachable only because payrollRouter is mounted first, and
  // it is deliberately NOT deleted. That makes mount order load-bearing: reorder those two lines
  // and the wrong exporter wins with no other signal.
  const APP = read("src/app.ts");
  const EXTENDED = read("src/modules/payroll/payroll-extended.routes.ts");

  it("the duplicate route still exists, so this guard is still needed", () => {
    expect(EXTENDED).toContain('"/runs/:id/neft-export"');
  });

  it("payrollRouter is mounted before payrollExtendedRouter", () => {
    const iMain = APP.indexOf("listEndpointLimiter, payrollRouter)");
    const iExtended = APP.indexOf("listEndpointLimiter, payrollExtendedRouter)");
    expect(iMain, "payrollRouter mount not found").toBeGreaterThan(-1);
    expect(iExtended, "payrollExtendedRouter mount not found").toBeGreaterThan(-1);
    expect(iMain).toBeLessThan(iExtended);
  });
});

describe("the gates that kept this latent stay in place", () => {
  it("still refuses a run that is not closed", () => {
    expect(EXPORT_HANDLER).toContain("isRunClosed(run.status)");
  });

  it("still refuses a run that is not validated", () => {
    expect(EXPORT_HANDLER).toMatch(/validation_status !== 'validated'/);
  });

  it("still refuses a branch-scoped caller rather than emitting a partial file", () => {
    // Fixed 2026-08-17 (Section M RBAC audit): the raw hasOrgWideScope trusted bare `admin`
    // membership with no scope row — see bank-export-gating.contract.test.ts. This endpoint now
    // gates on the stricter local hasExportScope() instead.
    expect(EXPORT_HANDLER).toContain("hasExportScope");
  });
});
