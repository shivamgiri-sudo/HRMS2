import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const executeCalls: Array<[string, unknown]> = [];
  const connExecuteCalls: Array<[string, unknown]> = [];
  const conn = { execute: async (sql: string, params?: unknown) => { connExecuteCalls.push([sql, params]); return [[], []]; } };
  const pool = {
    execute: async (sql: string, params?: unknown) => { executeCalls.push([sql, params]); return [[], []]; },
    query: async () => [[], []],
    getConnection: async () => conn,
    escape: (v: unknown) => String(v),
    end: async () => undefined,
    on: () => undefined,
  };
  return { executeCalls, connExecuteCalls, pool, conn };
});

vi.mock("mysql2/promise", () => ({
  default: { createPool: () => m.pool },
  createPool: () => m.pool,
}));

const { db } = await vi.importActual<typeof import("../mysql.js")>("../mysql.js");

beforeEach(() => { m.executeCalls.length = 0; m.connExecuteCalls.length = 0; });

describe("db facade rewrites bound LIMIT / OFFSET", () => {
  it("execute sends the literal integers to the driver and keeps the other params", async () => {
    await db.execute("SELECT * FROM t WHERE a = ? LIMIT ? OFFSET ?", ["x", 25, 50]);
    expect(m.executeCalls).toEqual([["SELECT * FROM t WHERE a = ? LIMIT 25 OFFSET 50", ["x"]]]);
  });
  it("executeRun does the same", async () => {
    await db.executeRun("DELETE FROM t WHERE a = ? LIMIT ?", ["x", 10]);
    expect(m.executeCalls).toEqual([["DELETE FROM t WHERE a = ? LIMIT 10", ["x"]]]);
  });
  it("statements without LIMIT/OFFSET pass through untouched", async () => {
    await db.execute("SELECT * FROM t WHERE a = ? AND b = ?", ["x", 3]);
    expect(m.executeCalls).toEqual([["SELECT * FROM t WHERE a = ? AND b = ?", ["x", 3]]]);
  });
  it("a connection taken for a transaction gets the same rewrite, and is patched only once", async () => {
    const c1 = await db.getConnection();
    const c2 = await db.getConnection();
    expect(c1).toBe(c2);
    await c1.execute("SELECT 1 LIMIT ?", [5]);
    expect(m.connExecuteCalls).toEqual([["SELECT 1 LIMIT 5", []]]); // one wrapper only: no double rewriting
  });
});
