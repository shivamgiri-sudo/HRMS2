import { describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

import { READ_CONCURRENCY, STATEMENT_TIMEOUT_MS, limited, limitedDb, readLimitState, withStatementTimeout } from "../he-read-limit.js";

describe("analytics read limits", () => {
  it("never runs more than 4 reads at a time, and runs every one of them", async () => {
    expect(READ_CONCURRENCY).toBe(4);
    let running = 0, peak = 0;
    const release: Array<() => void> = [];
    const task = () => limited(async () => { running++; peak = Math.max(peak, running); await new Promise<void>((r) => release.push(r)); running--; return 1; });
    const all = Promise.all(Array.from({ length: 11 }, task));
    for (let i = 0; i < 40 && release.length + 0 < 11; i++) { await new Promise((r) => setTimeout(r, 0)); while (release.length) release.shift()!(); }
    expect(await all).toHaveLength(11);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBe(4);
    expect(readLimitState()).toEqual({ active: 0, waiting: 0 });
  });
  it("frees the slot when a read fails", async () => {
    await expect(limited(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(readLimitState()).toEqual({ active: 0, waiting: 0 });
  });
  it("adds a MAX_EXECUTION_TIME hint after the leading SELECT and leaves other statements alone", () => {
    expect(STATEMENT_TIMEOUT_MS).toBe(8000);
    expect(withStatementTimeout("\n  SELECT STRAIGHT_JOIN a FROM t")).toBe("\n  SELECT /*+ MAX_EXECUTION_TIME(8000) */ STRAIGHT_JOIN a FROM t");
    expect(withStatementTimeout("SELECT 1", 250)).toBe("SELECT /*+ MAX_EXECUTION_TIME(250) */ 1");
    expect(withStatementTimeout("UPDATE t SET a = 1")).toBe("UPDATE t SET a = 1");
  });
  it("limitedDb.execute sends the hinted statement with its parameters", async () => {
    execute.mockResolvedValueOnce([[{ n: 1 }]]);
    const [rows] = await limitedDb.execute("SELECT n FROM t WHERE id = ?", ["a"]);
    expect(rows).toEqual([{ n: 1 }]);
    expect(execute).toHaveBeenCalledWith("SELECT /*+ MAX_EXECUTION_TIME(8000) */ n FROM t WHERE id = ?", ["a"]);
  });
});
