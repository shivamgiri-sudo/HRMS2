import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Head Office GRN split across branches (2026-10-07) — saveComponentAllocations(). Same faked-DB
 * harness as grn-component-branch-headroom-gate.test.ts, plus the Back Office cost-centre lookup,
 * the branch-name lookup and the Head Office check.
 *
 * Original header of the sibling suite: Group C, step 2b (2026-08-22) — branch-wide headroom gate wired into saveComponentAllocations().
 *
 * Mirrors grn-branch-headroom-gate.test.ts's mocked-DB approach (real calculateBudgetLine /
 * getHeadSubHeadCoverage / allocateAcrossLines, faked DB layer routed by matching distinctive SQL
 * substrings). This method applies the SAME branch-aggregate/spillover rule as step 2a's
 * saveAllocations(), but with a different, already-documented tax rule: "Invoice GST rates are
 * ground truth" — each grid cell's already-computed, invoice-driven base/tax/gross figures are
 * kept FIXED and only reapportioned pro-rata across whichever funding line(s) end up paying for
 * them, never recomputed via calculateBudgetLine() against a funding line's own gst_rate/
 * tax_treatment. Several tests below exist specifically to catch that rule being violated.
 */

const { stateRef } = vi.hoisted(() => ({ stateRef: { current: null as any } }));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (...args: unknown[]) => stateRef.current.route(...(args as [string, unknown[]?])),
    getConnection: async () => stateRef.current.connection,
  },
}));

vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../process-pnl/budget-consumption.service.js", () => ({
  budgetConsumptionService: {
    reserve: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    reverseConsumption: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../process-pnl/finance-period-lock.js", () => ({
  isPeriodLocked: vi.fn().mockResolvedValue(false),
}));

// Real getHeadSubHeadCoverage/allocateAcrossLines implementation throughout.
vi.mock("../../process-pnl/budget-headroom-gate.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../process-pnl/budget-headroom-gate.service.js")>();
  return {
    ...actual,
    getHeadSubHeadCoverage: vi.fn(actual.getHeadSubHeadCoverage),
  };
});

vi.mock("../grn-head-office-bypass.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../grn-head-office-bypass.js")>()),
  isHeadOfficeBranch: vi.fn(async (id: string | null | undefined) => String(id) === "ho-1"),
}));

type FakeBudgetHeader = { id: string; branch_id: string; period_code: string; status: string; financial_year?: string };
type FakeBudgetLine = {
  id: string;
  budget_id: string;
  head: string;
  sub_head: string | null;
  item_name: string;
  cost_centre_id: string | null;
  cost_centre_name?: string | null;
  process_id: string | null;
  unit: string;
  unit_rate: number;
  tax_treatment: string;
  gst_rate: number;
  gst_type: string;
  recoverable_tax_pct: number;
  justification: string;
  period_code: string;
  quantity: number;
  reserved_quantity: number;
  consumed_quantity: number;
  gross_amount: number;
  reserved_amount: number;
  consumed_amount: number;
};
type FakeCostCentre = { id: string; cost_centre_code: string; cost_centre_name: string; branch_id: string; active_status: number };

// funding_cost_centre_id sits beside cost_centre_id from migration 1630: WHO INCURRED the
// spend and WHOSE BUDGET PAID it are separate facts now, so this fixture mirrors that order.
const ALLOCATION_INSERT_COLUMNS = [
  "id", "grn_request_id", "sequence_no", "budget_id", "budget_line_id", "invoice_component_id",
  "branch_id", "process_id", "cost_centre_id", "funding_cost_centre_id", "cost_class", "allocation_percentage",
  "quantity", "unit", "unit_rate", "tax_treatment", "gst_rate", "gst_type",
  "recoverable_tax_pct", "amount_without_tax", "tax_amount", "cgst_amount",
  "sgst_amount", "igst_amount", "amount_with_tax", "recoverable_tax_amount",
  "pnl_cost_amount", "lifecycle_status", "remarks", "is_unbudgeted", "created_by",
] as const;

const COMPONENT_INSERT_COLUMNS = [
  "id", "grn_request_id", "sequence_no", "amount_without_tax", "gst_rate",
  "hsn_sac_code", "tax_amount", "amount_with_tax", "remarks", "created_by",
] as const;


type BoRow = { id: string; cost_centre_code: string; cost_centre_name: string; cc_type?: string | null; billing_client_name?: string | null; revenue_flag?: number };

function makeState(opts: {
  grn: Record<string, unknown>;
  budgetHeaders: FakeBudgetHeader[];
  budgetLines: FakeBudgetLine[];
  costCentres: FakeCostCentre[];
  branches: Record<string, string>;
  boRows: Record<string, BoRow[]>;
}) {
  const insertedAllocations: Record<string, unknown>[] = [];
  const insertedComponents: Record<string, unknown>[] = [];
  const statements: string[] = [];
  let grnUpdateParams: unknown[] | null = null;
  const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

  async function route(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    const s = String(sql).replace(/\s+/g, " ").trim();
    statements.push(s);
    if (s.includes("SELECT * FROM grn_request WHERE id = ? FOR UPDATE")) return [[opts.grn], []];
    if (s.startsWith("SELECT g.*") && s.includes("FROM grn_request g")) return [[opts.grn], []];
    if (s.includes("FROM grn_cost_allocation a")) return [insertedAllocations.slice(), []];

    // Branch Back Office candidates (grn-branch-split.ts) — before the generic cost-centre route.
    if (s.includes("FROM cost_centre_master ccm") && s.includes("LIKE '%/BO/%'")) {
      return [opts.boRows[String(params[0])] ?? [], []];
    }
    if (s.startsWith("SELECT branch_name FROM branch_master")) {
      const name = opts.branches[String(params[0])];
      return [name ? [{ branch_name: name }] : [], []];
    }
    if (s.startsWith("UPDATE grn_request SET is_branch_split")) return [{ affectedRows: 1 }, []];

    if (s.includes("FROM finance_budget_line l") && s.includes("LEFT JOIN process_master")) {
      const [budgetLineId, branchId] = params;
      const line = opts.budgetLines.find((l) => String(l.id) === String(budgetLineId));
      if (!line) return [[], []];
      const header = opts.budgetHeaders.find((h) => String(h.id) === String(line.budget_id));
      if (!header || String(header.branch_id) !== String(branchId)) return [[], []];
      const cc = opts.costCentres.find((c) => String(c.id) === String(line.cost_centre_id));
      return [[{ ...line, budget_status: header.status, branch_id: header.branch_id, period_code: header.period_code,
        financial_year: header.financial_year ?? "2026-27", process_name: null,
        cost_centre_name: cc?.cost_centre_name ?? line.cost_centre_name ?? null }], []];
    }
    if (s.includes("FROM finance_budget_line l") && s.includes("available_gross_amount")) {
      const [headerId, head, subHead] = params;
      const rows = opts.budgetLines
        .filter((l) => String(l.budget_id) === String(headerId) && norm(l.head) === norm(head) && norm(l.sub_head) === norm(subHead))
        .map((l) => ({ ...l,
          available_quantity: Number(l.quantity) - Number(l.reserved_quantity) - Number(l.consumed_quantity),
          available_gross_amount: Math.round((Number(l.gross_amount) - Number(l.reserved_amount) - Number(l.consumed_amount) + Number.EPSILON) * 100) / 100 }));
      return [rows, []];
    }
    if (s.includes("FROM finance_budget_header") && s.includes("status = 'active'") && s.includes("LIMIT 1")) {
      const [branchId, periodCode] = params;
      const header = opts.budgetHeaders.find((h) => String(h.branch_id) === String(branchId) && String(h.period_code) === String(periodCode) && h.status === "active");
      return [header ? [{ id: header.id }] : [], []];
    }
    if (s.includes("FROM cost_centre_master") && s.includes("active_status = 1")) {
      const cc = opts.costCentres.find((c) => String(c.id) === String(params[0]) && c.active_status === 1);
      return [cc ? [cc] : [], []];
    }
    if (s.startsWith("DELETE FROM grn_cost_allocation")) { insertedAllocations.length = 0; return [{ affectedRows: 0 }, []]; }
    if (s.startsWith("DELETE FROM grn_invoice_component")) { insertedComponents.length = 0; return [{ affectedRows: 0 }, []]; }
    if (s.startsWith("INSERT INTO grn_invoice_component")) {
      const r: Record<string, unknown> = {}; COMPONENT_INSERT_COLUMNS.forEach((c, i) => { r[c] = params[i]; });
      insertedComponents.push(r); return [{ insertId: insertedComponents.length, affectedRows: 1 }, []];
    }
    if (s.startsWith("INSERT INTO grn_cost_allocation")) {
      const r: Record<string, unknown> = {}; ALLOCATION_INSERT_COLUMNS.forEach((c, i) => { r[c] = params[i]; });
      insertedAllocations.push(r); return [{ insertId: insertedAllocations.length, affectedRows: 1 }, []];
    }
    if (s.includes("SELECT id, allocation_percentage FROM grn_cost_allocation")) {
      return [insertedAllocations.map((r) => ({ id: r.id, allocation_percentage: r.allocation_percentage })), []];
    }
    if (s.includes("UPDATE grn_cost_allocation SET allocation_percentage")) {
      const [delta, id] = params; const rec = insertedAllocations.find((r) => r.id === id);
      if (rec) rec.allocation_percentage = Number(rec.allocation_percentage) + Number(delta);
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("UPDATE grn_request") && s.includes("SET allocation_mode")) { grnUpdateParams = params; return [{ affectedRows: 1 }, []]; }
    if (s.includes("DELETE FROM grn_period_allocation")) return [{ affectedRows: 0 }, []];
    if (s.startsWith("UPDATE grn_request") && s.includes("recognition_start_period = NULL")) return [{ affectedRows: 1 }, []];
    if (s.startsWith("INSERT INTO sensitive_action_log")) return [{ insertId: 1 }, []];
    if (s.startsWith("SELECT")) return [[], []];
    throw new Error(`Unhandled SQL in fake DB router: ${s.slice(0, 200)}`);
  }
  const connection = {
    execute: (...args: [string, unknown[]?]) => route(...args),
    beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined),
  };
  return { route, connection, statements,
    get insertedAllocations() { return insertedAllocations; },
    get grnUpdateParams() { return grnUpdateParams; } };
}

const line = (id: string, budgetId: string, ccId: string | null, available: number, extra: Partial<FakeBudgetLine> = {}): FakeBudgetLine => ({
  id, budget_id: budgetId, head: "Admin", sub_head: "Rent", item_name: "Rent", cost_centre_id: ccId, cost_centre_name: ccId,
  process_id: null, unit: "nos", unit_rate: 1, tax_treatment: "exclusive", gst_rate: 18, gst_type: "cgst_sgst",
  recoverable_tax_pct: 100, justification: "Approved", period_code: "2026-08", quantity: 1_000_000,
  reserved_quantity: 0, consumed_quantity: 0, gross_amount: available, reserved_amount: 0, consumed_amount: 0, ...extra,
});
const hdr = (id: string, branch: string): FakeBudgetHeader => ({ id, branch_id: branch, period_code: "2026-08", status: "active" });
const bo = (id: string, code: string, extra: Partial<BoRow> = {}): BoRow => ({ id, cost_centre_code: code, cost_centre_name: code, cc_type: "backoffice", ...extra });

function world(over: Partial<Parameters<typeof makeState>[0]> = {}) {
  return makeState({
    grn: { id: "grn-1", status: "draft", grn_type: "vendor", branch_id: "ho-1", accounting_period: "2026-08",
      recognition_start_period: null, recognition_end_period: null, bill_date: "2026-08-05", head: "Admin", sub_head: "Rent" },
    budgetHeaders: [hdr("hdr-ho", "ho-1"), hdr("hdr-A", "br-A"), hdr("hdr-B", "br-B")],
    budgetLines: [
      line("L-ho", "hdr-ho", "cc-HO", 100_000),
      line("L-A", "hdr-A", "cc-A-BO", 100_000),
      line("L-B", "hdr-B", "cc-B-BO", 100_000),
    ],
    costCentres: [
      { id: "cc-HO", cost_centre_code: "HO1", cost_centre_name: "HO cc", branch_id: "ho-1", active_status: 1 },
      { id: "cc-A-BO", cost_centre_code: "A-BO", cost_centre_name: "A BO", branch_id: "br-A", active_status: 1 },
      { id: "cc-B-BO", cost_centre_code: "B-BO", cost_centre_name: "B BO", branch_id: "br-B", active_status: 1 },
    ],
    branches: { "br-A": "NOIDA-2", "br-B": "DELHI" },
    boRows: { "br-A": [bo("cc-A-BO", "BSS/BO/NOIDA-2/577"), bo("cc-A-CLIENT", "BSS/BO/NOIDA-2/576", { cc_type: "inbound", billing_client_name: "Onfido" })],
              "br-B": [bo("cc-B-BO", "BSS/BO/DELHI/301")] },
    ...over,
  });
}

const save = async (splits: any[], role = "finance_head", total = 1180, roles: string[] = [role]) => {
  const { grnSmartService } = await import("../grn-smart.service.js");
  return grnSmartService.saveComponentAllocations("grn-1",
    { declaredInvoiceTotal: total, components: [{ amountWithoutTax: total / 1.18, gstRate: 18 }], costCentreSplits: splits },
    "user-1", role, roles);
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.GRN_BRANCH_SPLIT_ENABLED = "true";
});

describe("Head Office GRN split across branches — saveComponentAllocations", () => {
  it("60/40 across two branches: each share is on that branch's Back Office cost centre and budget, owned by that branch, Head Office untouched", async () => {
    stateRef.current = world();
    await save([{ branchId: "br-A", percentage: 60 }, { branchId: "br-B", percentage: 40 }]);
    const rows = stateRef.current.insertedAllocations;
    const of = (branch: string) => rows.filter((r: any) => r.branch_id === branch);
    expect(rows.every((r: any) => r.branch_id !== "ho-1")).toBe(true);
    expect(of("br-A").every((r: any) => r.cost_centre_id === "cc-A-BO" && r.budget_id === "hdr-A" && r.budget_line_id === "L-A")).toBe(true);
    expect(of("br-B").every((r: any) => r.cost_centre_id === "cc-B-BO" && r.budget_id === "hdr-B" && r.budget_line_id === "L-B")).toBe(true);
    expect(rows.every((r: any) => r.cost_class === "indirect" && Number(r.is_unbudgeted) === 0)).toBe(true);
    const sum = (b: string) => Math.round(of(b).reduce((t: number, r: any) => t + Number(r.amount_with_tax), 0) * 100) / 100;
    expect(sum("br-A")).toBe(708);
    expect(sum("br-B")).toBe(472);
    expect(sum("br-A") + sum("br-B")).toBe(1180);
    // The GRN header is Head Office's own side: no branch's Back Office named as its cost centre.
    const params = stateRef.current.grnUpdateParams as unknown[];
    expect(params[4]).toBeNull();
    expect(params[5]).toBe("indirect"); // header class: see the comment at the UPDATE
    expect(stateRef.current.statements.some((q: string) => q.startsWith("UPDATE grn_request SET is_branch_split"))).toBe(true);
  });

  it("a branch share draws the Back Office cost centre's own budget line first", async () => {
    stateRef.current = world({
      budgetLines: [
        line("L-ho", "hdr-ho", "cc-HO", 100_000),
        line("L-A-other", "hdr-A", "cc-A-other", 900_000), // far more headroom, but not the BO cost centre's
        line("L-A", "hdr-A", "cc-A-BO", 100_000),
        line("L-B", "hdr-B", "cc-B-BO", 100_000),
      ],
    });
    await save([{ branchId: "br-A", percentage: 100 }]);
    const rows = stateRef.current.insertedAllocations;
    expect(rows.every((r: any) => r.budget_line_id === "L-A" && r.funding_cost_centre_id === "cc-A-BO")).toBe(true);
  });

  it("Head Office keeps its own share beside a branch share (own cost centre, Head Office budget)", async () => {
    stateRef.current = world();
    await save([{ budgetLineId: "L-ho", percentage: 25 }, { branchId: "br-A", percentage: 75 }]);
    const rows = stateRef.current.insertedAllocations;
    const ho = rows.filter((r: any) => r.branch_id === "ho-1");
    const a = rows.filter((r: any) => r.branch_id === "br-A");
    expect(ho.length).toBeGreaterThan(0);
    expect(ho.every((r: any) => r.cost_centre_id === "cc-HO" && r.budget_id === "hdr-ho")).toBe(true);
    expect(a.every((r: any) => r.cost_centre_id === "cc-A-BO" && r.budget_id === "hdr-A")).toBe(true);
    expect(Math.round(rows.reduce((t: number, r: any) => t + Number(r.amount_with_tax), 0) * 100) / 100).toBe(1180);
  });

  it("refuses unless the Finance Head (or super admin) raises it", async () => {
    stateRef.current = world();
    await expect(save([{ branchId: "br-A", percentage: 100 }], "branch_head")).rejects.toMatchObject({ code: "BRANCH_SPLIT_ROLE" });
    await expect(save([{ branchId: "br-A", percentage: 100 }], "accounts_head")).rejects.toMatchObject({ code: "BRANCH_SPLIT_ROLE" });
    expect(stateRef.current.insertedAllocations).toHaveLength(0);
    await expect(save([{ branchId: "br-A", percentage: 100 }], "super_admin")).resolves.toBeDefined();
  });

  it("refuses while the flag is off, and for a GRN not raised at Head Office", async () => {
    stateRef.current = world();
    process.env.GRN_BRANCH_SPLIT_ENABLED = "false";
    await expect(save([{ branchId: "br-A", percentage: 100 }])).rejects.toMatchObject({ code: "BRANCH_SPLIT_DISABLED" });
    process.env.GRN_BRANCH_SPLIT_ENABLED = "true";
    stateRef.current = world({ grn: { id: "grn-1", status: "draft", grn_type: "vendor", branch_id: "br-A", accounting_period: "2026-08",
      recognition_start_period: null, recognition_end_period: null, bill_date: "2026-08-05", head: "Admin", sub_head: "Rent" } });
    await expect(save([{ branchId: "br-B", percentage: 100 }])).rejects.toMatchObject({ code: "BRANCH_SPLIT_HEAD_OFFICE_ONLY" });
  });

  it("a branch share never takes a raiser-picked budget line", async () => {
    stateRef.current = world();
    await expect(save([{ branchId: "br-A", budgetLineId: "L-A", percentage: 100 }])).rejects.toThrow(/funded from that branch's own budget/);
  });

  it("ambiguous Back Office: refused with the candidates; an explicit pick works; a pick outside the candidates is refused", async () => {
    const twoBo = { "br-A": [bo("cc-A-BO", "BSS/BO/NOIDA-2/577"), bo("cc-A-BO2", "BSS/BO/NOIDA-2/600")], "br-B": [bo("cc-B-BO", "B1")] };
    stateRef.current = world({ boRows: twoBo, costCentres: [
      { id: "cc-HO", cost_centre_code: "HO1", cost_centre_name: "HO cc", branch_id: "ho-1", active_status: 1 },
      { id: "cc-A-BO", cost_centre_code: "A1", cost_centre_name: "A1", branch_id: "br-A", active_status: 1 },
      { id: "cc-A-BO2", cost_centre_code: "A2", cost_centre_name: "A2", branch_id: "br-A", active_status: 1 },
      { id: "cc-B-BO", cost_centre_code: "B1", cost_centre_name: "B1", branch_id: "br-B", active_status: 1 }] });
    await expect(save([{ branchId: "br-A", percentage: 100 }])).rejects.toMatchObject({
      code: "BO_COST_CENTRE_AMBIGUOUS", candidates: expect.arrayContaining([expect.objectContaining({ id: "cc-A-BO2" })]),
    });
    await expect(save([{ branchId: "br-A", costCentreId: "cc-NOT-A-BO", percentage: 100 }])).rejects.toMatchObject({ code: "BO_COST_CENTRE_INVALID" });
    await save([{ branchId: "br-A", costCentreId: "cc-A-BO2", percentage: 100 }]);
    expect(stateRef.current.insertedAllocations.every((r: any) => r.cost_centre_id === "cc-A-BO2")).toBe(true);
  });

  it("a branch with no Back Office cost centre is refused (nothing is guessed)", async () => {
    stateRef.current = world({ boRows: { "br-A": [], "br-B": [bo("cc-B-BO", "B1")] } });
    await expect(save([{ branchId: "br-A", percentage: 100 }])).rejects.toMatchObject({ code: "BO_COST_CENTRE_MISSING" });
  });

  it("a branch whose own budget cannot cover its share is refused by name, and nothing is written", async () => {
    stateRef.current = world({ budgetLines: [
      line("L-ho", "hdr-ho", "cc-HO", 100_000), line("L-A", "hdr-A", "cc-A-BO", 100_000), line("L-B", "hdr-B", "cc-B-BO", 100),
    ] });
    await expect(save([{ branchId: "br-A", percentage: 60 }, { branchId: "br-B", percentage: 40 }]))
      .rejects.toMatchObject({ code: "HEADROOM_EXCEEDED", message: expect.stringContaining("DELHI") });
    expect(stateRef.current.insertedAllocations).toHaveLength(0);
  });

  it("a branch with no active budget for the period is refused by name (no fallback to Head Office's budget)", async () => {
    stateRef.current = world({ budgetHeaders: [hdr("hdr-ho", "ho-1"), hdr("hdr-A", "br-A")] });
    await expect(save([{ branchId: "br-B", percentage: 100 }])).rejects.toMatchObject({ code: "NO_BRANCH_BUDGET", message: expect.stringContaining("DELHI") });
    expect(stateRef.current.insertedAllocations).toHaveLength(0);
  });

  it("an ordinary same-branch GRN is untouched: no branch lookups, rows owned by the GRN's branch", async () => {
    stateRef.current = world();
    await save([{ budgetLineId: "L-ho", percentage: 100 }]);
    const rows = stateRef.current.insertedAllocations;
    expect(rows.every((r: any) => r.branch_id === "ho-1" && r.cost_class !== "indirect")).toBe(true);
    expect(stateRef.current.statements.some((q: string) => q.includes("LIKE '%/BO/%'"))).toBe(false);
    // ...and no flag write at all for a GRN that was never split.
    expect(stateRef.current.statements.some((q: string) => q.includes("is_branch_split"))).toBe(false);
  });

  it("saving a previously split GRN again without any branch share clears the marker", async () => {
    stateRef.current = world({ grn: { id: "grn-1", status: "draft", grn_type: "vendor", branch_id: "ho-1", accounting_period: "2026-08",
      recognition_start_period: null, recognition_end_period: null, bill_date: "2026-08-05", head: "Admin", sub_head: "Rent", is_branch_split: 1 } });
    await save([{ budgetLineId: "L-ho", percentage: 100 }]);
    expect(stateRef.current.statements.some((q: string) => q.startsWith("UPDATE grn_request SET is_branch_split"))).toBe(true);
  });
});
