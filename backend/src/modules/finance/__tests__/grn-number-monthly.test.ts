import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MAS/MM/YY/SERIAL — the new GRN number (Requirement 12).
 *
 * Two things are being protected here.
 *
 * Concurrency: the serial is company-global for a month, so two branches raising a GRN at the
 * same moment contend for one row. The allocator's INSERT ... ON DUPLICATE KEY UPDATE ->
 * SELECT ... FOR UPDATE -> UPDATE +1 sequence is what makes that safe, and the no-op ODKU is
 * load-bearing: it guarantees the row exists so FOR UPDATE has something to lock. A source
 * assertion pins all three, because a well-meaning refactor to MAX(serial)+1 would read fine
 * and duplicate numbers under load.
 *
 * Cutover: the flag ships as legacy_branch_fy, so merely deploying this changes nothing. That
 * is the property that lets it land ahead of Finance agreeing to the new format.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

let svc: typeof import("../grn-number-monthly.service.js");
beforeAll(async () => {
  svc = await import("../grn-number-monthly.service.js");
}, 120_000);

/** A stub PoolConnection that records every statement in order. */
function makeConnection(sequence = 1) {
  const statements: string[] = [];
  const conn = {
    statements,
    execute: vi.fn(async (sql: string) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      if (/FROM finance_company/.test(sql)) return [[{ grn_prefix: "MAS" }], []];
      if (/SELECT next_sequence/.test(sql)) return [[{ next_sequence: sequence }], []];
      return [[], []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
  return conn;
}

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  execute.mockResolvedValue([[], []]);
});

describe("allocateMonthlyGrnNumber — format", () => {
  it("produces MAS/08/26/0001 for the first GRN of August 2026", async () => {
    const conn = makeConnection(1);
    getConnection.mockResolvedValue(conn);
    expect(await svc.allocateMonthlyGrnNumber({ periodCode: "2026-08", companyCode: "MAS" }))
      .toBe("MAS/08/26/0001");
  });

  it("produces 0002 for the second", async () => {
    getConnection.mockResolvedValue(makeConnection(2));
    expect(await svc.allocateMonthlyGrnNumber({ periodCode: "2026-08", companyCode: "MAS" }))
      .toBe("MAS/08/26/0002");
  });

  it("restarts at 0001 the following month — the row key is (company, period)", async () => {
    getConnection.mockResolvedValue(makeConnection(1));
    expect(await svc.allocateMonthlyGrnNumber({ periodCode: "2026-09", companyCode: "MAS" }))
      .toBe("MAS/09/26/0001");
  });

  it("rolls the year over correctly", async () => {
    getConnection.mockResolvedValue(makeConnection(1));
    expect(await svc.allocateMonthlyGrnNumber({ periodCode: "2027-01", companyCode: "MAS" }))
      .toBe("MAS/01/27/0001");
  });

  it("grows past four digits rather than wrapping and colliding", async () => {
    getConnection.mockResolvedValue(makeConnection(10000));
    expect(await svc.allocateMonthlyGrnNumber({ periodCode: "2026-08", companyCode: "MAS" }))
      .toBe("MAS/08/26/10000");
  });

  it("rejects a malformed period instead of coercing it", async () => {
    getConnection.mockResolvedValue(makeConnection(1));
    await expect(svc.allocateMonthlyGrnNumber({ periodCode: "2026-13" })).rejects.toThrow(/YYYY-MM/);
    await expect(svc.allocateMonthlyGrnNumber({ periodCode: "Aug-26" })).rejects.toThrow(/YYYY-MM/);
  });

  it("refuses an unknown company rather than inventing a prefix", async () => {
    const conn = makeConnection(1);
    conn.execute = vi.fn(async (sql: string) =>
      /FROM finance_company/.test(sql) ? [[], []] : [[], []]) as never;
    getConnection.mockResolvedValue(conn);
    await expect(svc.allocateMonthlyGrnNumber({ periodCode: "2026-08", companyCode: "NOPE" }))
      .rejects.toThrow(/No active company is configured/i);
  });
});

describe("allocateMonthlyGrnNumber — concurrency", () => {
  it("locks the row before claiming it, in the right order", async () => {
    const conn = makeConnection(7);
    getConnection.mockResolvedValue(conn);
    await svc.allocateMonthlyGrnNumber({ periodCode: "2026-08", companyCode: "MAS" });

    const insertAt = conn.statements.findIndex((s) => /INSERT INTO finance_grn_monthly_sequence/.test(s));
    const lockAt = conn.statements.findIndex((s) => /SELECT next_sequence.*FOR UPDATE/.test(s));
    const bumpAt = conn.statements.findIndex((s) => /UPDATE finance_grn_monthly_sequence/.test(s));
    expect(insertAt, "the no-op ODKU must run first so FOR UPDATE has a row to lock").toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeGreaterThan(insertAt);
    expect(bumpAt).toBeGreaterThan(lockAt);
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalled();
  });

  it("rolls back and releases when the sequence read fails", async () => {
    const conn = makeConnection(1);
    conn.execute = vi.fn(async (sql: string) => {
      if (/FROM finance_company/.test(sql)) return [[{ grn_prefix: "MAS" }], []];
      if (/SELECT next_sequence/.test(sql)) throw new Error("deadlock");
      return [[], []];
    }) as never;
    getConnection.mockResolvedValue(conn);
    await expect(svc.allocateMonthlyGrnNumber({ periodCode: "2026-08", companyCode: "MAS" })).rejects.toThrow("deadlock");
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("joins a caller's transaction without committing or releasing it", async () => {
    // This is what stops a failed grn_request INSERT burning a serial. The caller owns the
    // transaction; committing here would defeat the point entirely.
    const conn = makeConnection(4);
    const number = await svc.allocateMonthlyGrnNumber({
      periodCode: "2026-08", companyCode: "MAS", connection: conn as never,
    });
    expect(number).toBe("MAS/08/26/0004");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).not.toHaveBeenCalled();
    expect(getConnection, "must not open a second connection").not.toHaveBeenCalled();
  });
});

describe("resolveGrnNumberFormat — cutover", () => {
  it("defaults to the legacy format, so deploying this changes nothing", async () => {
    execute.mockResolvedValue([[], []]);
    expect(await svc.resolveGrnNumberFormat()).toBe("legacy_branch_fy");
  });

  it("returns the legacy format when finance_config does not exist yet", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("finance_config")) throw new Error("no such table");
      return [[], []];
    });
    expect(await svc.resolveGrnNumberFormat()).toBe("legacy_branch_fy");
  });

  it("switches only on the exact flag value", async () => {
    execute.mockResolvedValue([[{ config_value: "monthly_company" }], []]);
    expect(await svc.resolveGrnNumberFormat()).toBe("monthly_company");
    execute.mockResolvedValue([[{ config_value: "something_else" }], []]);
    expect(await svc.resolveGrnNumberFormat()).toBe("legacy_branch_fy");
  });
});

describe("resolveAccountingPeriod", () => {
  it("prefers the explicit accounting period over the bill date", async () => {
    // A July-dated invoice booked into August must number into August, or "serials within
    // MAS/07/26 are contiguous" stops being true.
    expect(svc.resolveAccountingPeriod({ accountingPeriod: "2026-08", billDate: "2026-07-25" }))
      .toBe("2026-08");
  });

  it("falls back to the bill date when no period was supplied", async () => {
    expect(svc.resolveAccountingPeriod({ billDate: "2026-07-25" })).toBe("2026-07");
  });

  it("throws when neither is available rather than defaulting to today", async () => {
    expect(() => svc.resolveAccountingPeriod({})).toThrow(/accounting period or bill date/i);
  });
});

describe("source contract", () => {
  it("keeps the three statements that make the allocation safe", async () => {
    // A refactor to MAX(serial)+1 would read perfectly well and duplicate numbers under load.
    // Resolved from this file, not from cwd: vitest's working directory is not guaranteed to
    // be backend/, and a cwd-relative read silently fails in a way that looks like a missing file.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../grn-number-monthly.service.ts", import.meta.url), "utf8");
    expect(src).toContain("ON DUPLICATE KEY UPDATE next_sequence = next_sequence");
    expect(src).toContain("FOR UPDATE");
    expect(src).toContain("next_sequence = next_sequence + 1");
    expect(src, "MAX()+1 has no lock and will duplicate under concurrency").not.toMatch(/MAX\(\s*next_sequence/i);
  });
});
