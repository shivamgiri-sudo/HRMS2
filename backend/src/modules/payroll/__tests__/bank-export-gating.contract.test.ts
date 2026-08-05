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
    expect(EXTENDED).toContain("[env.PAYROLL_BANK_KEY, runId, ...scoped.params]");
  });
});

describe("tripwire: no new ungated account-number decryption", () => {
  it("payroll still decrypts account numbers in exactly the four known places", () => {
    const count = (s: string) => (s.match(/AES_DECRYPT\(ebd\.account_number/g) ?? []).length;
    const total = count(ROUTES) + count(EXTENDED);
    expect(
      total,
      "A payroll endpoint that decrypts bank account numbers was added or removed. " +
        "If added, gate it with hasOrgWideScope (payment file) or buildScopeWhereClause " +
        "(report) and update this count deliberately.",
    ).toBe(4);
  });
});
