/**
 * Every payroll endpoint that decrypts bank account numbers must be gated on
 * org-wide scope, and the salary register must row-filter to the caller's scope.
 *
 * The behavioural proof lives in payroll-bulk-export-scope.test.ts, which mounts
 * payroll-extended.routes.ts. The two duplicate bank endpoints in
 * payroll.routes.ts (that file is too heavily wired to mount in a unit test) are
 * pinned here as source contracts instead, together with a tripwire on the number
 * of decryption sites so a newly-added one cannot slip in ungated.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = readFileSync(resolve(process.cwd(), "src/modules/payroll/payroll.routes.ts"), "utf8");
const EXTENDED = readFileSync(resolve(process.cwd(), "src/modules/payroll/payroll-extended.routes.ts"), "utf8");
const SCOPE_ACCESS = readFileSync(resolve(process.cwd(), "src/shared/scopeAccess.ts"), "utf8");

/** Body of the handler registered at `path`, up to `len` chars. */
function handlerAt(source: string, path: string, len = 900): string {
  const idx = source.indexOf(`"${path}"`);
  expect(idx, `route ${path} not found`).toBeGreaterThan(-1);
  return source.slice(idx, idx + len);
}

describe("hasOrgWideScope is a real org-wide check, not a role check", () => {
  it("is exported from shared/scopeAccess.ts", () => {
    expect(SCOPE_ACCESS).toMatch(/export async function hasOrgWideScope\(/);
  });

  it("requires an explicit scope_type='all' row for non-admin roles", () => {
    const idx = SCOPE_ACCESS.indexOf("export async function hasOrgWideScope(");
    const body = SCOPE_ACCESS.slice(idx, idx + 600);
    // super_admin/admin bypass, everyone else needs a scope row saying 'all'.
    expect(body).toMatch(/hasAnyRole\(userId, "super_admin", "admin"\)/);
    expect(body).toMatch(/scope_type === "all"/);
  });
});

describe("bank-file endpoints in payroll.routes.ts are gated (duplicates of the extended-router ones)", () => {
  for (const path of ["/runs/:id/neft-export", "/runs/:runId/neft-lines"]) {
    it(`${path} calls hasOrgWideScope before querying`, () => {
      const body = handlerAt(ROUTES, path);
      expect(body).toMatch(/hasOrgWideScope\(req\.authUser!\.id, PAYROLL_EXPORT_ROLES\)/);
      expect(body).toContain("ORG_WIDE_REQUIRED_MSG");
    });
  }
});

describe("bank-file endpoints in payroll-extended.routes.ts are gated", () => {
  for (const path of ["/runs/:id/neft-summary", "/runs/:id/neft-export"]) {
    it(`${path} calls hasOrgWideScope before querying`, () => {
      const body = handlerAt(EXTENDED, path);
      expect(body).toMatch(/hasOrgWideScope\(req\.authUser!\.id, PAYROLL_EXPORT_ROLES\)/);
    });
  }
});

describe("the salary register filters rather than denies", () => {
  it("salary-sheet-export builds a scope clause and refuses an unscoped caller", () => {
    const body = handlerAt(EXTENDED, "/runs/:id/salary-sheet-export", 1600);
    expect(body).toMatch(/buildScopeWhereClause\(/);
    expect(body).toContain("PAYROLL_REPORT_SCOPE_ROLES");
    // 1=0 means "no scope assigned" — must 403, not download an empty workbook.
    expect(body).toMatch(/scoped\.sql === "1=0"/);
  });

  it("appends the scope clause to the WHERE and passes its params last", () => {
    expect(EXTENDED).toContain("AND (${scoped.sql})");
    // Asserted as "runId, then the scope params spread last" rather than pinning the
    // full array. The leading bind used to be an encryption key; that is an unrelated
    // implementation detail which has since changed, and coupling a scope assertion to
    // it made this fail for a reason that had nothing to do with scoping.
    expect(EXTENDED).toMatch(/\[[^\]]*runId,\s*\.\.\.scoped\.params\]/);
  });
});

describe("tripwire: no new ungated account-number export", () => {
  it("payroll reads bank account numbers in exactly the four known places", () => {
    // Counts the column, not the function wrapping it. The concern is that an
    // account number reaches a response at all; whether it is read via AES_DECRYPT
    // or CAST is a storage question, and the earlier version of this test tracked
    // the wrapper and so went blind the moment that changed.
    // Counted separately, because `/ebd\.account_number/` has no word boundary and therefore
    // also matches `ebd.account_number_enc`. Once 851d78ca added the encrypted column, each of
    // the four sites read BOTH columns — the dual-read fallback — and this tripwire reported
    // 8, reading as "four new ungated exports appeared" when no endpoint had been added at all.
    // Measured: payroll.routes.ts 2 legacy + 2 enc, payroll-extended.routes.ts 2 legacy + 2 enc.
    // 2026-08-10 audit: +2 legacy +2 enc for the two new gated endpoints in payroll-extended.routes.ts:
    //   GET /runs/:runId/bank-exception-report  — gated by hasOrgWideScope (P0 gate)
    //   POST /runs/:runId/golden-month-reconcile — gated by hasOrgWideScope (P0 gate)
    // New totals: payroll.routes.ts 2+2, payroll-extended.routes.ts 4+4 = 6 legacy + 6 enc.
    //
    // Two counts rather than one total, so the tripwire still fires on a genuinely new site of
    // either kind instead of being satisfied by a number that happens to add up. The enc count
    // drops back to 0 when the legacy column is retired by the planned migration 1111, and that
    // is a deliberate update, not a silent pass.
    // 2026-08-14 NEFT total-integrity fix: +1 legacy +1 enc in payroll.routes.ts, at
    //   GET /runs/:id/neft-summary
    // New totals: payroll.routes.ts 3+3, payroll-extended.routes.ts 4+4 = 7 legacy + 7 enc.
    //
    // This site is deliberately different in kind from the other six and is the reason the
    // count moved without a new export appearing. The summary reads both columns ONLY inside a
    // COALESCE(...) IS NOT NULL presence test, to decide whether an employee is payable; it
    // never selects an account number into its response, which returns six aggregate numbers
    // and nothing per-employee. It exists because /neft-summary is the figure Finance reads
    // before exporting, and it previously called an employee "banked" on the strength of a
    // non-null ifsc_code alone — so the preview disagreed with the file, by Rs 19,37,731 on the
    // 2026-04 run. Establishing payability honestly requires touching the columns; exposing
    // them does not, and is not done here.
    const countLegacy = (s: string) => (s.match(/ebd\.account_number(?!_enc)\b/g) ?? []).length;
    const countEnc = (s: string) => (s.match(/ebd\.account_number_enc\b/g) ?? []).length;
    const legacy = countLegacy(ROUTES) + countLegacy(EXTENDED);
    const enc = countEnc(ROUTES) + countEnc(EXTENDED);
    const message =
      "A payroll endpoint reading bank account numbers was added or removed. " +
      "If added, gate it with hasOrgWideScope (payment file) or buildScopeWhereClause " +
      "(report) and update this count deliberately.";
    // 2026-08-14 Excel-mangled-account fix: +3 legacy in payroll.routes.ts's /neft-summary.
    // New totals: payroll.routes.ts 6+3, payroll-extended.routes.ts 4+4 = 10 legacy + 7 enc.
    //
    // The enc count did NOT move, and that asymmetry is the point rather than an oversight:
    // account_number_enc is ciphertext, so it can only ever be presence-checked, while the
    // plaintext column now also gets a format check — an IS NULL guard plus a REGEXP and a
    // NOT REGEXP — to exclude values like "3.03801E+13". All three are guard clauses; none
    // projects a value. Verified live: exactly one employee in the FINALIZED 2026-04 run carries
    // such an account and was reaching the declared payment total with Rs 55,414, and 4,039
    // employees org-wide hold one on an active primary record.
    //
    // neft-export-total-integrity.test.ts enforces the "guard-only, never projected" claim
    // directly, so this count moving is not by itself evidence that anything is exposed.
    expect(legacy, `${message} (legacy account_number reads)`).toBe(10);
    expect(enc, `${message} (encrypted account_number_enc reads)`).toBe(7);
  });
});
