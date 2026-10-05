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
// The table, CSV, Excel and Tally XML builders live here.
const FMT = readFileSync(at("../salary-voucher-formats.ts"), "utf8");

let registered: { method: string; path: string }[];
beforeAll(async () => {
  const { app } = await import("../../../app.js");
  const { enumerateRoutes } = await import("../../../platform/route-contract.js");
  registered = enumerateRoutes(app).map((r) => ({
    method: String(r.method).toUpperCase(),
    path: String(r.path).replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":x"),
  }));
  // 420s, not the default. This hook imports the ENTIRE Express app to read its route table,
  // which is the only way to prove a route is really mounted — a nonexistent /api path 401s
  // exactly like a real one. Under a full parallel run two workers do that cold import at once
  // and 180s was not enough; the tests pass individually. Mocking the app away would delete the
  // only thing these files actually check.
}, 420_000);

describe("the endpoints exist", () => {
  it.each([
    ["GET", "/api/finance/payroll/runs/:x/vouchers"],
    ["GET", "/api/finance/payroll/runs/:x/vouchers/export"],
    // IDC is sourced from db_bill, on its own explicitly-gated endpoint.
    ["GET", "/api/finance/payroll/runs/bill/:x/vouchers"],
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
    const header = FMT.slice(FMT.indexOf("const header = ["), FMT.indexOf("];", FMT.indexOf("const header = [")));
    for (const column of [
      '"Vch No"', '"Date"', '"Details"', '"Amount"', '"DebitCredit"',
      '"Cost Category"', '"Cost Centre"', '"Narration for Each Entry"', '"Narration"', '"VchType"',
    ]) {
      expect(header, `${column} must be in the header`).toContain(column);
    }
  });

  it("keeps the columns in the reference order", () => {
    const header = FMT.slice(FMT.indexOf("const header = ["), FMT.indexOf("];", FMT.indexOf("const header = [")));
    const order = ['"Vch No"', '"Date"', '"Details"', '"Amount"', '"DebitCredit"',
      '"Cost Category"', '"Cost Centre"', '"Narration for Each Entry"', '"Narration"', '"VchType"'];
    const positions = order.map((c) => header.indexOf(c));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `${order[i]} must follow ${order[i - 1]}`).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("puts the split columns between Amount and DebitCredit", () => {
    // Where the reference puts them, and the reference leaves their headings blank (they are named from the cohort labels here).
    const header = FMT.slice(FMT.indexOf("const header = ["), FMT.indexOf("];", FMT.indexOf("const header = [")));
    const amountAt = header.indexOf('"Amount"');
    const splitAt = header.indexOf("Array.from({ length: splitCount }");
    const dcAt = header.indexOf('"DebitCredit"');
    expect(splitAt).toBeGreaterThan(amountAt);
    expect(dcAt).toBeGreaterThan(splitAt);
  });

  it("emits no split columns when a company has no cohorts", () => {
    // The IDC reference file goes straight from Amount to DebitCredit.
    expect(FMT).toContain("const split = splitCount");
    expect(FMT).toMatch(/splitCount\s*\?/);
  });

  it("prints the cohort column before the remainder, as the reference does", () => {
    // Internally columns are [remainder, cohort…]; the file shows [cohort…, remainder].
    expect(FMT).toContain("line.columns.slice(1), line.columns[0]");
  });
});

describe("authorisation", () => {
  it("restricts the voucher to finance and payroll roles", () => {
    // Not the broad GRN read set, and never branch_admin: one response carries a branch's whole
    // payroll and what each person had recovered from them.
    expect(SRC).toContain('const VOUCHER_ROLES = ["finance_head", "accounts_head", "payroll_head", "payroll_hr", "super_admin"] as const;');
    // Checked against the role list rather than the whole file: the prose above it names
    // branch_admin precisely to say it is excluded.
    const roleList = SRC.slice(SRC.indexOf("const VOUCHER_ROLES"), SRC.indexOf("as const;") + 9);
    expect(roleList).not.toContain("branch_admin");
    expect(roleList).not.toContain("branch_head");
  });

  it("applies branch scope on top of the role, on both endpoints", () => {
    const calls = SRC.match(/await scopeVouchers\(req, /g) ?? [];
    // list, export (preview + claim), the db_bill IDC endpoint and the Tally push — all scope.
    expect(calls.length, "every voucher endpoint must scope").toBe(5);
  });

  it("scopes by the voucher's branch id rather than its name", () => {
    // Branch names are duplicated in this database (HEAD OFFICE / Head Office), so matching on
    // the name would leak one spelling's rows to someone entitled only to the other.
    expect(SRC).toContain("allowed.has(v.branch_id)");
  });

  it("never writes — the voucher is a view of a run that already exists", () => {
    expect(SRC).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    // The one POST sends vouchers OUT to Tally; it writes nothing to payroll.
    const writes = [...SRC.matchAll(/salaryVoucherRouter\.(post|put|patch|delete)\(\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(writes.sort()).toEqual(["post /runs/:runId/vouchers/locks/release", "post /runs/:runId/vouchers/push-to-tally"]);
  });
});

describe("export formats", () => {
  it("offers csv, xlsx and Tally xml from the one export route", () => {
    expect(SRC).toContain("parseFormat(req.query.format)");
    expect(FMT).toContain('"xlsx" || v === "xml"');
  });

  it("uses Tally's sign convention in the XML: debit negative, credit positive", () => {
    expect(FMT).toContain('debit ? "Yes" : "No"');
    expect(FMT).toContain("debit ? -Math.abs(l.amount) : Math.abs(l.amount)");
  });
});

describe("CSV safety", () => {
  it("quotes any field containing a comma, quote or newline", () => {
    // Ledger names contain commas in principle, and a narration carries the voucher number.
    expect(FMT).toContain('/[",\\n]/.test(text)');
    expect(FMT).toContain('text.replace(/"/g, \'""\')');
  });
});

describe("the voucher serial is Tally's, not ours", () => {
  /**
   * The serial in HEAD OFFICE/MAS/06/26/614 continues Tally's own sequence — 612, 614, 615, 616
   * across the reference files. HRMS2 does not own that counter and cannot see it.
   *
   * It used to default silently to 1, so every generated voucher printed
   * "HEAD OFFICE/MAS/06/26/1": a number that looks authoritative, is wrong, and is identical on
   * every generation — which is a duplicate posting the moment two of them are imported.
   */
  it("validates the serial instead of coercing it", () => {
    // Number("abc") is NaN, and an unguarded NaN reaches the voucher number as ".../NaN" on a
    // document that posts money. A CSV import accepts that without complaint.
    expect(SRC).toContain("function parseSerial");
    expect(SRC).toContain("Number.isInteger(value)");
    expect(SRC).toContain("value < 1");
  });

  it("uses the validated parser on both the list and the export", () => {
    const uses = SRC.match(/serialFrom: parseSerial\(req\.query\.serialFrom\)|const serialFrom = parseSerial\(req\.query\.serialFrom\)/g) ?? [];
    // list, export, and the db_bill IDC endpoint all validate the serial the same way.
    expect(uses, "every voucher endpoint must validate the serial").toHaveLength(3);
  });

  it("treats a bad serial as absent rather than failing the request", () => {
    // Falling back to the provisional numbering the UI warns about is better than a 400 on a
    // read-only preview, and better than printing NaN.
    expect(SRC).toContain("return undefined;");
  });
});

describe("Tally HTTP gateway push", () => {
  it("parses Tally's import response", async () => {
    const { parseTallyResponse } = await import("../salary-voucher-tally-push.service.js");
    expect(parseTallyResponse("<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>"))
      .toEqual({ created: 1, altered: 0, errors: 0, exceptions: 0, lineErrors: [] });
    expect(parseTallyResponse("<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger 'X' does not exist!</LINEERROR></RESPONSE>"))
      .toMatchObject({ created: 0, errors: 1, lineErrors: ["Ledger 'X' does not exist!"] });
  });

  it("takes the gateway address from the environment, never from the request", () => {
    const svc = readFileSync(at("../salary-voucher-tally-push.service.ts"), "utf8");
    expect(svc).toContain("process.env.TALLY_GATEWAY_URL");
    expect(SRC).not.toMatch(/req\.(body|query)\??\.(url|gateway|host)/i);
  });

  it("refuses to post without a Tally serial and narrows the roles", () => {
    expect(SRC).toContain("Enter the next voucher number from Tally");
    expect(SRC).toContain('requireRole("finance_head", "accounts_head", "super_admin")');
  });

  it("sends the company to Tally when one is configured", async () => {
    const { buildTallyXml } = await import("../salary-voucher-formats.js");
    expect(buildTallyXml([], "MAS Callnet")).toContain("<SVCURRENTCOMPANY>MAS Callnet</SVCURRENTCOMPANY>");
    expect(buildTallyXml([])).toContain("<DESC></DESC>");
  });
});

describe("Tally export lock (no duplicate imports)", () => {
  it("exports lock the vouchers first and only claim ones nobody pulled before", () => {
    expect(SRC).toContain("tallyExportLock.lock(\"salary_voucher\"");
    expect(SRC).toContain("ALL_LOCKED");
    expect(SRC).toContain("skipBuckets");
  });
  it("a preview without a serial is never locked and the XML refuses to be a preview", () => {
    expect(SRC).toContain('"-PREVIEW"');
    expect(SRC).toContain("before exporting the Tally XML");
  });
  it("re-export and release are finance-head only and need a reason", () => {
    const lock = readFileSync(at("../tally-export-lock.service.ts"), "utf8");
    expect(lock).toContain('new Set(["finance_head", "super_admin"])');
    expect(lock).toContain("MIN_REASON = 10");
    expect(SRC).toContain('requireRole("finance_head", "super_admin")');
  });
  it("keys a voucher by company and branch, not by its number", () => {
    expect(SRC).toContain("`${v.company_code}|${v.branch_id}`");
  });
});
