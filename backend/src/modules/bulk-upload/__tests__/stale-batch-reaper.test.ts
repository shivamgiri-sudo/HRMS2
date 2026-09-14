/**
 * A bulk-upload batch must never be able to sit in a working state forever without saying so.
 *
 * bulk-approval-async.ts tracks a running import in `jobMap`, an in-process Map, while the batch
 * is marked 'importing' in the DATABASE. A restart erases the Map and nothing is left to finish
 * the batch — not even its own `.catch()`, which writes `job.status = "failed"` to a JavaScript
 * object nobody will read again. BATCH-1788604867017 sat 'importing' for two and a half hours
 * with 1,246 of 3,765 rows unprocessed and was found by hand.
 *
 * These tests pin the two properties that make the backstop trustworthy: it must catch a batch
 * whose worker is gone, and it must NOT touch one that is still working. A reaper that kills live
 * imports would be worse than the bug.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const query = vi.fn();
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { query: (...a: unknown[]) => query(...a), execute: (...a: unknown[]) => execute(...a) } }));

const {
  findStalledBatches, markBatchStalled, reapStalledBatches, stallSummary,
  TRANSIENT_BATCH_STATUSES, STALL_MINUTES, HEARTBEAT_STALL_MINUTES,
} = await import("../stale-batch-reaper.service.js");

const STALLED = {
  id: "b1", uploadBatchNo: "BATCH-1788604867017", uploadTypeCode: "ATTENDANCE_REGULARIZATION_BULK",
  status: "importing", totalRows: 3765, importedRows: 2475, remainingRows: 1246, idleMinutes: 150,
};

beforeEach(() => { query.mockReset(); execute.mockReset(); });

describe("what counts as stalled", () => {
  it("watches every state that is only ever held while a process is working", () => {
    // A batch resting in 'imported' or 'pending_approval' is finished or waiting on a human —
    // neither is a stall. Only the working states can be orphaned by a restart.
    expect([...TRANSIENT_BATCH_STATUSES]).toEqual(["importing", "approving", "validating", "rejecting"]);
  });

  it("measures silence, not total runtime, so a long import that is still working is never reaped", async () => {
    /*
     * updated_at moves as rows are processed. If the threshold were measured from created_at, a
     * legitimately slow batch — and at ~8 queries per row they are slow — would be killed
     * mid-flight, which is a worse failure than the one being fixed.
     */
    query.mockResolvedValueOnce([[]]);
    await findStalledBatches(30);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("b.updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)");
    expect(sql).not.toContain("b.created_at <");
    expect(query.mock.calls[0][1]).toEqual([
      ...TRANSIENT_BATCH_STATUSES, HEARTBEAT_STALL_MINUTES, 30,
    ]);
  });

  it("counts the rows that were never processed, not the ones that failed validation", () => {
    // 'valid'/'pending' are what loadStagedRows() will pick up on a re-run. 'error' rows are a
    // separate problem and counting them would overstate what re-running recovers.
    query.mockResolvedValueOnce([[]]);
    void findStalledBatches();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("r.row_status IN ('valid','pending')");
  });

  it("gives a generous default threshold", () => {
    expect(STALL_MINUTES).toBeGreaterThanOrEqual(15);
  });
});

describe("marking one failed", () => {
  it("only writes if the batch is still in the state it was found in", async () => {
    /*
     * Between the scan and the write the job could come back (a slow query returned, a second
     * process picked it up). Guarding on the observed status means a live batch is left alone
     * rather than yanked out from under a worker that is still going.
     */
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await markBatchStalled(STALLED);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("WHERE id = ? AND batch_status = ?");
    expect(params).toContain("importing");
  });

  it("reports not-marked when the batch moved on", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await markBatchStalled(STALLED)).toBe(false);
  });
});

describe("the message a person actually reads", () => {
  const msg = stallSummary(STALLED);

  it("says what happened, in terms of the cause", () => {
    // "failed" alone sends someone hunting through logs for an error that was never written.
    expect(msg).toMatch(/job tracking it was lost/);
    expect(msg).toMatch(/server restart/);
  });

  it("says how much was left, so the size of the problem is known without a query", () => {
    expect(msg).toContain("1246 of 3765");
  });

  it("promises that re-running will not duplicate the imported rows", () => {
    // Without this the safe move looks like starting over, which is the one thing that WOULD
    // duplicate work.
    expect(msg).toMatch(/will not be duplicated/);
  });

  it("ends with the next step rather than leaving the reader stuck", () => {
    expect(msg).toMatch(/Re-run the import to continue/);
  });
});

describe("the sweep", () => {
  it("marks every stalled batch and reports both counts", async () => {
    query.mockResolvedValueOnce([[
      { id: "b1", upload_batch_no: "B1", upload_type_code: "T", batch_status: "importing",
        total_rows: 10, imported_rows: 4, remaining_rows: 6, idle_minutes: 99 },
      { id: "b2", upload_batch_no: "B2", upload_type_code: "T", batch_status: "approving",
        total_rows: 5, imported_rows: 5, remaining_rows: 0, idle_minutes: 40 },
    ]]);
    execute.mockResolvedValue([{ affectedRows: 1 }]);

    const r = await reapStalledBatches();
    expect(r.scanned).toBe(2);
    expect(r.marked).toBe(2);
  });

  it("counts a batch that revived as scanned but not marked", async () => {
    query.mockResolvedValueOnce([[
      { id: "b1", upload_batch_no: "B1", upload_type_code: "T", batch_status: "importing",
        total_rows: 10, imported_rows: 4, remaining_rows: 6, idle_minutes: 99 },
    ]]);
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const r = await reapStalledBatches();
    expect(r.scanned).toBe(1);
    expect(r.marked).toBe(0);
  });

  it("does nothing when there is nothing stalled", async () => {
    query.mockResolvedValueOnce([[]]);
    const r = await reapStalledBatches();
    expect(r).toEqual({ scanned: 0, marked: 0, batches: [] });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("a heartbeat decides faster, and more certainly", () => {
  it("judges a batch that left one on the heartbeat, not on updated_at", async () => {
    /*
     * updated_at only moves as ROWS COMPLETE, so it cannot tell a dead job from a slow one and
     * has to wait 30 minutes to be safe. A heartbeat is stamped every 15 seconds by a job that
     * is genuinely running, so silence means the process is gone — the same verdict in minutes.
     */
    query.mockResolvedValueOnce([[]]);
    await findStalledBatches();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("b.job_heartbeat_at IS NOT NULL");
    expect(sql).toContain("b.job_heartbeat_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)");
    expect(HEARTBEAT_STALL_MINUTES).toBeLessThan(STALL_MINUTES);
  });

  it("falls back to updated_at only when there is no heartbeat", async () => {
    // Batches predating migration 1673, and jobs that died before their first beat. The two
    // arms must be mutually exclusive or a heartbeat batch would also be judged on the slow
    // rule and effectively never reaped early.
    query.mockResolvedValueOnce([[]]);
    await findStalledBatches();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("b.job_heartbeat_at IS NULL");
    expect(sql).toContain("OR (b.job_heartbeat_at IS NULL");
  });

  it("never reaps a batch whose heartbeat is current, however long it has run", async () => {
    // The property that makes this safe to run every 10 minutes: a live 40-minute import is
    // beating, so it is not stalled no matter what updated_at says.
    query.mockResolvedValueOnce([[]]);
    await findStalledBatches();
    const sql = String(query.mock.calls[0][0]);
    // The heartbeat arm requires the beat to be OLD; a fresh beat matches neither arm.
    expect(sql).not.toMatch(/job_heartbeat_at\s*>\s*DATE_SUB/);
  });

  it("reports which process held it and how the verdict was reached", async () => {
    // A post-mortem needs to know where it died, and whether "stalled" was the fast certain
    // answer or the slow inferred one.
    query.mockResolvedValueOnce([[
      { id: "b1", upload_batch_no: "B1", upload_type_code: "T", batch_status: "importing",
        total_rows: 10, imported_rows: 4, remaining_rows: 6, idle_minutes: 99,
        job_owner: "workers:1234", had_heartbeat: 1 },
    ]]);
    const [b] = await findStalledBatches();
    expect(b.jobOwner).toBe("workers:1234");
    expect(b.hadHeartbeat).toBe(true);
  });
});
