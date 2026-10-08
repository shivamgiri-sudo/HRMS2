import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, conn, getConnection } = vi.hoisted(() => {
  const conn = { query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(async () => undefined), release: vi.fn() };
  return { execute: vi.fn(), conn, getConnection: vi.fn(async () => conn) };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));

import {
  backfillBbbReadModel, deleteSalesBatch, ingestReceived, listUploadBatches, reclassifyReceived, refreshDailySummary,
  restoreReceivedBatch, trashReceivedBatch,
} from "../bbb-uploads.service.js";

const sqls = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " "));

beforeEach(() => {
  execute.mockReset(); conn.query.mockReset(); conn.beginTransaction.mockReset(); conn.commit.mockReset(); conn.release.mockReset();
  conn.query.mockImplementation(async (sql: string) => {
    if (/GET_LOCK/.test(sql)) return [[{ ok: 1 }]];
    if (/GROUP BY data_type/.test(sql)) return [[{ data_type: "Fresh", n: 1 }, { data_type: "NC", n: 1 }]];
    return [{ affectedRows: 1 }];
  });
});

/** Default pool behaviour: nothing stored yet, every write succeeds. Individual tests override by SQL. */
function pool(overrides: Array<[RegExp, (params?: unknown[]) => unknown]> = []) {
  execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    for (const [re, fn] of overrides) if (re.test(sql)) return fn(params);
    if (/^\s*SELECT/i.test(sql)) return [[]];
    return [{ affectedRows: 0 }];
  });
}

describe("ingestReceived", () => {
  it("stores new rows once, skips a same-day duplicate, and reports each reason", async () => {
    pool([
      [/SELECT DATE_FORMAT\(report_date,'%Y-%m-%d'\) AS d, phone/, () => [[{ d: "2026-09-30", phone: "9876543210" }]]], // already stored for 30 Sep
      [/GROUP BY data_type/, () => [[{ data_type: "Fresh", n: 1 }, { data_type: "NC", n: 1 }]]],
    ]);
    const r = await ingestReceived([
      { date: "2026-09-30", phone: "9876543210" },          // duplicate of a stored row
      { date: "2026-09-30", phone: "9000000001" },          // new
      { date: "2026-10-01", phone: "9876543210" },          // same number, next day: valid
      { date: "2026-10-01", phone: "+91 98765 43210" },     // duplicate inside the file
      { date: "2026-10-01", phone: "12" },                  // no usable number
      { date: null, phone: "9000000002" },                  // no date
    ], "batch-1", "user-1");
    expect(r).toMatchObject({ inserted: 2, duplicateSameDay: 2, noNumber: 1, noDate: 1, fresh: 1, nc: 1, dateFrom: "2026-09-30", dateTo: "2026-10-01", pending: false });
    expect(r.duplicateIndexes).toEqual([0, 3]);
    const insert = conn.query.mock.calls.find(([q]) => /INSERT INTO bla_dash_received\b/.test(String(q)))!;
    expect((insert[1] as unknown[]).length).toBe(24); // two rows of 12 values
    expect(insert[1]).toEqual(expect.arrayContaining(["9000000001", "9876543210", "batch-1", "user-1"]));
    expect(conn.commit).toHaveBeenCalled();
    // The file is registered as a batch so it can be listed and trashed without scanning the rows.
    const reg = conn.query.mock.calls.find(([q]) => /INSERT INTO bbb_upload_batch/.test(String(q)))!;
    expect(reg[1]).toEqual(["batch-1", "user-1", 2, "2026-09-30", "2026-10-01", "updating"]);
  });

  it("re-derives Fresh / NC for the uploaded dates plus the 3 days after, refreshes the summary, and releases the lock first", async () => {
    pool();
    await ingestReceived([{ date: "2026-09-30", phone: "9000000001" }], "b", null);
    const re = execute.mock.calls.find(([q]) => /SET r\.data_type = IF/.test(String(q)))!;
    expect(re[1]).toEqual(["2026-09-30", "2026-10-03", "2026-09-30", "2026-10-03"]);
    const order = sqls(conn.query);
    const released = order.findIndex((q) => /RELEASE_LOCK/.test(q));
    expect(released).toBeGreaterThan(-1);
    // Summary rebuilt for the same window, and the batch marked ready once both are done.
    const del = conn.query.mock.calls.find(([q]) => /DELETE FROM bla_dash_received_daily/.test(String(q)))!;
    expect(del[1]).toEqual(["2026-09-30", "2026-10-03"]);
    expect(sqls(conn.query).some((q) => /INSERT INTO bla_dash_received_daily/.test(q) && /WHERE live_key = 0/.test(q))).toBe(true);
    expect(execute.mock.calls.some(([q, p]) => /UPDATE bbb_upload_batch SET state = \?/.test(String(q)) && (p as unknown[])[0] === "ready")).toBe(true);
    expect(conn.release).toHaveBeenCalled();
  });

  it("refuses to run while another upload holds the lock, and writes nothing", async () => {
    pool();
    conn.query.mockImplementation(async (sql: string) => (/GET_LOCK/.test(sql) ? [[{ ok: 0 }]] : [{ affectedRows: 0 }]));
    await expect(ingestReceived([{ date: "2026-09-30", phone: "9000000001" }], "b", null)).rejects.toThrow(/still being processed/);
    expect(sqls(conn.query).some((q) => /INSERT INTO/.test(q))).toBe(false);
    expect(conn.release).toHaveBeenCalled();
  });

  it("a file of only duplicates inserts nothing, opens no transaction and does no follow-up work", async () => {
    pool([[/SELECT DATE_FORMAT\(report_date,'%Y-%m-%d'\) AS d, phone/, () => [[{ d: "2026-09-30", phone: "9876543210" }]]]]);
    const r = await ingestReceived([{ date: "2026-09-30", phone: "9876543210" }], "b", null);
    expect(r).toMatchObject({ inserted: 0, duplicateSameDay: 1, pending: false });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([q]) => /SET r\.data_type = IF/.test(String(q)))).toBe(false);
  });

  it("a failing follow-up marks the batch failed instead of losing the upload", async () => {
    pool([[/SET r\.data_type = IF/, () => { throw new Error("Lock wait timeout exceeded"); }]]);
    const r = await ingestReceived([{ date: "2026-09-30", phone: "9000000001" }], "b", null);
    expect(r.inserted).toBe(1);
    expect(execute.mock.calls.some(([q, p]) => /UPDATE bbb_upload_batch SET state = \?/.test(String(q)) && (p as unknown[])[0] === "failed")).toBe(true);
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
  const registered = [/FROM bbb_upload_batch WHERE batch_id = \? AND kind = 'received'/, () => [[{ f: "2026-09-30", t: "2026-09-30" }]]] as [RegExp, () => unknown];

  it("trash soft-deletes only that batch's live rows, then re-derives statuses and the summary", async () => {
    pool([registered, [/SET live_key = id/, () => [{ affectedRows: 40 }]]]);
    const r = await trashReceivedBatch("batch-1", "user-1");
    expect(r).toEqual({ batchId: "batch-1", trashed: 40, pending: false });
    const trash = execute.mock.calls.find(([q]) => /SET live_key = id/.test(String(q)))!;
    expect(String(trash[0])).toMatch(/WHERE upload_batch_id = \? AND live_key = 0/);
    expect(trash[1]).toEqual(["user-1", "batch-1"]);
    expect(sqls(execute).some((q) => /SET r\.data_type = IF/.test(q))).toBe(true);
    expect(sqls(conn.query).some((q) => /INSERT INTO bla_dash_received_daily/.test(q))).toBe(true);
    expect(sqls(execute).some((q) => /trashed_rows = trashed_rows \+ \?, live_rows = 0/.test(q))).toBe(true);
  });

  it("an unknown batch is a readable error", async () => {
    pool([[/MIN\(report_date\)/, () => [[{ f: null, t: null }]]]]);
    await expect(trashReceivedBatch("nope", null)).rejects.toThrow(/not found/);
  });

  it("restore brings rows back only where no live row exists for that date and number", async () => {
    pool([registered, [/SET r\.live_key = 0/, () => [{ affectedRows: 38 }]], [/COUNT\(\*\) AS n FROM bla_dash_received WHERE upload_batch_id = \? AND live_key <> 0/, () => [[{ n: 2 }]]]]);
    const r = await restoreReceivedBatch("batch-1");
    expect(r).toEqual({ batchId: "batch-1", restored: 38, keptInTrash: 2, pending: false });
    const sql = sqls(execute).find((q) => /SET r\.live_key = 0/.test(q))!;
    expect(sql).toContain("LEFT JOIN bla_dash_received live ON live.report_date = r.report_date AND live.phone = r.phone AND live.live_key = 0");
    expect(sql).toContain("WHERE live.id IS NULL");
    expect(sql).toContain("GROUP BY report_date, phone");
    expect(sql).toContain("<> 'migration-1961-duplicate'");
  });
});

describe("read model", () => {
  it("the daily summary counts live rows only and replaces the whole window in one transaction", async () => {
    pool();
    await refreshDailySummary("2026-08-01", "2026-08-31");
    const order = sqls(conn.query);
    expect(order[0]).toMatch(/DELETE FROM bla_dash_received_daily WHERE report_date BETWEEN \? AND \?/);
    expect(order[1]).toContain("COALESCE(SUM(data_type = 'Fresh' AND workable = 'Workable'), 0)");
    // Every aggregate is NULL-safe: a day with no answer-time values must store 0, not fail the whole refresh.
    expect(order[1].match(/SUM\(/g)).toHaveLength(10);
    expect(order[1].match(/COALESCE\(SUM\(/g)).toHaveLength(10);
    expect(order[1]).toContain("WHERE live_key = 0 AND report_date BETWEEN ? AND ? AND lob IS NOT NULL");
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("the uploaded-files list reads the registry, never the 126k-row table", async () => {
    pool([[/FROM bbb_upload_batch b/, () => [[{ batch: "b1", at: "2026-09-30T09:33:53Z", by_name: "A User", live_rows: 126498, trashed_rows: 114, f: "2026-01-08", t: "2026-08-31", trashed_at: null, state: "ready" }]]]]);
    const list = await listUploadBatches();
    expect(list.received[0]).toMatchObject({ batchId: "b1", liveRows: 126498, trashedRows: 114, state: "ready", uploadedBy: "A User" });
    const receivedSql = sqls(execute).find((q) => /FROM bbb_upload_batch b/.test(q))!;
    expect(receivedSql).not.toContain("FROM bla_dash_received");
  });

  it("the backfill registers unknown batches and summarises only months that have no summary yet", async () => {
    pool([
      [/SELECT batch_id FROM bbb_upload_batch/, () => [[{ batch_id: "known" }]]],
      [/SELECT DISTINCT upload_batch_id AS b/, () => [[{ b: "known" }, { b: "legacy" }]]],
      [/MIN\(created_at\) AS at/, () => [[{ at: "2026-09-30 15:03:53", by_user: "u", live_rows: 126498, trashed_rows: 114, f: "2026-01-08", t: "2026-08-31" }]]],
      [/SELECT DISTINCT DATE_FORMAT\(r\.report_date,'%Y-%m-01'\)/, () => [[{ m: "2026-02-01" }, { m: "2026-08-01" }]]],
    ]);
    const r = await backfillBbbReadModel();
    expect(r).toEqual({ batches: 1, months: 2 });
    const reg = execute.mock.calls.find(([q]) => /INSERT IGNORE INTO bbb_upload_batch/.test(String(q)))!;
    expect((reg[1] as unknown[])[0]).toBe("legacy");
    const windows = conn.query.mock.calls.filter(([q]) => /DELETE FROM bla_dash_received_daily/.test(String(q))).map(([, p]) => p);
    expect(windows).toEqual([["2026-02-01", "2026-02-28"], ["2026-08-01", "2026-08-31"]]);
    expect(sqls(conn.query).some((q) => /RELEASE_LOCK\('bbb_read_model_backfill'\)/.test(q))).toBe(true);
  });

  it("the backfill does nothing when another server already holds the lock", async () => {
    pool();
    conn.query.mockImplementation(async (sql: string) => (/GET_LOCK/.test(sql) ? [[{ ok: 0 }]] : [{ affectedRows: 0 }]));
    expect(await backfillBbbReadModel()).toEqual({ batches: 0, months: 0 });
    expect(execute).not.toHaveBeenCalled();
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
