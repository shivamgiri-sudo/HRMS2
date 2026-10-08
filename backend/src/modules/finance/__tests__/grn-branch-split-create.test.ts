import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Head Office GRN to be split across branches: createDraft() with `branchSplit` (2026-10-07). Same
 * faked DB as grn-create-draft.test.ts, plus the Head Office check. Original header follows.
 *
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

vi.mock("../grn-head-office-bypass.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../grn-head-office-bypass.js")>()),
  isHeadOfficeBranch: vi.fn(async (id: string | null | undefined) => String(id) === "ho-1"),
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

const PAYLOAD = {
  branchId: "ho-1", grnType: "vendor" as const, branchSplit: true, head: "Admin", subHead: "Rent",
  billDate: "2026-08-05", quantity: 0.0001, vendorId: "vendor-1",
};
const vendors = [{ id: "vendor-1", vendor_name: "Acme", is_active: 1 }];

beforeEach(() => {
  vi.clearAllMocks();
  periodLocked.mockResolvedValue(false);
  process.env.GRN_BRANCH_SPLIT_ENABLED = "true";
});

describe("createDraft — Head Office GRN to be split across branches", () => {
  it("creates with a head/sub-head only: no cost centre, and Head Office's own budget is never consulted", async () => {
    // No budget header, no lines, no cost centres at Head Office at all.
    stateRef.current = makeState({ headerActive: false, lines: [], costCentres: [], vendors });
    const { grnService } = await import("../grn.service.js");
    const result = await grnService.createDraft(PAYLOAD, "u1", "finance_head", ["finance_head"]);
    expect(result.id).toBeTruthy();
    const [insert] = stateRef.current.inserted;
    expect(insert.sql).toContain("is_unbudgeted");
    expect(insert.params).toContain("ho-1");
    expect(insert.params).toContain(null); // cost_centre_id
    expect(insert.params).toContain("Admin - Rent (Head Office bill split across branches)");
  });

  it("the ordinary unbudgeted path is unchanged: it still needs a cost centre and Head Office budget", async () => {
    stateRef.current = makeState({ headerActive: false, lines: [], costCentres: [], vendors });
    const { grnService } = await import("../grn.service.js");
    await expect(grnService.createDraft({ ...PAYLOAD, branchSplit: undefined, isUnbudgeted: true }, "u1", "finance_head", ["finance_head"]))
      .rejects.toThrow(/cost centre is required/);
  });

  it("refused for anyone but the Finance Head / super admin, off Head Office, for imprest, and while the flag is off", async () => {
    stateRef.current = makeState({ vendors });
    const { grnService } = await import("../grn.service.js");
    await expect(grnService.createDraft(PAYLOAD, "u1", "branch_head", ["branch_head"])).rejects.toMatchObject({ code: "BRANCH_SPLIT_ROLE" });
    await expect(grnService.createDraft({ ...PAYLOAD, branchId: "br-1" }, "u1", "finance_head", ["finance_head"])).rejects.toMatchObject({ code: "BRANCH_SPLIT_HEAD_OFFICE_ONLY" });
    await expect(grnService.createDraft({ ...PAYLOAD, grnType: "imprest" as const }, "u1", "finance_head", ["finance_head"])).rejects.toMatchObject({ code: "BRANCH_SPLIT_VENDOR_ONLY" });
    process.env.GRN_BRANCH_SPLIT_ENABLED = "false";
    await expect(grnService.createDraft(PAYLOAD, "u1", "finance_head", ["finance_head"])).rejects.toMatchObject({ code: "BRANCH_SPLIT_DISABLED" });
    expect(stateRef.current.inserted).toHaveLength(0);
  });

  it("still validates the rest: head, sub-head, bill date, period lock", async () => {
    stateRef.current = makeState({ vendors });
    const { grnService } = await import("../grn.service.js");
    await expect(grnService.createDraft({ ...PAYLOAD, head: "" }, "u1", "finance_head", ["finance_head"])).rejects.toThrow(/expense head is required/);
    await expect(grnService.createDraft({ ...PAYLOAD, billDate: "05-08-2026" }, "u1", "finance_head", ["finance_head"])).rejects.toThrow(/valid bill/);
    periodLocked.mockResolvedValue(true);
    await expect(grnService.createDraft(PAYLOAD, "u1", "finance_head", ["finance_head"])).rejects.toThrow(/locked for P&L close/);
  });
});
