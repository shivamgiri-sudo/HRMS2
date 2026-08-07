import { readFileSync } from "fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The salary voucher export is a FORMAT CONTRACT.
 *
 * Tally's import maps by column POSITION, not by header text. Renaming a column, reordering
 * two, or inserting a helpful extra one silently maps every value into the wrong field — and
 * the import succeeds, which is the dangerous part. Nothing about a wrong posting looks wrong
 * until somebody reconciles the month.
 *
 * The reference is the supplied `MAS SALARY VCH JUNE - 2026.xls`. Its header is:
 *
 *   Vch No | Date | Details | Amount | <blank> | <blank> | DebitCredit | Cost Category |
 *   Cost Centre | Narration for Each Entry | Narration | VchType
 *
 * The two blanks are the cohort split, and the IDC file has neither — so the header is built
 * from the data rather than hardcoded, and both shapes are asserted below.
 */

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), getConnection: vi.fn() },
  pingDb: vi.fn(),
}));
vi.mock("../../../db/supabaseAdmin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

const at = (rel: string) =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = readFileSync(at("../salary-voucher.routes.ts"), "utf8");

let registered: { method: string; path: string }[];
beforeAll(async () => {
  const { app } = await import("../../../app.js");
  const { enumerateRoutes } = await import("../../../platform/route-contract.js");
  registered = enumerateRoutes(app).map((r) => ({
    method: String(r.method).toUpperCase(),
    path: String(r.path).replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":x"),
  }));
}, 180_000);

describe("the endpoints exist", () => {
  it.each([
    ["GET", "/api/finance/payroll/runs/:x/vouchers"],
    ["GET", "/api/finance/payroll/runs/:x/vouchers/export"],
  ])("%s %s", (method, path) => {
    expect(registered.some((r) => r.method === method && r.path === path),
      `${method} ${path} is not registered`).toBe(true);
  });

  it("is mounted under its own prefix", () => {
    // A salary voucher exposes a whole branch payroll, including individual advance recoveries.
    // It must not be reachable through a path some broader finance router also serves.
    expect(SRC).not.toContain('app.use("/api/finance"');
    expect(registered.some((r) => r.path.startsWith("/api/finance/payroll"))).toBe(true);
  });
});

describe("the header is the reference file's, in order", () => {
  it("names the columns exactly as the reference does", () => {
    const header = SRC.slice(SRC.indexOf("const header = ["), SRC.indexOf("];", SRC.indexOf("const header = [")));
    for (const column of [
      '"Vch No"', '"Date"', '"Details"', '"Amount"', '"DebitCredit"',
      '"Cost Category"', '"Cost Centre"', '"Narration for Each Entry"', '"Narration"', '"VchType"',
    ]) {
      expect(header, `${column} must be in the header`).toContain(column);
    }
  });

  it("keeps the columns in the reference order", () => {
    const header = SRC.slice(SRC.indexOf("const header = ["), SRC.indexOf("];", SRC.indexOf("const header = [")));
    const order = ['"Vch No"', '"Date"', '"Details"', '"Amount"', '"DebitCredit"',
      '"Cost Category"', '"Cost Centre"', '"Narration for Each Entry"', '"Narration"', '"VchType"'];
    const positions = order.map((c) => header.indexOf(c));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `${order[i]} must follow ${order[i - 1]}`).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("puts the split columns between Amount and DebitCredit, unnamed", () => {
    // Where the reference puts them, and they carry no heading there.
    const header = SRC.slice(SRC.indexOf("const header = ["), SRC.indexOf("];", SRC.indexOf("const header = [")));
    const amountAt = header.indexOf('"Amount"');
    const splitAt = header.indexOf("Array.from({ length: splitCount }");
    const dcAt = header.indexOf('"DebitCredit"');
    expect(splitAt).toBeGreaterThan(amountAt);
    expect(dcAt).toBeGreaterThan(splitAt);
  });

  it("emits no split columns when a company has no cohorts", () => {
    // The IDC reference file goes straight from Amount to DebitCredit.
    expect(SRC).toContain("const split = splitCount");
    expect(SRC).toMatch(/splitCount\s*\?/);
  });

  it("prints the cohort column before the remainder, as the reference does", () => {
    // Internally columns are [remainder, cohort…]; the file shows [cohort…, remainder].
    expect(SRC).toContain("line.columns.slice(1), line.columns[0]");
  });
});

describe("authorisation", () => {
  it("restricts the voucher to finance and payroll roles", () => {
    // Not the broad GRN read set, and never branch_admin: one response carries a branch's whole
    // payroll and what each person had recovered from them.
    expect(SRC).toContain('const VOUCHER_ROLES = ["finance_head", "payroll_hr", "super_admin"] as const;');
    // Checked against the role list rather than the whole file: the prose above it names
    // branch_admin precisely to say it is excluded.
    const roleList = SRC.slice(SRC.indexOf("const VOUCHER_ROLES"), SRC.indexOf("as const;") + 9);
    expect(roleList).not.toContain("branch_admin");
    expect(roleList).not.toContain("branch_head");
  });

  it("applies branch scope on top of the role, on both endpoints", () => {
    const calls = SRC.match(/await scopeVouchers\(req, /g) ?? [];
    expect(calls.length, "the list and the export must both scope").toBe(2);
  });

  it("scopes by the voucher's branch id rather than its name", () => {
    // Branch names are duplicated in this database (HEAD OFFICE / Head Office), so matching on
    // the name would leak one spelling's rows to someone entitled only to the other.
    expect(SRC).toContain("allowed.has(v.branch_id)");
  });

  it("never writes — the voucher is a view of a run that already exists", () => {
    expect(SRC).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(SRC).not.toMatch(/salaryVoucherRouter\.(post|put|patch|delete)/);
  });
});

describe("CSV safety", () => {
  it("quotes any field containing a comma, quote or newline", () => {
    // Ledger names contain commas in principle, and a narration carries the voucher number.
    expect(SRC).toContain('/[",\\n]/.test(text)');
    expect(SRC).toContain('text.replace(/"/g, \'""\')');
  });
});
