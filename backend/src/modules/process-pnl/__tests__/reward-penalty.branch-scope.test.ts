import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-01: cost_centre_reward_penalty reads (listRewardPenalty, getRewardPenaltySummary) were
 * company-wide whenever the caller omitted costCentreId, even for branch_head/process_manager
 * — both are in RP_READ_ROLES. A resolved FinanceBranchScope must now confine the query to the
 * caller's own branch(es); a global scope ({mode:"all"}) must behave exactly as before.
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
  execute.mockResolvedValue([[], []]);
});

describe("listRewardPenalty branch scoping", () => {
  it("adds no branch filter and keeps the LEFT JOIN when scope is company-wide", async () => {
    const { listRewardPenalty } = await import("../reward-penalty.service.js");
    await listRewardPenalty("2026-08", undefined, { mode: "all" });

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("LEFT JOIN cost_centre_master");
    expect(String(sql)).not.toContain("ccm.branch_id IN");
    expect(params).toEqual(["2026-08"]);
  });

  it("switches to an INNER JOIN filtered to the caller's branches when scope is branch-bound", async () => {
    const { listRewardPenalty } = await import("../reward-penalty.service.js");
    await listRewardPenalty("2026-08", undefined, { mode: "branches", branchIds: ["branch-1"] });

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("INNER JOIN cost_centre_master");
    expect(String(sql)).toContain("ccm.branch_id IN (?)");
    expect(params).toEqual(["2026-08", "branch-1"]);
  });
});

describe("getRewardPenaltySummary branch scoping", () => {
  it("switches to an INNER JOIN filtered to the caller's branches when scope is branch-bound", async () => {
    const { getRewardPenaltySummary } = await import("../reward-penalty.service.js");
    await getRewardPenaltySummary("2026-08", { mode: "branches", branchIds: ["branch-1", "branch-2"] });

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("INNER JOIN cost_centre_master");
    expect(String(sql)).toContain("ccm.branch_id IN (?, ?)");
    expect(params).toEqual(["2026-08", "branch-1", "branch-2"]);
  });

  it("keeps the unfiltered LEFT JOIN when scope is company-wide", async () => {
    const { getRewardPenaltySummary } = await import("../reward-penalty.service.js");
    await getRewardPenaltySummary("2026-08", { mode: "all" });

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("LEFT JOIN cost_centre_master");
    expect(params).toEqual(["2026-08"]);
  });
});
