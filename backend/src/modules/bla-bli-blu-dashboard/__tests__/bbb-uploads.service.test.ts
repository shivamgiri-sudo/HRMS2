import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, conn, getConnection } = vi.hoisted(() => {
  const conn = { query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(async () => undefined), release: vi.fn() };
  return { execute: vi.fn(), conn, getConnection: vi.fn(async () => conn) };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));

import { deleteSalesBatch, ingestReceived, reclassifyReceived, restoreReceivedBatch, trashReceivedBatch } from "../bbb-uploads.service.js";

const sqls = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " "));

beforeEach(() => {
  execute.mockReset(); conn.query.mockReset(); conn.beginTransaction.mockReset(); conn.commit.mockReset(); conn.release.mockReset();
  conn.query.mockImplementation(async (sql: string) => {
    if (/GET_LOCK/.test(sql)) return [[{ ok: 1 }]];
    if (/GROUP BY data_type/.test(sql)) return [[{ data_type: "Fresh", n: 1 }, { data_type: "NC", n: 1 }]];
    return [{ affectedRows: 1 }];
  });
});

describe("ingestReceived", () => {
  it("stores new rows once, skips a same-day duplicate, and reports each reason", async () => {
    // 9876543210 already stored for 30 Sep.
    execute.mockImplementation(async (sql: string) => (/SELECT DATE_FORMAT\(report_date/.test(sql) ? [[{ d: "2026-09-30", phone: "9876543210" }]] : [[]]));
    const r = await ingestReceived([
      { date: "2026-09-30", phone: "9876543210" },          // duplicate of a stored row
      { date: "2026-09-30", phone: "9000000001" },          // new
      { date: "2026-10-01", phone: "9876543210" },          // same number, next day: valid
      { date: "2026-10-01", phone: "+91 98765 43210" },     // duplicate inside the file
      { date: "2026-10-01", phone: "12" },                  // no usable number
      { date: null, phone: "9000000002" },                  // no date
    ], "batch-1", "user-1");
    expect(r).toMatchObject({ inserted: 2, duplicateSameDay: 2, noNumber: 1, noDate: 1, fresh: 1, nc: 1, dateFrom: "2026-09-30", dateTo: "2026-10-01" });
    expect(r.duplicateIndexes).toEqual([0, 3]);
    const insert = conn.query.mock.calls.find(([s]) => /INSERT INTO bla_dash_received/.test(String(s)))!;
    // Two rows of 12 values each; numbers are stored normalised.
    expect((insert[1] as unknown[]).length).toBe(24);
    expect(insert[1]).toEqual(expect.arrayContaining(["9000000001", "9876543210", "batch-1", "user-1"]));
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("re-derives Fresh / NC for the uploaded dates plus the 3 days after, then releases the lock", async () => {
    execute.mockResolvedValue([[]]);
    await ingestReceived([{ date: "2026-09-30", phone: "9000000001" }], "b", null);
    const re = conn.query.mock.calls.find(([s]) => /SET r\.data_type = IF/.test(String(s)))!;
    expect(re[1]).toEqual(["2026-09-30", "2026-10-03", "2026-09-30", "2026-10-03"]);
    expect(sqls(conn.query).some((s) => /RELEASE_LOCK/.test(s))).toBe(true);
    expect(conn.release).toHaveBeenCalled();
  });

  it("refuses to run while another upload holds the lock, and writes nothing", async () => {
    conn.query.mockImplementation(async (sql: string) => (/GET_LOCK/.test(sql) ? [[{ ok: 0 }]] : [{ affectedRows: 0 }]));
    await expect(ingestReceived([{ date: "2026-09-30", phone: "9000000001" }], "b", null)).rejects.toThrow(/still being processed/);
    expect(sqls(conn.query).some((s) => /INSERT INTO/.test(s))).toBe(false);
    expect(conn.release).toHaveBeenCalled();
  });

  it("a file of only duplicates inserts nothing and does not open a transaction", async () => {
    execute.mockImplementation(async (sql: string) => (/SELECT DATE_FORMAT\(report_date/.test(sql) ? [[{ d: "2026-09-30", phone: "9876543210" }]] : [[]]));
    const r = await ingestReceived([{ date: "2026-09-30", phone: "9876543210" }], "b", null);
    expect(r.inserted).toBe(0);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
});

describe("reclassifyReceived", () => {
  it("looks back exactly 3 days, at live rows only, and never touches trashed rows", async () => {
    const run = vi.fn(async () => undefined);
    await reclassifyReceived("2026-09-30", "2026-10-03", run);
    const sql = String(run.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(sql).toContain("p.report_date < a.report_date");
    expect(sql).toContain("INTERVAL 3 DAY");
    expect(sql).toContain("p.live_key = 0");
    expect(sql).toContain("WHERE r.live_key = 0");
    expect(sql).toContain("IF(x.id IS NULL, 'Fresh', 'NC')");
  });
});

describe("trash and restore a Received Data batch", () => {
  it("trash soft-deletes only that batch's live rows and re-derives statuses", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/MIN\(report_date\)/.test(sql)) return [[{ f: "2026-09-30", t: "2026-09-30" }]];
      if (/SET live_key = id/.test(sql)) return [{ affectedRows: 40 }];
      return [{ affectedRows: 0 }];
    });
    const r = await trashReceivedBatch("batch-1", "user-1");
    expect(r).toEqual({ batchId: "batch-1", trashed: 40 });
    const trash = execute.mock.calls.find(([s]) => /SET live_key = id/.test(String(s)))!;
    expect(String(trash[0])).toMatch(/WHERE upload_batch_id = \? AND live_key = 0/);
    expect(trash[1]).toEqual(["user-1", "batch-1"]);
    expect(sqls(execute).some((s) => /SET r\.data_type = IF/.test(s))).toBe(true);
  });

  it("an unknown batch is a readable error", async () => {
    execute.mockResolvedValue([[{ f: null, t: null }]]);
    await expect(trashReceivedBatch("nope", null)).rejects.toThrow(/not found/);
  });

  it("restore brings rows back only where no live row exists for that date and number", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/MIN\(report_date\)/.test(sql)) return [[{ f: "2026-09-30", t: "2026-09-30" }]];
      if (/SET r\.live_key = 0/.test(sql)) return [{ affectedRows: 38 }];
      if (/COUNT\(\*\) AS n/.test(sql)) return [[{ n: 2 }]];
      return [{ affectedRows: 0 }];
    });
    const r = await restoreReceivedBatch("batch-1");
    expect(r).toEqual({ batchId: "batch-1", restored: 38, keptInTrash: 2 });
    const sql = sqls(execute).find((s) => /SET r\.live_key = 0/.test(s))!;
    expect(sql).toContain("LEFT JOIN bla_dash_received live ON live.report_date = r.report_date AND live.phone = r.phone AND live.live_key = 0");
    expect(sql).toContain("WHERE live.id IS NULL");
    expect(sql).toContain("GROUP BY report_date, phone");
  });
});

describe("deleteSalesBatch", () => {
  it("reverts an order to the version the batch replaced, and removes one the batch created", async () => {
    conn.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/FOR UPDATE/.test(sql)) return [[{ id: "row-345", process_id: "p", order_id: "345" }, { id: "row-500", process_id: "p", order_id: "500" }]];
      if (/SELECT row_json FROM/.test(sql)) return [(params as unknown[])[0] === "345" ? [{ row_json: { current_status: "Cancel", amount: 999, source_reference: "batch-0" } }] : []];
      return [{ affectedRows: 1 }];
    });
    const r = await deleteSalesBatch("batch-1", "user-1");
    expect(r).toEqual({ batchId: "batch-1", reverted: 1, removed: 1 });
    const update = conn.query.mock.calls.find(([s]) => /^UPDATE bla_bli_blu_overall_sales_raw SET/.test(String(s)))!;
    expect(String(update[0])).toContain("current_status = ?");
    expect(update[1]).toEqual(expect.arrayContaining(["Cancel", "batch-0", "row-345"]));
    const del = conn.query.mock.calls.find(([s]) => /^DELETE FROM bla_bli_blu_overall_sales_raw/.test(String(s)))!;
    expect(del[1]).toEqual(["row-500"]);
    expect(sqls(conn.query).some((s) => /'batch_deleted'/.test(s))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });

  it("a batch with no rows left is a readable error and nothing is committed", async () => {
    conn.query.mockImplementation(async (sql: string) => (/FOR UPDATE/.test(sql) ? [[]] : [{ affectedRows: 0 }]));
    await expect(deleteSalesBatch("gone", null)).rejects.toThrow(/not found/);
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
