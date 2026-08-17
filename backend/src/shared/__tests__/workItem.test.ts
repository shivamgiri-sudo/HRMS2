import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * work_item producers used `INSERT ... ON DUPLICATE KEY UPDATE updated_at = NOW()`, which can
 * never fire: the table's only unique index is PRIMARY(id) — verified against the live schema —
 * and the id is a fresh UUID() every time, so no duplicate key is ever detected. Every call
 * appended another row.
 *
 * It had already happened: EMPLOYEE_CODE_PENDING was stacked twice on one candidate. The count is
 * small only because those routes have barely been called (8 work items in total). At launch
 * volume each call site produces a row per invocation.
 *
 * A unique key would be the wrong fix — (item_type, entity_type, entity_id) is legitimately NOT
 * unique over time, because the same task recurs after the previous one is completed. What must
 * not duplicate is an item still OPEN, which is a predicate rather than a constraint.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute } }));

const { upsertOpenWorkItem } = await import("../workItem.js");

const INPUT = {
  itemType: "EMPLOYEE_MASTER_CREATION",
  title: "Create employee master record",
  moduleCode: "employees",
  entityType: "candidate",
  entityId: "cand-1",
  assignedToRole: "hr",
  priority: "critical",
};

beforeEach(() => execute.mockReset());

describe("upsertOpenWorkItem", () => {
  it("inserts when no open item exists", async () => {
    execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 1 }, []]);
    await expect(upsertOpenWorkItem(INPUT)).resolves.toBe("created");

    const insert = execute.mock.calls.find(([s]) => /INSERT INTO work_item/i.test(String(s)));
    expect(insert).toBeTruthy();
    const params = (insert![1] as unknown[]).map(String);
    expect(params).toContain("EMPLOYEE_MASTER_CREATION");
    expect(params).toContain("cand-1");
    expect(params).toContain("hr");
    expect(params).toContain("critical");
  });

  it("refreshes instead of inserting when an open item already covers it", async () => {
    execute.mockResolvedValueOnce([[{ id: "wi-1" }], []]).mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await expect(upsertOpenWorkItem(INPUT)).resolves.toBe("refreshed");

    expect(execute.mock.calls.some(([s]) => /INSERT INTO work_item/i.test(String(s)))).toBe(false);
    const update = execute.mock.calls.find(([s]) => /UPDATE work_item/i.test(String(s)));
    expect(update).toBeTruthy();
    expect((update![1] as unknown[]).map(String)).toContain("wi-1");
  });

  it("never emits ON DUPLICATE KEY UPDATE — the clause that could not fire", async () => {
    execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 1 }, []]);
    await upsertOpenWorkItem(INPUT);
    for (const [sql] of execute.mock.calls) {
      expect(String(sql)).not.toMatch(/ON DUPLICATE KEY UPDATE/i);
    }
  });

  it("only reuses an item that is still open", async () => {
    execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 1 }, []]);
    await upsertOpenWorkItem(INPUT);
    const select = execute.mock.calls.find(([s]) => /SELECT id FROM work_item/i.test(String(s)));
    // A completed item must not suppress a genuinely new occurrence of the same task.
    expect(String(select![0])).toContain("status NOT IN ('completed', 'cancelled')");
  });

  it("scopes the lookup to the entity, not just the type", async () => {
    execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 1 }, []]);
    await upsertOpenWorkItem(INPUT);
    const select = execute.mock.calls.find(([s]) => /SELECT id FROM work_item/i.test(String(s)))!;
    const sql = String(select[0]);
    // Keying on item_type alone would let one candidate's open item suppress every other
    // candidate's — the opposite failure to the one being fixed, and a far worse one.
    expect(sql).toContain("item_type = ?");
    expect(sql).toContain("entity_type = ?");
    expect(sql).toContain("entity_id = ?");
    expect((select[1] as unknown[]).map(String)).toContain("cand-1");
  });

  /**
   * Callers decide what a failed work-item write means: the ATS producers swallow it with
   * `.catch(() => {})`, the exit recorder logs it. A catch inside this helper would take that
   * choice away from both and silently reinstate the "failure looks like success" shape the
   * work-item producers were fixed to stop having.
   *
   * Asserted on the source rather than by making the mock throw: a throwing shared mock produces
   * a rejection vitest reports as an unhandled error in parallel with the assertion consuming it,
   * so the runtime form failed for a reason unrelated to the claim. The structural form states
   * the claim exactly — there is no catch to swallow anything.
   */
  it("has no catch of its own, so a write failure reaches the caller", () => {
    const src = readFileSync(resolve(process.cwd(), "src/shared/workItem.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bcatch\s*\(/);
    expect(src).not.toMatch(/\.catch\(/);
  });
});
