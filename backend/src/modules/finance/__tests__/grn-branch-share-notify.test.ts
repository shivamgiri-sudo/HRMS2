import { beforeEach, describe, expect, it, vi } from "vitest";

/** Final approval of a split Head Office GRN tells each receiving branch's Branch Head — alert only. */
const { execute, holders, createItem } = vi.hoisted(() => ({ execute: vi.fn(), holders: vi.fn(), createItem: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds: holders }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem } }));
import { notifyBranchShares } from "../grn-notify.js";

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[
    { branch_id: "br-A", branch_name: "NOIDA-2", amount: 708, cost_centres: "BSS/BO/NOIDA-2/577" },
    { branch_id: "br-B", branch_name: "DELHI", amount: 472, cost_centres: "BSS/BO/DELHI/301" },
  ], []]);
  holders.mockReset().mockImplementation(async (role: string, branch: string) => [`${role}:${branch}`]);
  createItem.mockReset().mockResolvedValue(undefined);
});

describe("notifyBranchShares", () => {
  it("one bell item per receiving branch's Branch Head, with their own amount and cost centre", async () => {
    await notifyBranchShares("g1", "Mas/1/26/9", "Vendor X");
    expect(createItem).toHaveBeenCalledTimes(2);
    const a = createItem.mock.calls.map((c) => c[0]).find((i) => i.user_id === "branch_head:br-A");
    expect(a.title).toContain("NOIDA-2");
    expect(a.title).toContain("708");
    expect(a.description).toContain("BSS/BO/NOIDA-2/577");
    expect(a).toMatchObject({ type: "grn_branch_share", entity_id: "g1", priority: "medium" });
    expect(createItem.mock.calls.map((c) => c[0].user_id).sort()).toEqual(["branch_head:br-A", "branch_head:br-B"]);
  });

  it("never throws: a notification failure must not block the approval", async () => {
    execute.mockRejectedValue(new Error("db down"));
    await expect(notifyBranchShares("g1", null, null)).resolves.toBeUndefined();
  });
});
