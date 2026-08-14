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

  it("does not touch the separately-flagged dual-account-source disagreement", () => {
    // That decision belongs to whoever reconciles employees.bank_account_number vs
    // employee_bank_detail (see ACCOUNT_SOURCE_JOIN's own comment) — this fix must not silently
    // fold that unresolved question into a payability guard scoped to ebd alone.
    const guardBlock = NEFT_TRANSFER_FILE.slice(
      NEFT_TRANSFER_FILE.indexOf("clauses.push(`(\n    (ebd.account_number"),
      NEFT_TRANSFER_FILE.indexOf("const base = `"),
    );
    expect(guardBlock).not.toContain("acct_chk");
    expect(guardBlock).not.toContain("e.bank_account_number");
  });

  it("still excludes draft/cancelled runs and non-positive net salary (pre-existing gates kept)", () => {
    expect(NEFT_TRANSFER_FILE).toContain("NOT IN ('draft','cancelled')");
    expect(NEFT_TRANSFER_FILE).toContain("spl.net_salary > 0");
  });
});
