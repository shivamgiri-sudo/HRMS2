/**
 * Source contracts for the Bank Payment Readiness endpoints.
 *
 * These pin the properties that cannot be asserted behaviourally without mounting the router
 * against a live database, and that would be silently lost by an innocent-looking edit:
 *   - no general read endpoint can emit a full account number
 *   - the one endpoint that can is gated on org-wide scope, like every other bank-file endpoint
 *   - the remediation list never claims anyone was contacted
 *   - the classification is never persisted, so the page cannot go stale against itself
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/bank-payment-readiness.routes.ts"), "utf8");
const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/bank-payment-readiness.service.ts"), "utf8");
/**
 * The page these guards cover was BankPaymentReadiness.tsx until 8eca63c2 consolidated
 * eight payroll pages into four tab-based surfaces and folded it into
 * PaymentDisbursalCenter.tsx. The path here was never updated, so readFileSync threw at
 * import time, vitest reported the file as "0 test", and every assertion below — the
 * account-masking guards included — silently stopped running. Repointed at the surviving
 * page, which satisfies all of them.
 */
const PAGE = readFileSync(
  resolve(process.cwd(), "..", "src/pages/payroll/PaymentDisbursalCenter.tsx"), "utf8");
const BACKFILL = readFileSync(
  resolve(process.cwd(), "scripts/bank-detail-db-bill-backfill.ts"), "utf8");

/** Body of the handler registered at `path`, up to `len` chars. */
function handlerAt(source: string, path: string, len = 2500): string {
  const idx = source.indexOf(`"${path}"`);
  expect(idx, `route ${path} not found`).toBeGreaterThan(-1);
  return source.slice(idx, idx + len);
}

describe("only the payment file may emit a full account number", () => {
  it("the general read endpoints select no account column at all", () => {
    // The readiness rows come from the service, which masks before returning; the routes file
    // must not reach past it for a raw value. resolveAccountNumber appears exactly once, in
    // /payment-file.
    const occurrences = (ROUTES.match(/resolveAccountNumber\(/g) ?? []).length;
    expect(
      occurrences,
      "resolveAccountNumber must be called only by /payment-file. A new call site here means a " +
      "read endpoint can now emit an unmasked account number.",
    ).toBe(1);
    const paymentFile = handlerAt(ROUTES, "/payment-file", 4000);
    expect(paymentFile).toContain("resolveAccountNumber(");
  });

  it("the exceptions endpoint returns account_masked and has no unmasked sibling field", () => {
    const body = handlerAt(ROUTES, "/exceptions", 4000);
    expect(body).toContain("account_masked: r.account_masked");
    expect(body).not.toMatch(/account_number:\s/);
  });

  it("the service masks in classify(), so no caller can obtain the raw value from a result", () => {
    expect(SERVICE).toMatch(/account_masked:\s*input\.account_number \? maskAccount\(input\.account_number\) : null/);
    // BankReadinessResult must expose no full-value field.
    const iface = SERVICE.slice(SERVICE.indexOf("export interface BankReadinessResult"));
    const body = iface.slice(0, iface.indexOf("}"));
    expect(body).not.toMatch(/account_number\s*:/);
  });

  it("the page renders only the masked field", () => {
    expect(PAGE).toContain("{r.account_masked ?? \"—\"}");
    expect(PAGE).not.toMatch(/r\.account_number\b/);
  });
});

describe("/payment-file is gated MORE strictly than the other bank-file endpoints", () => {
  const body = handlerAt(ROUTES, "/payment-file", 9000);

  // This used to pin hasOrgWideScope(), matching the NEFT exports. It no longer does, and the
  // difference is the point. hasOrgWideScope() returns true for anyone holding `admin`
  // (scopeAccess.ts:193) before it looks at a single scope row, and production has an active
  // account holding `admin` + `branch_admin` with ZERO scope_type='all' rows — so routing the
  // full-number export through it would hand a branch administrator every bank account number
  // in the organisation, which is exactly what this router's header says must not happen.
  it("gates on hasExportScope, never hasOrgWideScope, before querying", () => {
    expect(body).toMatch(/hasExportScope\(req\.authUser!\.id\)/);
    expect(body).not.toMatch(/hasOrgWideScope\(/);
    expect(body).toContain("ORG_WIDE_REQUIRED_MSG");
  });

  it("hasExportScope demands a real scope_type='all' row and does not trust `admin`", () => {
    const from = ROUTES.slice(ROUTES.indexOf("async function hasExportScope"));
    const fn = from.slice(0, from.indexOf("\n}"));
    expect(fn).toMatch(/scope_type === "all"/);
    expect(fn).toMatch(/super_admin/);      // org-wide by definition, still allowed
    expect(fn).not.toMatch(/"admin"/);      // holding `admin` alone must never satisfy it
  });

  it("refuses to build a payment file from an uncommitted run", () => {
    expect(body).toMatch(/\["draft", "cancelled"\]/);
  });

  it("refuses to build a payment file it cannot verify", () => {
    expect(body).toMatch(/verification_source\.available/);
    expect(body).toContain("503");
  });

  it("builds its population FROM the classification rather than filtering afterwards", () => {
    // readyById is built from rows where payable === true, and a line with no entry is excluded.
    expect(body).toMatch(/report\.rows\.filter\(\(r\) => r\.payable\)/);
    expect(body).toMatch(/if \(!ready\) \{/);
  });

  it("enumerates every excluded employee instead of shipping a silently short file", () => {
    expect(body).toContain("EXCLUDED");
    expect(body).toContain("X-Payment-Excluded");
  });

  it("writes an audit row naming the excluded employees", () => {
    expect(body).toContain("BANK_PAYMENT_FILE_DOWNLOAD");
    expect(body).toContain("excluded_employee_codes");
  });
});

describe("the remediation list never asserts contact that did not happen", () => {
  const body = handlerAt(ROUTES, "/remediation-list", 3000);

  it("hard-codes contacted: false rather than deriving it", () => {
    expect(body).toMatch(/contacted:\s*false/);
    // Every occurrence must be the literal false — no derived expression, no bound variable.
    // Asserted this way rather than as a negative lookahead: /contacted:\s*(?!false)/ matches
    // "contacted: false" itself, because \s* backtracks to zero width and the lookahead then
    // sees " false". That regex passes on nothing and fails on the correct code.
    const occurrences = body.match(/contacted:[^,\n]*/g) ?? [];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const o of occurrences) expect(o.replace(/\s+/g, " ")).toBe("contacted: false");
  });

  it("says in the response that the system cannot contact these people", () => {
    expect(body).toMatch(/no way to contact them/i);
  });

  it("the page shows a literal 'no' rather than a bound value", () => {
    expect(PAGE).toContain("this page never claims an employee was contacted");
  });
});

describe("classification is computed, never persisted", () => {
  it("the overlay table is read for workflow fields only", () => {
    const idx = ROUTES.indexOf("async function loadOverlay");
    const body = ROUTES.slice(idx, idx + 800);
    expect(body).toContain("owner_user_id");
    expect(body).toContain("workflow_status");
    // A stored readiness class would let the table contradict live data.
    expect(body).not.toMatch(/readiness_class|reason_code/);
  });

  it("the migration creates no column that could hold a stale classification", () => {
    const sql = readFileSync(resolve(process.cwd(), "sql/1141_payroll_bank_exception.sql"), "utf8");
    const ddl = sql.slice(sql.indexOf("CREATE TABLE"), sql.indexOf("ENGINE=InnoDB"));
    expect(ddl).not.toMatch(/readiness_class|account_number|reason_code/);
    // Collation must be explicit — employees.id is utf8mb4_unicode_ci and the server default
    // is not, so an unqualified table dies with errno 3780 on its first join.
    expect(sql).toContain("COLLATE=utf8mb4_unicode_ci");
    // The PATCH endpoint is an upsert keyed on employee_id.
    expect(sql).toMatch(/UNIQUE KEY \w+ \(employee_id\)/);
  });

  it("the login table is auth_user — there is no `users` table in this schema", () => {
    expect(ROUTES).not.toMatch(/FROM users\b/);
    expect(ROUTES).toContain("FROM auth_user");
  });
});

describe("the verification month is chosen by confirmed receipts, not recency", () => {
  it("resolveVerificationMonth filters on SalaryReceiveStatus before ordering", () => {
    const idx = SERVICE.indexOf("export async function resolveVerificationMonth");
    const body = SERVICE.slice(idx, idx + 900);
    expect(body).toContain("SalaryReceiveStatus = 'YES'");
    expect(body).toContain("ORDER BY SalDate DESC");
    // MAX(SalDate) would pick a month whose receipts are not yet stamped and verify nobody.
    expect(body).not.toMatch(/MAX\(SalDate\)/);
  });

  it("a db_bill failure returns an unavailable source rather than throwing", () => {
    const idx = SERVICE.indexOf("export async function loadCreditedAccounts");
    // Slice to the function's own closing brace rather than a fixed character count. A
    // fixed 2200-char window silently stopped covering the catch block the moment the
    // function grew, so this test began failing on a change that did not touch it.
    const body = SERVICE.slice(idx, SERVICE.indexOf("\n}\n", idx));
    expect(body).toContain("catch (err)");
    expect(body).toMatch(/available:\s*false/);
  });
});

describe("the backfill cannot silently write unreadable ciphertext", () => {
  it("checks key parity and exits before writing anything", () => {
    const parityIdx = BACKFILL.indexOf("checkKeyParity(");
    const insertIdx = BACKFILL.indexOf("INSERT INTO employee_bank_detail");
    expect(parityIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(parityIdx, "the parity guard must precede the first write").toBeLessThan(insertIdx);
    expect(BACKFILL).toContain("REFUSING TO RUN");
  });

  it("is dry-run unless --apply is passed", () => {
    expect(BACKFILL).toMatch(/const APPLY = process\.argv\.includes\("--apply"\)/);
    expect(BACKFILL).toMatch(/if \(!APPLY\)/);
  });

  it("can never overwrite an existing bank record", () => {
    expect(BACKFILL).toContain("NOT EXISTS (SELECT 1 FROM employee_bank_detail");
    expect(BACKFILL).not.toMatch(/UPDATE employee_bank_detail/);
    expect(BACKFILL).not.toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it("accepts only confirmed receipts as evidence", () => {
    expect(BACKFILL).toContain("SalaryReceiveStatus = 'YES'");
  });

  it("writes no new plaintext account column", () => {
    expect(BACKFILL).toContain("account_number_enc");
    // The INSERT column list must not name the legacy plaintext column.
    const ins = BACKFILL.slice(BACKFILL.indexOf("INSERT INTO employee_bank_detail"));
    const cols = ins.slice(0, ins.indexOf("VALUES"));
    expect(cols).not.toMatch(/[^_]account_number[^_]/);
  });
});

describe("existing payment paths are reported, not changed", () => {
  it("the divergence helper only reads", () => {
    const idx = SERVICE.indexOf("export async function getPaymentSourceDivergence");
    const body = SERVICE.slice(idx, idx + 2500);
    expect(body).toMatch(/SELECT/);
    expect(body).not.toMatch(/UPDATE|INSERT|DELETE/);
  });

  it("names employees.bank_account_number as a signal, never a payment source", () => {
    // Two single-line phrases rather than one spanning assertion: the rule sits across a JSDoc
    // line break, so any normalisation still leaves the leading "*" of the continuation line in
    // the middle of it. Pinning the wrapped form makes this fail on a harmless reflow.
    expect(SERVICE).toContain("as a CONFLICT SIGNAL ONLY");
    expect(SERVICE).toContain("never as a payment source");
    // The payment file must read the bank record, not the frozen legacy column.
    const paymentFile = handlerAt(ROUTES, "/payment-file", 9000);
    expect(paymentFile).not.toMatch(/e\.bank_account_number/);
    expect(paymentFile).toContain("ebd.account_number_enc");
  });
});

describe("confirmation is per-account across all history, not per-month", () => {
  /**
   * SalaryReceiveStatus is stamped when receipt is confirmed, and that lags the run
   * unevenly - 2026-07 carried 1,071 confirmations against 1,371 rows while 2026-06
   * carried 1,122 of 1,432. Reading confirmation from the verification month ALONE
   * blocks an employee whose account has been receiving confirmed salary for years.
   *
   * Verification asks "has money ever demonstrably reached this account". One confirmed
   * credit answers that permanently. An employee who CHANGES bank is unaffected: the new
   * account matches no confirmed credit, stays unverified, and goes through penny-drop.
   */
  const body = (() => {
    const i = SERVICE.indexOf("export async function loadCreditedAccounts");
    return SERVICE.slice(i, SERVICE.indexOf("\n}\n", i));
  })();

  it("loads every confirmed (EmpCode, AcNo) pair, not just the verification month", () => {
    expect(body).toMatch(/SELECT DISTINCT EmpCode, AcNo/);
    const confirmedQuery = body.slice(body.indexOf("SELECT DISTINCT EmpCode, AcNo"));
    expect(confirmedQuery.slice(0, 260)).not.toMatch(/SalDate\s*=\s*\?/);
    expect(confirmedQuery).toContain("SalaryReceiveStatus = 'YES'");
  });

  it("treats a month stamp OR any historical confirmation as confirmed", () => {
    expect(body).toMatch(/everConfirmed\.has\(/);
  });

  it("still records an employee absent from the verification month but confirmed earlier", () => {
    expect(body).toMatch(/if \(!credits\.has\(k\)\) credits\.set\(k, \{ account, confirmed: true \}\)/);
  });

  it("keeps the conflict comparison on the most recent credited account", () => {
    // Widening CONFIRMATION must not widen the account the record is compared against:
    // disagrees_with_credited_account is about the LAST credit.
    expect(body).toMatch(/WHERE SalDate = \?/);
  });
});
