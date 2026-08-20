import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The GRN reporting surface, and the one rule it must never get wrong.
 *
 * THE FINANCE MONTH IS accounting_period. An invoice dated in August but booked to July is
 * July's spend: accounting_period is what P&L, budget consumption, GRN numbering and the period
 * lock all read, and it is what the legacy sheet's "Finance Month" column already showed (Jul
 * against a Bill Date of 03-05-2026). If the month filter ever moves to bill_date, the same
 * invoice lands in two different months depending on which screen you opened — and the two
 * reports will not tie, with nothing on either one saying why.
 *
 * Scope is the other half. A report is the easiest place in this module to leak another
 * branch's spend, because showing many rows at once is its entire purpose.
 */

const financeDir = path.resolve(__dirname, "..");
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");
const SERVICE = read(financeDir, "grn-report.service.ts");
const ROUTES = read(financeDir, "grn.routes.ts");
const PANEL = fs.readFileSync(
  path.resolve(financeDir, "../../../../src/components/finance/grn/FinanceReportsWorkspace.tsx"),
  "utf8",
);
const PAGE = fs.readFileSync(
  path.resolve(financeDir, "../../../../src/pages/NativeGRNManagement.tsx"),
  "utf8",
);

const { query, execute } = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute, getConnection: vi.fn() } }));

const { grnReportService } = await import("../grn-report.service.js");

const lastSql = () => String(query.mock.calls.at(-1)?.[0] ?? "").replace(/\s+/g, " ");
const lastParams = () => (query.mock.calls.at(-1)?.[1] ?? []) as unknown[];

beforeEach(() => {
  query.mockReset().mockResolvedValue([[], []]);
  execute.mockReset().mockResolvedValue([[], []]);
});

const ORG_WIDE = { mode: "all" } as any;
const ONE_BRANCH = { mode: "branches", branchIds: ["branch-A"] } as any;

describe("the finance month is the accounting period", () => {
  it("filters the register on accounting_period, never on bill_date", async () => {
    await grnReportService.register({ branchScope: ORG_WIDE, month: "2026-07" });
    const sql = lastSql();
    expect(sql).toContain("g.accounting_period = ?");
    expect(lastParams()).toContain("2026-07");
    // The trap: a month filter that reads bill_date would put a Jul-booked, Aug-dated invoice
    // in August and quietly disagree with the P&L.
    expect(sql, "the month filter must not touch bill_date").not.toMatch(/bill_date\s*(=|>=|<=|LIKE)\s*\?/);
  });

  it("still reports bill_date as its own column, so both facts are visible", async () => {
    await grnReportService.register({ branchScope: ORG_WIDE });
    expect(lastSql()).toContain("g.bill_date");
  });

  it("orders by the finance month, not by when the invoice was raised", async () => {
    await grnReportService.register({ branchScope: ORG_WIDE });
    expect(lastSql()).toContain("ORDER BY g.accounting_period DESC");
  });

  it("uses the GRN's finance month for an audit event, not the date of the click", async () => {
    await grnReportService.auditTrail({ branchScope: ORG_WIDE, month: "2026-07" });
    const sql = lastSql();
    // An approval done in August of a July GRN is July's business.
    expect(sql).toContain("COALESCE(g.accounting_period, h.period_code) = ?");
    expect(lastParams()).toContain("2026-07");
  });

  it("says so on screen, where a reader can act on it", () => {
    expect(PANEL).toContain("Finance Month (accounting period)");
    expect(PANEL).toMatch(/accounting period.*not the invoice/s);
  });
});

describe("branch scope is the server's, not the client's", () => {
  it("constrains the register to the caller's branches", async () => {
    await grnReportService.register({ branchScope: ONE_BRANCH });
    expect(lastSql()).toContain("g.branch_id");
    expect(lastParams()).toContain("branch-A");
  });

  it("lets a requested branch narrow the scope but never replace it", async () => {
    await grnReportService.register({ branchScope: ONE_BRANCH, branchId: "branch-B" });
    const params = lastParams();
    // Both predicates are in the WHERE clause together, so asking for a branch outside the
    // scope set returns nothing rather than someone else's spend.
    expect(params).toContain("branch-A");
    expect(params).toContain("branch-B");
  });

  it("drops audit events whose entity resolves to no branch, rather than showing them to all", async () => {
    await grnReportService.auditTrail({ branchScope: ONE_BRANCH });
    expect(lastSql()).toContain("COALESCE(g.branch_id, h.branch_id) IS NOT NULL");
  });

  it("scopes the top-up report through the budget header's branch", async () => {
    await grnReportService.topups({ branchScope: ONE_BRANCH });
    expect(lastSql()).toContain("h.branch_id");
    expect(lastParams()).toContain("branch-A");
  });
});

describe("the GST split is honest about where it came from", () => {
  it("prefers the recorded allocation and derives only when there is none", async () => {
    await grnReportService.register({ branchScope: ORG_WIDE });
    const sql = lastSql();
    expect(sql).toContain("COALESCE(alloc.cgst_amount");
    expect(sql).toContain("CASE WHEN g.gst_type = 'igst'");
    // The report must say which of the two a row used: 44 of 84,784 GRNs have an allocation.
    expect(sql).toContain("AS gst_split_source");
  });

  it("never counts a released allocation toward the split", async () => {
    await grnReportService.register({ branchScope: ORG_WIDE });
    expect(lastSql()).toContain("lifecycle_status <> 'released'");
  });

  it("shows the provenance in the table", () => {
    expect(PANEL).toContain('label: "GST Split"');
  });
});

describe("the reports are reachable by the roles that were asked for", () => {
  it("gates every report route on FINANCE_REPORT_ROLES", () => {
    for (const route of ["/grn-reports/register", "/grn-reports/audit-trail", "/grn-reports/topups", "/grn-reports/filters"]) {
      const idx = ROUTES.indexOf(`"${route}"`);
      expect(idx, `${route} is not mounted`).toBeGreaterThan(-1);
      expect(ROUTES.slice(idx, idx + 200)).toContain("requireRole(...FINANCE_REPORT_ROLES)");
    }
  });

  it("names branch_admin, branch_head, accounts_head, finance_head and super_admin", () => {
    const idx = ROUTES.indexOf("const FINANCE_REPORT_ROLES");
    // Slice to the closing bracket of the ARRAY, not the `[]` in the RoleKey[] annotation.
    const list = ROUTES.slice(idx, ROUTES.indexOf("];", idx));
    for (const role of ["super_admin", "admin", "finance_head", "accounts_head", "branch_head", "branch_admin"]) {
      expect(list, `${role} must be able to read the reports`).toContain(`"${role}"`);
    }
  });

  it("keeps the client's tab gate identical to the server's list", () => {
    // A tab shown to someone the server refuses is three reports that all 403; a tab hidden
    // from someone the server allows is a feature nobody can find.
    const idx = PAGE.indexOf("const canViewReports = useHasRole(");
    expect(idx).toBeGreaterThan(-1);
    const gate = PAGE.slice(idx, PAGE.indexOf(");", idx));
    for (const role of ["super_admin", "admin", "finance_head", "accounts_head", "branch_head", "branch_admin"]) {
      expect(gate).toContain(`"${role}"`);
    }
    // hr / finance reach this page and are NOT on the server list.
    expect(gate).not.toContain('"hr"');
    expect(gate).not.toContain('"finance"');
  });

  it("mounts the reports away from /grns/:id so no :id route can shadow them", () => {
    // grnRouter.get("/grns/:id") matches any single segment; a sibling "/grns/reports" would be
    // answered with "GRN not found" instead.
    // Matched as a REGISTERED ROUTE, not as a string anywhere in the file — the comment above
    // the report block names "/grns/reports" precisely to explain why it is not used.
    expect(ROUTES).not.toMatch(/grnRouter\.(get|post)\(\s*"\/grns\/reports/);
    expect(ROUTES).toMatch(/grnRouter\.get\(\s*"\/grn-reports\/register"/);
  });
});

describe("what the legacy sheet had, and what it never could", () => {
  it("carries every column of the reference report", () => {
    for (const column of [
      "S.No.", "GRN", "Branch", "Finance Month", "Exp. Type", "Year Month", "Exp. Head",
      "Exp. SubHead", "Description", "Amount", "CGST", "SGST", "IGST", "Total", "Grn Date",
      "Approval Date", "Bill Date", "Due Date", "Payment Date", "TDS Deduct", "Status",
    ]) {
      expect(PANEL, `the legacy column '${column}' is missing`).toContain(`label: "${column}"`);
    }
  });

  it("adds the workflow facts a system with no approval chain could not report", () => {
    for (const column of ["Pending With", "Ageing (days)", "Raised By", "Unbudgeted", "Late Invoice"]) {
      expect(PANEL).toContain(`label: "${column}"`);
    }
  });

  it("keeps the same filters the legacy screen had", () => {
    expect(PANEL).toContain("Expense Mode");
    expect(PANEL).toContain('value="imprest"');
    expect(PANEL).toContain('value="non_imprest"');
    expect(PANEL).toContain("GRN No.");
  });

  it("builds the export from the table's own columns, so the two cannot drift", () => {
    expect(PANEL).toContain("function toCsv(columns: Column[]");
    expect(PANEL).toContain("toCsv(columns, rows)");
    // Every field quoted and quotes doubled: descriptions routinely contain commas.
    expect(PANEL).toContain('replace(/"/g, \'""\')');
  });

  it("never lets a truncated report read as a complete one", async () => {
    query.mockResolvedValue([Array.from({ length: 1000 }, (_, i) => ({ id: `g${i}`, status: "approved" })), []]);
    const result = await grnReportService.register({ branchScope: ORG_WIDE, limit: 1000 });
    expect(result.truncated).toBe(true);
    expect(PANEL).toContain("Showing the first");
  });

  it("caps the row count whatever the client asks for", async () => {
    await grnReportService.register({ branchScope: ORG_WIDE, limit: 999999 });
    expect(lastSql()).toContain("LIMIT 5000");
  });

  it("interpolates the clamped LIMIT rather than binding it", async () => {
    // mysql2 3.22.3 rejects LIMIT placeholders in execute() — the footgun already fixed in
    // listGrns. The value is clamped to an integer first, so this is not an injection point.
    await grnReportService.register({ branchScope: ORG_WIDE, limit: 50 });
    expect(lastSql()).toContain("LIMIT 50");
    expect(lastParams()).not.toContain(50);
  });
});

describe("totals", () => {
  it("are computed from the rows returned, so the footer cannot exceed the table", async () => {
    query.mockResolvedValue([[
      { id: "g1", status: "approved", amount_without_tax: 1000, tax_amount: 180, cgst_amount: 90, sgst_amount: 90, igst_amount: 0, amount_with_tax: 1180 },
      { id: "g2", status: "approved", amount_without_tax: 2000, tax_amount: 360, cgst_amount: 180, sgst_amount: 180, igst_amount: 0, amount_with_tax: 2360 },
    ], []]);
    const result = await grnReportService.register({ branchScope: ORG_WIDE });
    expect(result.totals.count).toBe(2);
    expect(result.totals.amountWithoutTax).toBe(3000);
    expect(result.totals.cgstAmount).toBe(270);
    expect(result.totals.amountWithTax).toBe(3540);
  });

  it("counts only what a pendingWith filter left visible", async () => {
    query.mockResolvedValue([[
      { id: "g1", status: "submitted", amount_with_tax: 100 },
      { id: "g2", status: "branch_head_approved", amount_with_tax: 900 },
    ], []]);
    const result = await grnReportService.register({ branchScope: ORG_WIDE, pendingWith: "branch_head" });
    expect(result.rows).toHaveLength(1);
    expect(result.totals.amountWithTax, "the footer must follow the filter").toBe(100);
  });
});
