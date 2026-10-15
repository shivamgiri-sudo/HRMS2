import { beforeEach, describe, expect, it, vi } from "vitest";
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
import { readTrend } from "../snapshot.js";

beforeEach(() => { execute.mockReset(); execute.mockResolvedValue([[{ snap_date: "2026-10-15", value: "81.5" }], []]); });

describe("readTrend", () => {
  it("score reads the score column, not JSON_EXTRACT", async () => {
    const out = await readTrend("b1", "score", 30);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).not.toContain("JSON_EXTRACT");
    expect(sql).toMatch(/\bscore AS value/);
    expect(params).toEqual(["b1", 30]);
    expect(out).toEqual([{ date: "2026-10-15", value: 81.5 }]);
  });
  it("other metrics use JSON_EXTRACT", async () => {
    await readTrend("b1", "totalLate", 7);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("JSON_EXTRACT");
    expect(params[0]).toBe('$."totalLate"');
  });
});
