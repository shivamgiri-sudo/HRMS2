import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));
vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: async () => ({ roleKeys: ["manager"], primaryRole: "manager" }),
  resolvePrimaryRole: (roles: string[]) => roles[0] ?? "employee",
}));
vi.mock("../../work-inbox/work-inbox.service.js", () => ({
  getDerivedRegistryItems: async () => [],
}));

import { getMyPending } from "../inbox.service.js";

describe("getMyPending — work_item mapping carries item_type", () => {
  beforeEach(() => mockExecute.mockReset());

  it("includes item_type on a work_item-sourced PendingTask", async () => {
    // tat rows, inbox rows, then work_item rows, matching the three sequential
    // db.execute calls inside getMyPending's Promise chain for these sources.
    mockExecute
      .mockResolvedValueOnce([[]]) // roleRows
      .mockResolvedValueOnce([[]]) // empRows
      .mockResolvedValueOnce([[]]) // tat
      .mockResolvedValueOnce([[]]) // work_inbox_item
      .mockResolvedValueOnce([
        [
          {
            id: "wi-1",
            module: "attendance",
            item_type: "AWOL_SUSPECTED",
            title: "Confirm absconding: Jane Doe",
            entity_type: "employee",
            entity_id: "emp-1",
            priority: "high",
            due_at: null,
            created_at: new Date().toISOString(),
          },
        ],
      ]); // work_item

    const { items } = await getMyPending("user-1");
    const awolItem = items.find((i) => i.id === "wi-1");
    expect(awolItem?.item_type).toBe("AWOL_SUSPECTED");
  });
});
