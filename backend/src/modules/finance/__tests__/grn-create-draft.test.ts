import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * grnService.createDraft() driven end to end against a faked DB — the one entry point to the
 * whole GRN lifecycle, and the one with zero behavioural coverage before this file. Everything
 * downstream (allocation, review, payment) had tests; nothing proved a GRN could actually be
 * raised, or that the checks guarding entry into the system behave as documented.
 *
 * This is also where several of the 2026-08-29 fixes live: the branch-aggregate headroom check
 * (replacing a single-line one that disagreed with the allocation step), the relaxed
 * cost-centre/line match (which is what makes "cost centre A raises against cost centre B's
 * line" possible), and the sub-head closure gate moved forward from Branch Head approval to
 * create time. Each has a test here that fails on the pre-fix code — see the paired
 * `it.skip`-free assertions below; there is no dedicated "before/after" harness for createDraft
 * the way the headroom-gate files have one, so the regression protection IS this file.
 *
 * `db.execute` is called directly (createDraft is not itself transactional — see
 * getLineForGrn/resolveCanonicalVendor, both plain reads), so the fake router only needs to
 * answer plain queries, no connection/transaction object.
 */

const { stateRef } = vi.hoisted(() => ({ stateRef: { current: null as any } }));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => stateRef.current.route(...(args as [string, unknown[]?])) },
}));

vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

const periodLocked = vi.fn().mockResolvedValue(false);
vi.mock("../../process-pnl/finance-period-lock.js", () => ({
  isPeriodLocked: (...args: unknown[]) => periodLocked(...args),
}));

vi.mock("../grn-number.service.js", () => ({
  allocateGrnNumber: vi.fn().mockResolvedValue("GRN/BR1/2026-27/0001"),
}));
vi.mock("../grn-number-monthly.service.js", () => ({
  allocateMonthlyGrnNumber: vi.fn().mockResolvedValue("GRN/202608/0001"),
  resolveGrnNumberFormat: vi.fn().mockResolvedValue("legacy_branch_fy"),
  resolveAccountingPeriod: vi.fn(({ billDate }: { billDate: string }) => String(billDate).slice(0, 7)),
}));

type FakeLine = {
  id: string;
  budget_id: string;
  branch_id: string;
  period_code: string;
  head: string;
  sub_head: string | null;
  item_name: string;
  cost_centre_id: string | null;
  process_id: string | null;
  unit: string;
  unit_rate: number;
  tax_treatment: string;
  gst_rate: number;
  gst_type: string;
  recoverable_tax_pct: number;
  gross_amount: number;
  reserved_amount: number;
  consumed_amount: number;
  preferred_vendor_id: string | null;
};

function makeState(opts: {
  headerActive?: boolean;
  lines?: FakeLine[];
  costCentres?: Array<{ id: string; branch_id: string; active_status: number }>;
  vendors?: Array<{ id: string; vendor_name: string; is_active: number }>;
  subheadClosed?: boolean;
}) {
  const inserted: Array<{ sql: string; params: unknown[] }> = [];
  const headerActive = opts.headerActive ?? true;
  const lines = opts.lines ?? [];
  const costCentres = opts.costCentres ?? [];
  const vendors = opts.vendors ?? [];

  async function route(sql: string, params: unknown[] = []) {
    const s = sql.trim().replace(/\s+/g, " ");

    // getLineForGrn — the one line the raiser picked.
    if (s.includes("FROM finance_budget_line l") && s.includes("JOIN finance_budget_header h") && s.includes("l.id = ?")) {
      const [lineId, branchId] = params;
      const line = lines.find((l) => l.id === lineId && l.branch_id === branchId);
      if (!line) return [[], []];
      const available = line.gross_amount - line.reserved_amount - line.consumed_amount;
      return [[{ ...line, budget_status: "active", available_gross_amount: available, available_quantity: 999 }], []];
    }
    // getHeadSubHeadCoverage — header existence.
    if (s.includes("FROM finance_budget_header") && s.includes("status = 'active'") && s.includes("LIMIT 1")) {
      return headerActive ? [[{ id: "hdr-1" }], []] : [[], []];
    }
    // getHeadSubHeadCoverage — the branch aggregate for this head/sub-head.
    if (s.includes("FROM finance_budget_line l") && s.includes("available_gross_amount") && s.includes("JOIN finance_budget_header h")) {
      const [, head, subHead] = params;
      const matches = lines
        .filter((l) => String(l.head).toUpperCase() === String(head).toUpperCase())
        .filter((l) => String(l.sub_head ?? "").toUpperCase() === String(subHead ?? "").toUpperCase())
        .map((l) => ({ ...l, available_gross_amount: l.gross_amount - l.reserved_amount - l.consumed_amount }));
      return [matches, []];
    }
    // budgetClosureService.assertSubheadOpen
    if (s.includes("FROM finance_budget_subhead_closure")) {
      return [opts.subheadClosed ? [{ status: "closed" }] : [], []];
    }
    // cost_centre_master lookups (both the createDraft branch check and createUnbudgetedDraft's).
    if (s.includes("FROM cost_centre_master")) {
      const [ccId] = params;
      const cc = costCentres.find((c) => c.id === ccId && c.active_status === 1);
      return [cc ? [{ ...cc, cost_centre_name: "Cost Centre " + cc.id }] : [], []];
    }
    // vendor_master
    if (s.includes("FROM vendor_master")) {
      const [vendorId] = params;
      const vendor = vendors.find((v) => v.id === vendorId);
      return [vendor ? [vendor] : [], []];
    }
    if (s.startsWith("INSERT INTO grn_request")) {
      inserted.push({ sql: s, params });
      return [{ insertId: 1, affectedRows: 1 }, []];
    }
    if (s.startsWith("INSERT") || s.startsWith("UPDATE")) return [{ affectedRows: 1 }, []];
    if (s.startsWith("SELECT")) return [[], []];
    throw new Error(`Unhandled SQL in fake DB router: ${s.slice(0, 160)}`);
  }

  return { route, get inserted() { return inserted; } };
}

function budgetedLine(overrides: Partial<FakeLine> = {}): FakeLine {
  return {
    id: "line-A", budget_id: "hdr-1", branch_id: "br-1", period_code: "2026-08",
    head: "Office Supplies", sub_head: "Stationery", item_name: "Stationery",
    cost_centre_id: "cc-A", process_id: null, unit: "unit", unit_rate: 100,
    tax_treatment: "exclusive", gst_rate: 18, gst_type: "cgst_sgst", recoverable_tax_pct: 100,
    gross_amount: 21000, reserved_amount: 0, consumed_amount: 0, preferred_vendor_id: null,
    ...overrides,
  };
}

const VALID_PAYLOAD = {
  branchId: "br-1",
  grnType: "vendor" as const,
  budgetLineId: "line-A",
  billDate: "2026-08-05",
  quantity: 10,
  vendorId: "vendor-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  periodLocked.mockResolvedValue(false);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Type gate", () => {
  for (const type of ["provision", "salary"]) {
    it(`refuses to create a ${type} GRN`, async () => {
      stateRef.current = makeState({ lines: [budgetedLine()] });
      const { grnService } = await import("../grn.service.js");
      await expect(
        grnService.createDraft({ ...VALID_PAYLOAD, grnType: type as any }, "u1", "branch_admin")
      ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_SUPPORTED/) });
      expect(stateRef.current.inserted).toHaveLength(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Field-level validation", () => {
  const cases: Array<[string, object, RegExp]> = [
    ["missing branch", { branchId: "" }, /Branch is required/],
    ["no budget line and not flagged unbudgeted", { budgetLineId: undefined }, /approved budget line is required/],
    ["malformed bill date", { billDate: "05-08-2026" }, /valid bill\/receipt date/],
    ["zero quantity", { quantity: 0 }, /Quantity must be greater than zero/],
    ["negative quantity", { quantity: -1 }, /Quantity must be greater than zero/],
    ["payment terms not a whole number", { paymentTermsDays: 15.5 }, /whole number/],
    ["payment terms negative", { paymentTermsDays: -1 }, /whole number/],
    ["payment terms over 365", { paymentTermsDays: 400 }, /whole number/],
  ];
  for (const [label, patch, pattern] of cases) {
    it(`rejects ${label}`, async () => {
      stateRef.current = makeState({ lines: [budgetedLine()] });
      const { grnService } = await import("../grn.service.js");
      await expect(
        grnService.createDraft({ ...VALID_PAYLOAD, ...patch } as any, "u1", "branch_admin")
      ).rejects.toThrow(pattern);
    });
  }

  it("accepts a fully valid budgeted payload", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine()],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    const result = await grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin");
    expect(result.id).toBeTruthy();
    expect(stateRef.current.inserted).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Budget-line-specific checks", () => {
  it("refuses when the bill date falls outside the line's approved period", async () => {
    stateRef.current = makeState({ lines: [budgetedLine({ period_code: "2026-07" })] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin")
    ).rejects.toThrow(/Bill date must fall within approved budget period/);
  });

  it("accepts an explicit accountingPeriod override into a past, already-budgeted month", async () => {
    // The cut-off-booking case grn.routes.ts's periodOverrideRoles gate exists for: a bill dated
    // TODAY (the current month has no budget line yet) booked against a past month that IS
    // budgeted. Reaching createDraft with accountingPeriod set at all means the route already
    // verified the actor holds one of finance_head/accounts_head/branch_admin/super_admin.
    stateRef.current = makeState({
      lines: [budgetedLine({ period_code: "2026-07" })],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    const result = await grnService.createDraft(
      { ...VALID_PAYLOAD, billDate: "2026-08-05", accountingPeriod: "2026-07" },
      "u1",
      "branch_admin"
    );
    expect(result.id).toBeTruthy();
  });

  it("still refuses an accountingPeriod override that does not match any approved line period", async () => {
    stateRef.current = makeState({ lines: [budgetedLine({ period_code: "2026-07" })] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(
        { ...VALID_PAYLOAD, billDate: "2026-08-05", accountingPeriod: "2026-06" },
        "u1",
        "branch_admin"
      )
    ).rejects.toThrow(/Bill date must fall within approved budget period/);
  });

  it("refuses when the accounting period is locked for P&L close", async () => {
    stateRef.current = makeState({ lines: [budgetedLine()] });
    periodLocked.mockResolvedValue(true);
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin")
    ).rejects.toThrow(/locked for P&L close/);
  });

  it("refuses when the process does not match the line's own process", async () => {
    stateRef.current = makeState({ lines: [budgetedLine({ process_id: "proc-A" })] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, processId: "proc-B" } as any, "u1", "branch_admin")
    ).rejects.toThrow(/process does not match/);
  });

  it("refuses a unit rate above the approved rate", async () => {
    stateRef.current = makeState({ lines: [budgetedLine({ unit_rate: 100 })] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, unitRate: 150 } as any, "u1", "branch_admin")
    ).rejects.toThrow(/exceeds the approved budget rate/);
  });

  it("refuses a negative unit rate", async () => {
    stateRef.current = makeState({ lines: [budgetedLine()] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, unitRate: -10 } as any, "u1", "branch_admin")
    ).rejects.toThrow(/cannot be negative/);
  });

  it("a quantity far above the approved quantity is NOT refused — money is the only gate", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine({ gross_amount: 1_000_000, unit_rate: 100 })],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, quantity: 5000 } as any, "u1", "branch_admin")
    ).resolves.toMatchObject({ id: expect.any(String) });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Cost centre attribution (G1/G2 — the A-funded-by-B fix)", () => {
  it("A may raise against B's line, naming its OWN cost centre", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine({ cost_centre_id: "cc-B" })],
      costCentres: [{ id: "cc-A", branch_id: "br-1", active_status: 1 }],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    // This used to throw "GRN cost centre does not match the approved budget line" — the exact
    // defect that forced the A-funded-by-B case through the unbudgeted door.
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, costCentreId: "cc-A" } as any, "u1", "branch_admin")
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("still refuses a cost centre from another branch — the one thing no later step re-checks", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine({ cost_centre_id: "cc-B" })],
      costCentres: [{ id: "cc-OTHER", branch_id: "br-2", active_status: 1 }],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, costCentreId: "cc-OTHER" } as any, "u1", "branch_admin")
    ).rejects.toThrow(/does not belong to this branch/);
  });

  it("refuses a cost centre that does not exist or is inactive", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine({ cost_centre_id: "cc-B" })],
      costCentres: [],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, costCentreId: "cc-ghost" } as any, "u1", "branch_admin")
    ).rejects.toThrow(/not found or inactive/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Branch-wide headroom gate at create (G7 — agrees with the allocation step)", () => {
  it("NO_BRANCH_BUDGET when there is no active header at all for the branch/period", async () => {
    stateRef.current = makeState({ headerActive: false, lines: [budgetedLine()] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin")
    ).rejects.toMatchObject({ code: "NO_BRANCH_BUDGET" });
  });

  it("succeeds when the PICKED line is short but a SIBLING line for the same head/sub-head covers the rest", async () => {
    // Before the branch-aggregate fix, create checked only the picked line and would have
    // refused this — while the allocation step, one screen later, would have spilled onto the
    // sibling without comment. The two steps had to agree.
    stateRef.current = makeState({
      lines: [
        budgetedLine({ id: "line-A", gross_amount: 500 }),
        budgetedLine({ id: "line-B", cost_centre_id: "cc-B", gross_amount: 5000 }),
      ],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin")
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("HEADROOM_EXCEEDED when the whole branch aggregate cannot cover it", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine({ gross_amount: 50 })],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin")
    ).rejects.toMatchObject({ code: "HEADROOM_EXCEEDED" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Sub-head closure (G6 — moved forward from Branch Head approval to create)", () => {
  it("refuses new spend on a head/sub-head Finance has closed for the month", async () => {
    stateRef.current = makeState({ lines: [budgetedLine()], subheadClosed: true });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin")
    ).rejects.toThrow(/closed for this month/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Tax basis at create (G15 — the reported '₹21,000 budget refuses a ₹21,000 invoice' bug)", () => {
  it("a non_gst line is weighed on the TAXABLE value, not the tax-inclusive total", async () => {
    // 200 units x Rs 100 = Rs 20,000 taxable, fits a Rs 21,000 non-taxable plan. The GST-inclusive
    // total (23,600 at 18%) does not fit, and weighing THAT is exactly the bug that was reported.
    stateRef.current = makeState({
      lines: [budgetedLine({
        gross_amount: 21000, tax_treatment: "non_gst", gst_rate: 18, unit_rate: 100,
      })],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, quantity: 200 } as any, "u1", "branch_admin")
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("still refuses when the taxable value ITSELF exceeds the plan — only the tax is excused", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine({ gross_amount: 21000, tax_treatment: "non_gst", gst_rate: 18, unit_rate: 100 })],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, quantity: 250 } as any, "u1", "branch_admin")
    ).rejects.toMatchObject({ code: "HEADROOM_EXCEEDED" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Vendor resolution", () => {
  it("a vendor GRN with no vendor at all is refused", async () => {
    stateRef.current = makeState({ lines: [budgetedLine()] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, vendorId: undefined } as any, "u1", "branch_admin")
    ).rejects.toThrow(/Vendor GRN requires an active vendor/);
  });

  it("falls back to the line's preferred vendor when none is supplied", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine({ preferred_vendor_id: "vendor-2" })],
      vendors: [{ id: "vendor-2", vendor_name: "Preferred Co", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, vendorId: undefined } as any, "u1", "branch_admin")
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("refuses a vendor not found in Vendor Master", async () => {
    stateRef.current = makeState({ lines: [budgetedLine()], vendors: [] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin")
    ).rejects.toThrow(/not found in Vendor Master/);
  });

  it("refuses an inactive vendor", async () => {
    stateRef.current = makeState({
      lines: [budgetedLine()],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 0 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(VALID_PAYLOAD, "u1", "branch_admin")
    ).rejects.toThrow(/inactive and cannot be used/);
  });

  it("an imprest GRN needs no vendor at all", async () => {
    stateRef.current = makeState({ lines: [budgetedLine()] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...VALID_PAYLOAD, grnType: "imprest", vendorId: undefined } as any, "u1", "branch_admin")
    ).resolves.toMatchObject({ id: expect.any(String) });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Unbudgeted create path", () => {
  const UNBUDGETED_PAYLOAD = {
    branchId: "br-1",
    grnType: "vendor" as const,
    isUnbudgeted: true,
    head: "Office Rent",
    subHead: "Office Rent",
    costCentreId: "cc-A",
    billDate: "2026-08-05",
    quantity: 1,
    vendorId: "vendor-1",
  };

  it("requires head, sub-head and a cost centre", async () => {
    stateRef.current = makeState({});
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft({ ...UNBUDGETED_PAYLOAD, head: "" } as any, "u1", "branch_admin")
    ).rejects.toThrow(/expense head is required/);
    await expect(
      grnService.createDraft({ ...UNBUDGETED_PAYLOAD, subHead: "" } as any, "u1", "branch_admin")
    ).rejects.toThrow(/expense sub-head is required/);
    await expect(
      grnService.createDraft({ ...UNBUDGETED_PAYLOAD, costCentreId: "" } as any, "u1", "branch_admin")
    ).rejects.toThrow(/cost centre is required/);
  });

  it("is checked against branch coverage too (G3) — refuses when the branch has none for this head/sub-head", async () => {
    stateRef.current = makeState({ headerActive: true, lines: [], costCentres: [{ id: "cc-A", branch_id: "br-1", active_status: 1 }] });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(UNBUDGETED_PAYLOAD, "u1", "branch_admin")
    ).rejects.toMatchObject({ code: "NO_BUDGET_FOR_HEAD" });
  });

  it("succeeds when the branch DOES have budget for this head/sub-head, even with no line named", async () => {
    stateRef.current = makeState({
      headerActive: true,
      lines: [budgetedLine({ head: "Office Rent", sub_head: "Office Rent", cost_centre_id: "cc-B", gross_amount: 50000 })],
      costCentres: [{ id: "cc-A", branch_id: "br-1", active_status: 1 }],
      vendors: [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(UNBUDGETED_PAYLOAD, "u1", "branch_admin")
    ).resolves.toMatchObject({ id: expect.any(String), grnNumber: null });
  });

  it("refuses a cost centre from another branch on the unbudgeted path too", async () => {
    stateRef.current = makeState({
      headerActive: true,
      lines: [budgetedLine({ head: "Office Rent", sub_head: "Office Rent" })],
      costCentres: [{ id: "cc-A", branch_id: "br-2", active_status: 1 }],
    });
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(UNBUDGETED_PAYLOAD, "u1", "branch_admin")
    ).rejects.toThrow(/does not belong to this branch/);
  });

  it("respects period lock on the unbudgeted path", async () => {
    stateRef.current = makeState({
      headerActive: true,
      lines: [budgetedLine({ head: "Office Rent", sub_head: "Office Rent", gross_amount: 50000 })],
      costCentres: [{ id: "cc-A", branch_id: "br-1", active_status: 1 }],
    });
    periodLocked.mockResolvedValue(true);
    const { grnService } = await import("../grn.service.js");
    await expect(
      grnService.createDraft(UNBUDGETED_PAYLOAD, "u1", "branch_admin")
    ).rejects.toThrow(/locked for P&L close/);
  });
});
