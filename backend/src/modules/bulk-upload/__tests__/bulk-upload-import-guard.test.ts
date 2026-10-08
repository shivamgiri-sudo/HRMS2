import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/bulk-upload/batches/:id/import used to dispatch straight into the
 * per-rpc import service with no guard against a second concurrent call for the
 * SAME batch. That is exactly what a client retry after the (also-fixed) false
 * 30s timeout looks like: the first import keeps running server-side after the
 * client aborts, the user clicks "Import to HRMS" again, and the second call's
 * row SELECT finds nothing left to do (the first call already flipped every
 * row's status) — it computes 0 imported / 0 errors and overwrites the first
 * call's correct upload_batch summary with a misleading "imported, 0 rows".
 * Verified live against BATCH-1787062644877: row-level data showed 720
 * imported / 98 error, but the batch header said batch_status='imported',
 * imported_rows=0, error_rows=0.
 *
 * The router now atomically claims the batch (UPDATE ... WHERE batch_status
 * NOT IN ('importing')) before dispatching, and rejects a concurrent call with
 * 409 instead of letting it run.
 *
 * The dispatch itself no longer happens inside the request. A few hundred rows take
 * longer than nginx's 60s proxy timeout, which turned a working import into a 502 for
 * the uploader, so the route claims the batch, answers 202 and runs the import in the
 * background (batch-job.ts) while the page polls /batches/:id/import-status. The claim
 * guarantees above are unchanged — they are what these tests are really about — but
 * the status code is now 202 and the result is collected from the status endpoint
 * rather than from this response.
 *
 * d9c6bc7ba then moved the import out of the API process altogether: the route no longer
 * runs the service in the background itself, it writes a bulk_import_queue row and
 * hrms-workers (workers/bulk-import.worker.ts) claims it and calls dispatchImport. So the
 * "starts the import" and "failure lands on the batch" cases are each asserted in two
 * halves — what the route hands off, and what the worker does with it.
 */

const BATCH_ID = "batch-1";
const ACTOR = "user-1";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
// Per-batch branch visibility is covered by bulk-batch-visibility.test.ts; these tests exercise other behaviour.
vi.mock("../bulk-batch-visibility.js", () => ({ requireBatchVisible: () => (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: ACTOR };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

const { importReportingManagerBatch } = vi.hoisted(() => ({
  importReportingManagerBatch: vi.fn(),
}));
vi.mock("../reporting-manager-bulk.service.js", () => ({
  importReportingManagerBatch,
}));

const { bulkUploadRouter } = await import("../bulk-upload.routes.js");
const { dispatchImport } = await import("../bulk-dispatch.js");
const { startBulkImportWorker, stopBulkImportWorker } = await import("../../../workers/bulk-import.worker.js");

const RPC = "import_reporting_manager_update_batch";
const sqlOf = (c: unknown[]) => String(c[0]);

/** The db as the worker sees it: one queued job for this batch, then an empty queue. */
function queueOneJob() {
  let claimed = false;
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("UPDATE bulk_import_queue SET claimed_at")) {
      if (claimed) return [{ affectedRows: 0 }, []];
      claimed = true;
      return [{ affectedRows: 1 }, []];
    }
    if (s.includes("FROM bulk_import_queue")) {
      return [[{ id: "queue-1", batch_id: BATCH_ID, rpc_name: RPC, user_id: ACTOR }], []];
    }
    return [{ affectedRows: 1 }, []];
  });
}

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/bulk-upload", bulkUploadRouter);
  return a;
}

function importBody() {
  return { rpc_name: "import_reporting_manager_update_batch" };
}

beforeEach(() => {
  execute.mockReset();
  importReportingManagerBatch
    .mockReset()
    .mockResolvedValue({ importedRows: 720, errorRows: 98, errors: [] });
});

describe("POST /batches/:id/import — concurrency guard", () => {
  it("claims the batch and starts the import on a clean call", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]); // stale-claim release: nothing to release
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // claim succeeds
    execute.mockResolvedValueOnce([[{ n: 818 }], []]);        // rows still to import
    execute.mockResolvedValue([{ affectedRows: 1 }, []]);     // metadata stamp + queue insert

    const res = await request(app())
      .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
      .send(importBody());

    expect(res.status).toBe(202);
    expect(res.body.processing).toBe(true);
    expect(res.body.total_rows).toBe(818);

    const claim = execute.mock.calls[1][0] as string;
    expect(claim).toMatch(/SET batch_status = 'importing'/);
    expect(claim).toMatch(/NOT IN \('importing'\)/);

    // Starting the import now means handing it to the worker: one queue row for this
    // batch, carrying the rpc and the actor, written AFTER the claim.
    const queuedAt = execute.mock.calls.findIndex((c) => sqlOf(c).includes("INSERT INTO bulk_import_queue"));
    expect(queuedAt).toBeGreaterThan(1);
    expect(execute.mock.calls[queuedAt][1]).toEqual([BATCH_ID, RPC, ACTOR]);
    // ...and the API process itself does not run it.
    expect(importReportingManagerBatch).not.toHaveBeenCalled();

    // The worker's half: that same (rpc, batch, actor) reaches the service.
    await dispatchImport(RPC, BATCH_ID, ACTOR);
    expect(importReportingManagerBatch).toHaveBeenCalledWith(BATCH_ID, ACTOR);
  });

  it("the worker runs a queued import with the batch and actor the route queued", async () => {
    queueOneJob();
    startBulkImportWorker();
    try {
      await vi.waitFor(
        () => expect(importReportingManagerBatch).toHaveBeenCalledWith(BATCH_ID, ACTOR),
        { timeout: 5000 },
      );
      await vi.waitFor(() => {
        const removed = execute.mock.calls.find((c) => sqlOf(c).includes("DELETE FROM bulk_import_queue"));
        expect(removed).toBeDefined();
        expect(removed![1]).toEqual(["queue-1"]);
      }, { timeout: 5000 });
      expect(execute.mock.calls.some((c) => /SET batch_status = 'failed'/.test(sqlOf(c)))).toBe(false);
    } finally {
      stopBulkImportWorker();
    }
  });

  it("fails a batch that the importer returned from without moving it off 'importing'", async () => {
    // BATCH-1791372390102: every row had been force-marked 'error', the importer found nothing to import,
    // returned, and the batch sat 'importing' for 30+ minutes until the stale-job check flagged it.
    let claimed = false;
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("UPDATE bulk_import_queue SET claimed_at")) {
        if (claimed) return [{ affectedRows: 0 }, []];
        claimed = true;
        return [{ affectedRows: 1 }, []];
      }
      if (q.includes("FROM bulk_import_queue")) {
        return [[{ id: "queue-1", batch_id: BATCH_ID, rpc_name: RPC, user_id: ACTOR }], []];
      }
      if (q.includes("SELECT batch_status FROM upload_batch")) return [[{ batch_status: "importing" }], []];
      return [{ affectedRows: 1 }, []];
    });
    startBulkImportWorker();
    try {
      await vi.waitFor(() => {
        const failed = execute.mock.calls.find((c) => /SET batch_status = 'failed'/.test(sqlOf(c)));
        expect(failed).toBeDefined();
        expect(String(failed![0])).toContain("batch_status = 'importing'");
        expect(failed![1]).toEqual([BATCH_ID]);
      }, { timeout: 5000 });
    } finally {
      stopBulkImportWorker();
    }
  });

  it("rejects a second concurrent import of the same batch with 409, without running the service", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]); // stale-claim release: nothing to release
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]); // claim fails — already importing

    const res = await request(app())
      .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
      .send(importBody());

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/already being imported/);
    expect(importReportingManagerBatch).not.toHaveBeenCalled();
  });

  it("resets the batch off 'importing' when the import throws, instead of leaving it stuck", async () => {
    importReportingManagerBatch.mockRejectedValue(new Error("connection lost"));

    // The request was answered long before the import fails, so the failure cannot travel
    // back as a 5xx — it has to land on the batch instead, which is the only thing the page
    // can still read afterwards. That write is the worker's now.
    queueOneJob();
    startBulkImportWorker();
    try {
      await vi.waitFor(() => {
        const failedCall = execute.mock.calls.find((c) =>
          /SET batch_status = 'failed'/.test(String(c[0])),
        );
        expect(failedCall).toBeDefined();
        expect((failedCall![1] as unknown[])[0]).toMatch(/connection lost/);
        expect((failedCall![1] as unknown[])[1]).toBe(BATCH_ID);
      }, { timeout: 5000 });
      // The queue row is removed either way, so a failed job is not retried forever.
      await vi.waitFor(() =>
        expect(execute.mock.calls.some((c) => sqlOf(c).includes("DELETE FROM bulk_import_queue"))).toBe(true),
      { timeout: 5000 });
    } finally {
      stopBulkImportWorker();
    }
  });

  it("501s an unrecognized rpc_name WITHOUT ever claiming the batch", async () => {
    const res = await request(app())
      .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
      .send({ rpc_name: "not_a_real_rpc" });

    expect(res.status).toBe(501);
    expect(execute).not.toHaveBeenCalled();
    expect(importReportingManagerBatch).not.toHaveBeenCalled();
  });
});
