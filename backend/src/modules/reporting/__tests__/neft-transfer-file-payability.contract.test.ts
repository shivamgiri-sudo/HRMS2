/**
 * neftTransferFile() is, per its own doc-comment, "what payroll actually generates" — the report
 * behind the "Bank Advice / Transfer Sheet" screen. Unlike its sibling bankAdvice() (same file),
 * it had no payability filter at all: every line with net_salary > 0 was emitted regardless of
 * whether it carried a usable account number or IFSC, including a scientific-notation-mangled
 * legacy account number (e.g. "3.03801E+13") that resolveAccountNumber() would pass straight into
 * the file.
 *
 * Asserted against the shipped source, matching this suite's own convention
 * (neft-export-total-integrity.test.ts): the property under test — which WHERE clauses gate the
 * query — is a property of the SQL string, not of a return value a mock could fake.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SOURCE = read("src/modules/reporting/executors/payroll.executor.ts");
const CODE = stripComments(SOURCE);

function slice(startMarker: string, endMarker: string): string {
  const start = CODE.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = CODE.indexOf(endMarker, start);
  return CODE.slice(start, end > start ? end : start + 4000);
}

const NEFT_TRANSFER_FILE = slice("export async function neftTransferFile(", "export async function payslipStatus(");

describe("neftTransferFile requires a usable, real-looking account and a routable IFSC", () => {
  it("requires either a plaintext or encrypted account number to be present", () => {
    expect(NEFT_TRANSFER_FILE).toMatch(/ebd\.account_number IS NOT NULL AND TRIM\(ebd\.account_number\) <> ''/);
    expect(NEFT_TRANSFER_FILE).toMatch(/ebd\.account_number_enc IS NOT NULL AND TRIM\(ebd\.account_number_enc\) <> ''/);
  });

  it("rejects a scientific-notation-mangled plaintext account number", () => {
    // Same corruption shape /neft-export guards against: "3.03801E+13" is a real value seen in
    // employee_bank_detail.account_number, produced by Excel round-tripping a long digit string.
    expect(NEFT_TRANSFER_FILE).toMatch(/\[Ee\]\[\+-\]/);
    expect(NEFT_TRANSFER_FILE).toMatch(/\^\[0-9\]\{6,20\}\$/);
  });

  it("requires a routable IFSC, falling back to the employees table the way pay_mod already does", () => {
    // COALESCE(ebd.ifsc_code, e.ifsc_code, ...) already exists for pay_mod's own bank-prefix
    // check below in the same function — the payability guard must use the identical fallback,
    // not a narrower one that could reject a row pay_mod would still classify.
    expect(NEFT_TRANSFER_FILE).toMatch(
      /COALESCE\(ebd\.ifsc_code, e\.ifsc_code, ''\)\)\) REGEXP '\^\[A-Z\]\{4\}0\[A-Z0-9\]\{6\}\$'/,
    );
  });

  it("excludes a row where employees.bank_account_number disagrees with employee_bank_detail (2026-08-18)", () => {
    // Was: "does not touch the separately-flagged dual-account-source disagreement" — that gap is
    // exactly what let a CONFLICT employee's real, unmasked account leave the app with only a
    // text label as the warning. bankAdvice() already excluded this; neftTransferFile() — the
    // sibling this file's own doc-comment calls "what payroll actually generates" — did not, and
    // was the higher-consequence gap of the two. Mirrors bankAdvice()'s own guard shape.
    const guardBlock = NEFT_TRANSFER_FILE.slice(
      NEFT_TRANSFER_FILE.indexOf("clauses.push(`(\n    (ebd.account_number"),
      NEFT_TRANSFER_FILE.indexOf("const base = `"),
    );
    expect(guardBlock).toMatch(
      /NOT \(\s*e\.bank_account_number IS NOT NULL AND TRIM\(e\.bank_account_number\) <> ''/,
    );
    // COLLATE utf8mb4_unicode_ci is required, not decorative — see the live-execution test
    // below. Without it this clause throws ER_CANT_AGGREGATE_2COLLATIONS on the real schema
    // on every invocation (CONVERT(...USING utf8mb4) alone resolves to the server's default
    // utf8mb4_0900_ai_ci, which collides with e.bank_account_number's explicit
    // utf8mb4_unicode_ci column collation) — a regression this same regex-only assertion
    // shipped once already, because matching the SQL text proves nothing about whether MySQL
    // can actually execute it.
    expect(guardBlock).toMatch(
      /TRIM\(e\.bank_account_number\) <> TRIM\(CONVERT\(ebd\.account_number USING utf8mb4\) COLLATE utf8mb4_unicode_ci\)/,
    );
  });

  it("still excludes draft/cancelled runs and non-positive net salary (pre-existing gates kept)", () => {
    expect(NEFT_TRANSFER_FILE).toContain("NOT IN ('draft','cancelled')");
    expect(NEFT_TRANSFER_FILE).toContain("spl.net_salary > 0");
  });
});

/**
 * Live-execution guard for the collation trap above.
 *
 * A prior version of the disagreement clause shipped with CONVERT(ebd.account_number USING
 * utf8mb4) but no explicit COLLATE, and passed the entire suite — the regex assertions above
 * only prove the SQL text looks right, never that MySQL can actually run it. On the real
 * schema (employees.bank_account_number carries an explicit utf8mb4_unicode_ci column
 * collation; the server default for a bare `USING utf8mb4` CONVERT is utf8mb4_0900_ai_ci),
 * that clause threw ER_CANT_AGGREGATE_2COLLATIONS on every single invocation — not a data-
 * dependent failure, a compile-time-equivalent one, so it broke the report for 100% of callers
 * the moment it shipped, invisibly to a mocked-DB suite. This test exists so that class of bug
 * fails CI instead of shipping again. Read-only (SELECT only) and skipped unless explicitly
 * enabled, following this repo's existing RUN_ASSESSMENT_MYSQL_TESTS convention
 * (ats-assessment/__tests__/assessment.mysql.integration.test.ts) — it needs a live DB
 * connection this harness's default mocked db does not provide.
 */
const runLiveDbTests = process.env.RUN_REPORTING_MYSQL_TESTS === "1";
const liveDbDescribe = runLiveDbTests ? describe : describe.skip;

liveDbDescribe("neftTransferFile bank-mismatch clause — live execution", () => {
  it("executes against the real schema without a collation error", async () => {
    const { db } = await import("../../../db/mysql.js");
    // Same join shape and clause the executor uses, trimmed to just this guard plus a cheap
    // LIMIT — the point is proving MySQL accepts the comparison, not re-deriving row counts.
    await expect(
      db.execute(
        `SELECT e.id
           FROM employees e
           LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id
          WHERE NOT (
            e.bank_account_number IS NOT NULL AND TRIM(e.bank_account_number) <> ''
            AND ebd.account_number IS NOT NULL AND TRIM(CONVERT(ebd.account_number USING utf8mb4) COLLATE utf8mb4_unicode_ci) <> ''
            AND TRIM(e.bank_account_number) <> TRIM(CONVERT(ebd.account_number USING utf8mb4) COLLATE utf8mb4_unicode_ci)
          )
          LIMIT 1`,
      ),
    ).resolves.not.toThrow();
  });
});
