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
  /** Rows for the billing-completeness probe: invoice lines and value per period, per branch. */
  billing?: { period_code: string; branch_id: string | null; line_count: number; amount: number }[];
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
    // The completeness probe is the only query asking for a per-period line count, so it must be
    // matched BEFORE the generic revenue branch below or it would be handed revenue-shaped rows.
    if (q.includes("COUNT(*) AS line_count")) return [f.billing ?? [], []];
    if (q.includes("billing_invoice_particular_snapshot")) return [f.revenue ?? [], []];
    if (q.includes("salary_prep_line") && q.includes("zero_paid")) return [[{ zero_paid: 0 }], []];
    if (q.includes("salary_prep_line")) return [f.people ?? [], []];
    // The branch-overhead comparison asks for one scalar; spendByBranch groups by branch.
    if (q.includes("grn_entry_line_snapshot") && q.includes("COALESCE(SUM(l.amount), 0) AS a")) {
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

  it("hides a closed branch whose every money column is zero, without losing its people", async () => {
    /*
     * branch_master holds 45 branches and 5 are active. In July 2026 nine closed ones still
     * reached the table — KARNAL, Delhi Office, MOHALI, AHEMDABAD HOUSE, MEERUT, HYDERABAD,
     * JAIPUR and both Head Office duplicates — carrying 234 people and Rs 0 in every money column.
     * They are removed from the comparison, NOT from the analysis or the headcount.
     */
    mockDb({
      branches: [
        { id: "n", branch_name: "NOIDA", active_status: 1 },
        { id: "k", branch_name: "KARNAL", active_status: 0 },
        { id: "d", branch_name: "Delhi Office", active_status: 0 },
      ],
      revenue: [{ branch_id: "n", amount: L(127.4) }],
      people: [
        { branch_id: "n", staff: 464, cost: L(80.36) },
        { branch_id: "k", staff: 50, cost: 0 },
        { branch_id: "d", staff: 51, cost: 0 },
      ],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06");

    expect(out.branches.map((b) => b.branchName)).toEqual(["NOIDA"]);
    expect(out.closedBranchesHidden.map((b) => b.branchName).sort()).toEqual(["Delhi Office", "KARNAL"]);
    expect(out.closedBranchesHidden.reduce((t, b) => t + b.staffPaid, 0)).toBe(101);
    // Still counted, still found: hiding a row from a table is not the same as deleting it.
    expect(out.staffPaid, "company headcount must not move because a row was hidden").toBe(565);
    expect(out.opportunities.find((o) => o.id === "zero-paid")?.value).toBe("101");
  });

  it("keeps a closed branch that is still spending", async () => {
    // Money still leaving a branch that closed is a finding, not clutter. Only the all-zero rows go.
    mockDb({
      branches: [{ id: "m", branch_name: "MOHALI", active_status: 0 }],
      spend: [{ branch_id: "m", amount: L(2.4) }],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06");
    expect(out.branches.map((b) => b.branchName)).toEqual(["MOHALI"]);
    expect(out.closedBranchesHidden).toHaveLength(0);
    expect(out.opportunities.some((o) => o.id.startsWith("closed-spend"))).toBe(true);
  });

  it("refuses a malformed period without querying", async () => {
    mockDb({ branches: [] });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("Jun-26");
    expect(out.branches).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("billing completeness — an unfinished month is not a bad month", () => {
  /*
   * MAS bills in arrears: June 2026's Rs 372.07 lakh was assembled from invoices dated June
   * (Rs 218.32 lakh) plus invoices dated July (Rs 150.08 lakh). Read on 7 August, July therefore
   * showed NOIDA at Rs 1.31 lakh of revenue against Rs 80.36 lakh of payroll — a Rs 96.9 lakh loss
   * on a branch that had billed Rs 127.40 lakh the month before. One of its seventeen cost centres
   * had been invoiced; the rest had simply not been raised.
   */
  const juneBaseline = (branch: string, lines: number, amount: number) =>
    ["2026-04", "2026-05", "2026-06"].map((period_code) => ({ period_code, branch_id: branch, line_count: lines, amount }));

  it("flags a month billed far below its own recent norm, and names the branch that is missing", async () => {
    mockDb({
      branches: [
        { id: "n", branch_name: "NOIDA", active_status: 1 },
        { id: "n2", branch_name: "NOIDA-2", active_status: 1 },
      ],
      revenue: [{ branch_id: "n", amount: L(1.31) }, { branch_id: "n2", amount: L(93.39) }],
      people: [{ branch_id: "n", staff: 464, cost: L(80.36) }],
      billing: [
        ...juneBaseline("n", 53, L(127.4)),
        ...juneBaseline("n2", 14, L(117.45)),
        { period_code: "2026-07", branch_id: "n", line_count: 2, amount: L(1.31) },
        { period_code: "2026-07", branch_id: "n2", line_count: 5, amount: L(93.39) },
      ],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-07");

    expect(out.billing.incomplete, "7 lines against a 67-line norm is an unfinished month").toBe(true);
    expect(out.billing.lines).toBe(7);
    expect(out.billing.baselineLines).toBeCloseTo(67, 0);
    expect(out.billing.gaps.map((g) => g.branchName), "NOIDA is 1% of its norm; NOIDA-2 is 79%").toEqual(["NOIDA"]);
    expect(out.billing.gaps[0].baselineRevenue).toBeCloseTo(L(127.4), 0);
    // The figures themselves are untouched — an estimate on a P&L is worse than an incomplete fact.
    expect(out.branches.find((b) => b.branchName === "NOIDA")?.revenue).toBeCloseTo(L(1.31), 0);
  });

  it("stays silent on a month that billed normally", async () => {
    mockDb({
      branches: [{ id: "n", branch_name: "NOIDA", active_status: 1 }],
      revenue: [{ branch_id: "n", amount: L(127.4) }],
      billing: [
        ...juneBaseline("n", 53, L(127.4)),
        { period_code: "2026-07", branch_id: "n", line_count: 51, amount: L(126.0) },
      ],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-07");
    expect(out.billing.incomplete).toBe(false);
    expect(out.billing.gaps).toHaveLength(0);
  });

  it("says nothing when there is too little history to judge", async () => {
    // A new period with a two-line baseline proves nothing; guessing would be worse than silence.
    mockDb({
      branches: [{ id: "n", branch_name: "NOIDA", active_status: 1 }],
      revenue: [{ branch_id: "n", amount: L(1) }],
      billing: [
        { period_code: "2026-06", branch_id: "n", line_count: 2, amount: L(2) },
        { period_code: "2026-07", branch_id: "n", line_count: 1, amount: L(1) },
      ],
    });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    expect((await getCeoOverview("2026-07")).billing.incomplete).toBe(false);
  });
});

describe("multi-select filters", () => {
  const three = {
    branches: [
      { id: "a", branch_name: "NOIDA", active_status: 1 },
      { id: "b", branch_name: "NOIDA-2", active_status: 1 },
      { id: "c", branch_name: "AHMEDABAD-JALDARSHAN", active_status: 1 },
    ],
    revenue: [
      { branch_id: "a", amount: L(127.4) }, { branch_id: "b", amount: L(117.45) },
      { branch_id: "c", amount: L(49.41) },
    ],
    people: [
      { branch_id: "a", staff: 464, cost: L(80.36) }, { branch_id: "b", staff: 460, cost: L(58.95) },
      { branch_id: "c", staff: 293, cost: L(18.6) },
    ],
  };

  it("returns every selected branch, not just the first", async () => {
    mockDb(three);
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06", { branchIds: ["a", "b"] });
    expect(out.branches.map((b) => b.branchName).sort()).toEqual(["NOIDA", "NOIDA-2"]);
    expect(out.revenue, "totals cover the selection, not the company").toBeCloseTo(L(244.85), 0);
  });

  it("folds the singular branchId into the list rather than ignoring either", async () => {
    // The branch-scope resolver still passes branchId; a selection must not silently drop it.
    mockDb(three);
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const out = await getCeoOverview("2026-06", { branchId: "c", branchIds: ["a"] });
    expect(out.branches.map((b) => b.branchName).sort()).toEqual(["AHMEDABAD-JALDARSHAN", "NOIDA"]);
  });

  it("shows no focus panel for a multi-process selection", async () => {
    /*
     * The focus panel is one entity's P&L with caveats attached — "the indirect figure is really
     * the whole branch's overhead" is a statement about one cost centre. Under a selection of two
     * it would carry one label and two entities' arithmetic, which reads as a fact about the first.
     */
    mockDb(three);
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    expect((await getCeoOverview("2026-06", { processIds: ["p1", "p2"] })).focus).toBeNull();
    expect((await getCeoOverview("2026-06", { processIds: ["p1"] })).focus).not.toBeNull();
  });

  it("suppresses company-wide findings under any selection", async () => {
    mockDb(three);
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    expect((await getCeoOverview("2026-06", { branchIds: ["a", "b"] })).opportunities).toHaveLength(0);
  });
});

describe("filter options — active + branch scoped (bug fix)", () => {
  /*
   * Two defects, both in filterOptions(): (1) the cost-centre option query never checked
   * active_status at all (the process query already did), so a deactivated cost centre stayed
   * offered in the dropdown forever; (2) filterOptions() was the one query called without the
   * caller's own `scope` — every sibling query beside it (revenueByBranch, peopleByBranch,
   * spendByBranch, marginTrend) already receives it — so selecting a branch anywhere else on the
   * page never narrowed either the Process or Cost Centre dropdown. These tests assert on the
   * actual SQL/params handed to `execute`, not on returned row content, since the shared mockDb
   * fixture doesn't discriminate branch-scoped rows from unscoped ones — the point here is
   * confirming what's ASKED of the database, matching how the fix was verified before it shipped.
   */
  const branches = [
    { id: "a", branch_name: "NOIDA", active_status: 1 },
    { id: "b", branch_name: "NOIDA-2", active_status: 1 },
    { id: "c", branch_name: "AHMEDABAD-JALDARSHAN", active_status: 1 },
  ];

  function findCall(substring: string) {
    const call = execute.mock.calls.find(([sql]) => String(sql).includes(substring));
    if (!call) throw new Error(`No execute() call matched: ${substring}`);
    return { sql: String(call[0]), params: call[1] as unknown[] };
  }

  it("cost-centre options now filter on active_status = 1 (previously missing entirely)", async () => {
    mockDb({ branches });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    await getCeoOverview("2026-06", {});
    const { sql } = findCall("ccm.cost_centre_code AS code");
    expect(sql).toContain("ccm.active_status = 1");
  });

  it("no branch selected: neither option query filters by branch_id", async () => {
    mockDb({ branches });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    await getCeoOverview("2026-06", {});
    expect(findCall("pm.process_name AS name").sql).not.toContain("branch_id IN");
    expect(findCall("ccm.cost_centre_code AS code").sql).not.toContain("branch_id IN");
  });

  it("branch selected: both option queries filter by that branch, params bound in order", async () => {
    mockDb({ branches });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    await getCeoOverview("2026-06", { branchIds: ["a", "b"] });

    const processCall = findCall("pm.process_name AS name");
    expect(processCall.sql).toContain("pm.branch_id IN (?,?)");
    expect(processCall.params).toEqual(["2026-06", "a", "b"]);

    const ccCall = findCall("ccm.cost_centre_code AS code");
    expect(ccCall.sql).toContain("ccm.branch_id IN (?,?)");
    expect(ccCall.params).toEqual(["2026-06", "a", "b"]);
  });

  it("singular branchId still narrows the option queries (folded into scope like everywhere else)", async () => {
    mockDb({ branches });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    await getCeoOverview("2026-06", { branchId: "c" });
    expect(findCall("pm.process_name AS name").params).toEqual(["2026-06", "c"]);
    expect(findCall("ccm.cost_centre_code AS code").params).toEqual(["2026-06", "c"]);
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

describe("legal entity — this page is one company's P&L, not a consolidation", () => {
  /*
   * cost_centre_master.company_name carries the entity, and the page had been consolidating three:
   * Mas Callnet, IDC and (via NOIDA-DIALDESK) Ispark Dataconnect. IDC contributed Rs 76.32 lakh of
   * June revenue across 38 cost centres and NOT ONE employee, which lifted the reported margin to
   * 17.8% when MAS Callnet standalone was running at minus 1.6%.
   */
  it("confines revenue and indirect cost to this company's cost centres", async () => {
    mockDb({ branches: [{ id: "b", branch_name: "NOIDA", active_status: 1 }] });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    await getCeoOverview("2026-06");
    const sql = execute.mock.calls.map((c) => String(c[0]));
    const revenue = sql.find((q) => q.includes("billing_invoice_particular_snapshot") && q.includes("GROUP BY"));
    const spend = sql.find((q) => q.includes("grn_entry_line_snapshot") && q.includes("GROUP BY"));
    expect(revenue, "revenue must be filtered to our own company").toMatch(/mascallnet/i);
    expect(spend, "indirect cost must be filtered to our own company").toMatch(/mascallnet/i);
  });

  it("does NOT filter payroll by company", async () => {
    /*
     * Every employee in this system is MAS Callnet's — all 937 active staff with a cost centre map
     * to it and IDC has none at all — while 368 paid employees carry no cost centre and sit in MAS
     * Callnet branches. Filtering payroll the same way would silently drop Rs 17.60 lakh of real
     * wages for want of a mapping, and understate the loss.
     */
    mockDb({ branches: [{ id: "b", branch_name: "NOIDA", active_status: 1 }] });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    await getCeoOverview("2026-06");
    const payroll = execute.mock.calls.map((c) => String(c[0]))
      .find((q) => q.includes("salary_prep_line") && q.includes("GROUP BY e.branch_id"));
    expect(payroll).toBeDefined();
    expect(payroll, "payroll must not be confined by cost-centre company").not.toMatch(/mascallnet/i);
  });

  it("matches the company however the source spells it", async () => {
    // The source uses four spellings: "MAS Call Net India Pvt Ltd", "Mas Callnet India Pvt. Ltd.",
    // "Mas Callnet India Pvt Ltd", "MAS CALLNET INDIA PVT LTD."
    mockDb({ branches: [{ id: "b", branch_name: "NOIDA", active_status: 1 }] });
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    await getCeoOverview("2026-06");
    const revenue = execute.mock.calls.map((c) => String(c[0]))
      .find((q) => q.includes("billing_invoice_particular_snapshot") && q.includes("GROUP BY"))!;
    expect(revenue).toContain("LOWER(");
    expect(revenue, "spaces and full stops must be stripped before matching").toContain("REPLACE(");
  });
});
