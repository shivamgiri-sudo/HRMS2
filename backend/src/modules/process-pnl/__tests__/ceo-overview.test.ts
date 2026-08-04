import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The CEO overview — branch comparison and the ranked list of where profit is leaking.
 *
 * Three defects were found by running this against production before it shipped, and each one
 * produced a believable number rather than an error. They are the tests below:
 *
 *   1. branch_master holds three rows spelling Head Office three ways, so the overview listed it
 *      twice — once as a cost centre, once as closed — and split its headcount between them.
 *   2. The budget mirror carries a branch NAME, so joining it to those three rows counted Head
 *      Office's budget three times and reported a Rs 32.51 lakh underspend against a real
 *      Rs 11.88 lakh.
 *   3. The cost-ratio comparison picked NOIDA-DIALDESK as the benchmark to beat — a branch with no
 *      payroll attributed at all, whose ratios only look good because a whole cost line is absent.
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists, queryRows: vi.fn() }));

interface Fixture {
  branches: { id: string; branch_name: string; active_status: number }[];
  revenue?: { branch_id: string | null; amount: number }[];
  people?: { branch_id: string | null; staff: number; cost: number }[];
  spend?: { branch_id: string | null; amount: number }[];
  budget?: { branch_id: string | null; amount: number }[];
  /** Cost-centre code buildFocus should resolve to, and its branch's total GRN. */
  focusCode?: string;
  branchGrn?: number;
}

function mockDb(f: Fixture) {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("process_master")) return [[], []];
    if (q.includes("FROM branch_master") && !q.includes("JOIN")) return [f.branches, []];
    // buildFocus resolves the cost-centre code (and its branch) before it can check anything else.
    if (q.includes("FROM cost_centre_master WHERE id")) {
      return [[{ code: f.focusCode ?? "CC/TEST", branch_id: f.branches[0]?.id ?? null }], []];
    }
    if (q.includes("COUNT(*) AS n FROM billing_invoice_particular_snapshot")) return [[{ n: 3 }], []];
    if (q.includes("billing_invoice_particular_snapshot")) return [f.revenue ?? [], []];
    if (q.includes("salary_prep_line") && q.includes("zero_paid")) return [[{ zero_paid: 0 }], []];
    if (q.includes("salary_prep_line")) return [f.people ?? [], []];
    // The branch-overhead comparison asks for one scalar; spendByBranch groups by branch.
    if (q.includes("grn_entry_line_snapshot") && q.includes("COALESCE(SUM(l.total), 0) AS a")) {
      return [[{ a: f.branchGrn ?? (f.spend ?? []).reduce((t, r) => t + r.amount, 0) }], []];
    }
    if (q.includes("grn_entry_line_snapshot")) return [f.spend ?? [], []];
    if (q.includes("finance_budget_line_snapshot")) return [f.budget ?? [], []];
    return [[], []];
  });
}

const L = (lakhs: number) => lakhs * 100000;

beforeEach(() => vi.resetModules());

describe("CEO overview", () => {
  it("merges duplicate branch spellings into one row and one headcount", async () => {
    mockDb({
      branches: [
        { id: "h1", branch_name: "HEAD OFFICE", active_status: 1 },
        { id: "h2", branch_name: "Head Office", active_status: 0 },
        { id: "h3", branch_name: "HEAD OFFICE", active_status: 0 },
      ],
      people: [
        { branch_id: "h1", staff: 13, cost: L(6) },
        { branch_id: "h2", staff: 10, cost: L(4) },
        { branch_id: "h3", staff: 3, cost: L(2.47) },
      ],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06");
    expect(out.branches, "three spellings are one branch").toHaveLength(1);
    expect(out.branches[0].staffPaid, "headcount must not be split across the duplicates").toBe(26);
    expect(out.branches[0].peopleCost).toBeCloseTo(L(12.47), 0);
  });

  it("does not count a duplicated branch's budget more than once", async () => {
    // The budget query already collapses names to one id; this asserts the total that reaches the
    // consumer, which is what reported the false Rs 32.51 lakh underspend.
    mockDb({
      branches: [
        { id: "h1", branch_name: "HEAD OFFICE", active_status: 1 },
        { id: "h2", branch_name: "Head Office", active_status: 1 },
      ],
      spend: [{ branch_id: "h1", amount: L(7.41) }],
      budget: [{ branch_id: "h1", amount: L(10.31) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06");
    expect(out.branches[0].budget).toBeCloseTo(L(10.31), 0);
  });

  it("flags revenue with no payroll instead of reporting it as margin", async () => {
    mockDb({
      branches: [{ id: "d1", branch_name: "NOIDA-DIALDESK", active_status: 1 }],
      revenue: [{ branch_id: "d1", amount: L(25.92) }],
      spend: [{ branch_id: "d1", amount: L(3.38) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06");
    expect(out.branches[0].flag).toBe("no payroll attributed");
    const opp = out.opportunities.find((o) => o.id.startsWith("no-payroll"));
    expect(opp?.severity, "an 87% margin from a missing cost line is critical, not good news").toBe("critical");
  });

  it("never benchmarks against a branch whose cost line is missing", async () => {
    // NOIDA-DIALDESK looks like the most efficient branch precisely because it has no payroll.
    // Using it as the target would tell NOIDA-2 to reach a ratio nobody actually achieves.
    mockDb({
      branches: [
        { id: "a", branch_name: "NOIDA", active_status: 1 },
        { id: "b", branch_name: "NOIDA-2", active_status: 1 },
        { id: "c", branch_name: "NOIDA-DIALDESK", active_status: 1 },
      ],
      revenue: [
        { branch_id: "a", amount: L(177.4) }, { branch_id: "b", amount: L(117.45) },
        { branch_id: "c", amount: L(25.92) },
      ],
      people: [
        { branch_id: "a", staff: 496, cost: L(102.22) }, { branch_id: "b", staff: 448, cost: L(76.24) },
      ],
      spend: [
        { branch_id: "a", amount: L(27.32) }, { branch_id: "b", amount: L(24.93) },
        { branch_id: "c", amount: L(3.38) },
      ],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06");
    const gap = out.opportunities.find((o) => o.id === "indirect-gap");
    expect(gap?.title, "the benchmark must be NOIDA, not the branch with no payroll").toContain("NOIDA spends");
    expect(gap?.title).not.toContain("NOIDA-DIALDESK spends");
  });

  it("reports a branch that pays people but bills nobody as a cost centre, not a loss", async () => {
    mockDb({
      branches: [{ id: "h", branch_name: "HEAD OFFICE", active_status: 1 }],
      revenue: [{ branch_id: "h", amount: L(0.66) }],
      people: [{ branch_id: "h", staff: 26, cost: L(12.47) }],
      spend: [{ branch_id: "h", amount: L(7.41) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06");
    expect(out.branches[0].isCostCentre).toBe(true);
    expect(out.branches[0].marginPct, "a margin for Head Office would be nonsense").toBeNull();
  });

  it("counts staff paid nothing, and keeps them out of the money", async () => {
    mockDb({
      branches: [
        { id: "k", branch_name: "KARNAL", active_status: 0 },
        { id: "d", branch_name: "Delhi Office", active_status: 0 },
      ],
      people: [{ branch_id: "k", staff: 50, cost: 0 }, { branch_id: "d", staff: 51, cost: 0 }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06");
    expect(out.peopleCost).toBe(0);
    expect(out.staffPaid).toBe(101);
    const opp = out.opportunities.find((o) => o.id === "zero-paid");
    expect(opp?.value).toBe("101");
    expect(opp?.severity).toBe("critical");
  });

  it("omits branches where nothing happened at all", async () => {
    mockDb({ branches: [{ id: "x", branch_name: "DORMANT", active_status: 0 }] });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    expect((await getCeoOverview("2026-06")).branches).toHaveLength(0);
  });

  it("scopes to a single branch and suppresses company-wide findings", async () => {
    // A branch-restricted user must not be shown opportunities computed across branches they
    // cannot see.
    mockDb({
      branches: [
        { id: "a", branch_name: "NOIDA", active_status: 1 },
        { id: "b", branch_name: "NOIDA-2", active_status: 1 },
      ],
      revenue: [{ branch_id: "a", amount: L(177.4) }, { branch_id: "b", amount: L(117.45) }],
      people: [{ branch_id: "a", staff: 496, cost: L(102.22) }, { branch_id: "b", staff: 448, cost: L(76.24) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06", { branchId: "a" });
    expect(out.branches).toHaveLength(1);
    expect(out.branches[0].branchName).toBe("NOIDA");
    expect(out.opportunities).toHaveLength(0);
  });

  it("refuses a malformed period without querying", async () => {
    mockDb({ branches: [] });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("Jun-26");
    expect(out.branches).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("focus panel — the caveats are the point", () => {
  it("warns when a cost centre carries its whole branch's overhead", async () => {
    /*
     * Onfido's June margin of 37% is real, but its indirect line is the ENTIRE NOIDA-2 branch GRN
     * booked against one cost centre — the only sibling, /577, shows Rs 0. Without the note the
     * figure reads as a standalone P&L, which it is not.
     */
    mockDb({
      branches: [{ id: "b", branch_name: "NOIDA-2", active_status: 1 }],
      revenue: [{ branch_id: "b", amount: L(90.39) }],
      people: [{ branch_id: "b", staff: 220, cost: L(32.05) }],
      spend: [{ branch_id: "b", amount: L(24.93) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06", { costCentreId: "cc-576" });
    expect(out.focus).not.toBeNull();
    expect(out.focus!.marginPct).toBeCloseTo(37.0, 0);
    expect(
      out.focus!.notes.join(" "),
      "a contribution margin must not be presented as a standalone P&L",
    ).toMatch(/whole branch's overhead/i);
  });

  it("says so when revenue is billed with no payroll behind it", async () => {
    mockDb({
      branches: [{ id: "d", branch_name: "NOIDA-DIALDESK", active_status: 1 }],
      revenue: [{ branch_id: "d", amount: L(25.92) }],
      spend: [{ branch_id: "d", amount: L(3.38) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06", { costCentreId: "cc-dd" });
    expect(out.focus!.notes.join(" ")).toMatch(/no payroll is attributed/i);
  });

  it("says so when people are paid with no invoice against them", async () => {
    mockDb({
      branches: [{ id: "x", branch_name: "SOMEWHERE", active_status: 1 }],
      people: [{ branch_id: "x", staff: 40, cost: L(8) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06", { costCentreId: "cc-x" });
    expect(out.focus!.notes.join(" ")).toMatch(/no invoice maps to it/i);
    expect(out.focus!.marginPct, "no revenue means no margin, not a 0% one").toBeNull();
  });

  it("is absent entirely when nothing is filtered", async () => {
    mockDb({
      branches: [{ id: "b", branch_name: "NOIDA", active_status: 1 }],
      revenue: [{ branch_id: "b", amount: L(100) }],
      people: [{ branch_id: "b", staff: 10, cost: L(50) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    expect((await getCeoOverview("2026-06")).focus).toBeNull();
  });
});
