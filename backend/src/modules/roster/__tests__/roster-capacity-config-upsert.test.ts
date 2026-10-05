import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving a day that was never configured used to UPDATE zero rows and fail with
 * "Capacity config not found after update". The save now seeds the row with the
 * page's defaults first (INSERT IGNORE on uk_process_day), then applies the edit.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { rosterCapacityService } = await import("../roster-capacity.service.js");

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (/^SELECT \* FROM process_weekoff_capacity WHERE process_id = \? AND day_of_week = \?/.test(sql)) {
      return [[{ id: "c1", process_id: "p1", day_of_week: 2, max_weekoff_count: 7 }], []];
    }
    if (/ORDER BY day_of_week/.test(sql)) return [[{ id: "c1", day_of_week: 2 }], []];
    return [{ affectedRows: 1 }, []];
  });
});

describe("roster capacity config", () => {
  it("seeds a missing day before updating it", async () => {
    const cfg = await rosterCapacityService.updateCapacityConfig("p1", 2, { max_weekoff_count: 7 });
    const sqls = execute.mock.calls.map((c) => String(c[0]));
    const insertAt = sqls.findIndex((q) => /INSERT IGNORE INTO process_weekoff_capacity/.test(q));
    const updateAt = sqls.findIndex((q) => /UPDATE process_weekoff_capacity/.test(q));
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeLessThan(updateAt);
    expect(execute.mock.calls[insertAt][1]).toEqual([expect.any(String), "p1", 2]);
    expect(cfg.max_weekoff_count).toBe(7);
  });

  it("does not seed anything when there is nothing to update", async () => {
    await expect(rosterCapacityService.updateCapacityConfig("p1", 2, {})).rejects.toThrow("No updates provided");
    expect(execute).not.toHaveBeenCalled();
  });

  it("lists all configured days for a process", async () => {
    expect(await rosterCapacityService.listCapacityConfigs("p1")).toEqual([{ id: "c1", day_of_week: 2 }]);
  });
});
