import { describe, expect, it } from "vitest";
import { createSavedView, deleteSavedView, listSavedViews } from "../saved-view.service.js";

interface FakeRow {
  id: string;
  user_id: string;
  module_key: string;
  view_name: string;
  config_json: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function fakeExecutor(seed: FakeRow[] = []) {
  const rows = [...seed];
  let counter = 0;
  return {
    rows,
    async execute(sql: string, params?: unknown[]) {
      if (sql.startsWith("SELECT * FROM finance_saved_view WHERE user_id = ? AND module_key = ?")) {
        const [userId, moduleKey] = params as [string, string];
        return [
          rows
            .filter((r) => r.user_id === userId && r.module_key === moduleKey)
            .sort((a, b) => (a.view_name > b.view_name ? 1 : -1)),
          [],
        ];
      }
      if (sql.startsWith("SELECT id FROM finance_saved_view WHERE user_id = ? AND module_key = ? AND view_name = ?")) {
        const [userId, moduleKey, viewName] = params as [string, string, string];
        const match = rows.find((r) => r.user_id === userId && r.module_key === moduleKey && r.view_name === viewName);
        return [match ? [{ id: match.id }] : [], []];
      }
      if (sql.startsWith("INSERT INTO finance_saved_view")) {
        const [id, userId, moduleKey, viewName, configJson] = params as [string, string, string, string, string];
        rows.push({
          id,
          user_id: userId,
          module_key: moduleKey,
          view_name: viewName,
          config_json: configJson,
          is_default: 0,
          created_at: `2026-01-0${++counter}`,
          updated_at: `2026-01-0${counter}`,
        });
        return [[], []];
      }
      if (sql.startsWith("SELECT * FROM finance_saved_view WHERE id = ? LIMIT 1")) {
        const [id] = params as [string];
        const match = rows.find((r) => r.id === id);
        return [match ? [match] : [], []];
      }
      if (sql.startsWith("SELECT id FROM finance_saved_view WHERE id = ? AND user_id = ?")) {
        const [id, userId] = params as [string, string];
        const match = rows.find((r) => r.id === id && r.user_id === userId);
        return [match ? [{ id: match.id }] : [], []];
      }
      if (sql.startsWith("DELETE FROM finance_saved_view WHERE id = ? AND user_id = ?")) {
        const [id, userId] = params as [string, string];
        const index = rows.findIndex((r) => r.id === id && r.user_id === userId);
        if (index >= 0) rows.splice(index, 1);
        return [[], []];
      }
      throw new Error(`fakeExecutor: unexpected query — ${sql}`);
    },
  } as any;
}

describe("saved-view.service", () => {
  it("creates and lists a saved view scoped to the user and module", async () => {
    const exec = fakeExecutor();
    const created = await createSavedView("user-1", "branch_budget_matrix", "My Q1 view", { pinned: ["cc1"] }, exec);
    expect(created.viewName).toBe("My Q1 view");
    expect(created.config).toEqual({ pinned: ["cc1"] });

    const list = await listSavedViews("user-1", "branch_budget_matrix", exec);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });

  it("rejects a duplicate view name for the same user and module", async () => {
    const exec = fakeExecutor();
    await createSavedView("user-1", "branch_budget_matrix", "Dup", {}, exec);
    await expect(createSavedView("user-1", "branch_budget_matrix", "Dup", {}, exec)).rejects.toThrow(/already exists/);
  });

  it("allows the same view name for different users or different modules", async () => {
    const exec = fakeExecutor();
    await createSavedView("user-1", "branch_budget_matrix", "Shared name", {}, exec);
    await expect(createSavedView("user-2", "branch_budget_matrix", "Shared name", {}, exec)).resolves.toBeTruthy();
    await expect(createSavedView("user-1", "process_pnl_matrix", "Shared name", {}, exec)).resolves.toBeTruthy();
  });

  it("does not list another user's saved views", async () => {
    const exec = fakeExecutor();
    await createSavedView("user-1", "branch_budget_matrix", "Mine", {}, exec);
    const list = await listSavedViews("user-2", "branch_budget_matrix", exec);
    expect(list).toHaveLength(0);
  });

  it("deletes only the requesting user's own saved view", async () => {
    const exec = fakeExecutor();
    const created = await createSavedView("user-1", "branch_budget_matrix", "To delete", {}, exec);
    await expect(deleteSavedView(created.id, "user-2", exec)).rejects.toThrow(/not found/);
    expect(exec.rows).toHaveLength(1);

    await deleteSavedView(created.id, "user-1", exec);
    expect(exec.rows).toHaveLength(0);
  });
});
