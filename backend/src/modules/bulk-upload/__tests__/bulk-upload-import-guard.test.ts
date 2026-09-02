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
 */

const BATCH_ID = "batch-1";
const ACTOR = "user-1";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: ACTOR }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

const { importReportingManagerBatch } = vi.hoisted(() => ({ importReportingManagerBatch: vi.fn() }));
vi.mock("../reporting-manager-bulk.service.js", () => ({ importReportingManagerBatch }));

const { bulkUploadRouter } = await import("../bulk-upload.routes.js");

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
  importReportingManagerBatch.mockReset().mockResolvedValue({ importedRows: 720, errorRows: 98, errors: [] });
});

describe("POST /batches/:id/import — concurrency guard", () => {
  it("claims the batch and starts the import on a clean call", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]); // stale-claim release: nothing to release
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // claim succeeds
    execute.mockResolvedValueOnce([[{ n: 818 }], []]);        // rows still to import

    const res = await request(app())
      .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
      .send(importBody());

    expect(res.status).toBe(202);
    expect(res.body.processing).toBe(true);
    expect(res.body.total_rows).toBe(818);

    // The import runs after the response — the point of the change — so it is
    // awaited here rather than asserted synchronously.
    await vi.waitFor(() =>
      expect(importReportingManagerBatch).toHaveBeenCalledWith(BATCH_ID, ACTOR),
    );

    const claim = execute.mock.calls[1][0] as string;
    expect(claim).toMatch(/SET batch_status = 'importing'/);
    expect(claim).toMatch(/NOT IN \('importing'\)/);
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
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]); // stale-claim release
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // claim succeeds
    execute.mockResolvedValueOnce([[{ n: 10 }], []]);         // rows still to import
    execute.mockResolvedValueOnce([{}, []]);                  // failed-status UPDATE
    importReportingManagerBatch.mockRejectedValue(new Error("connection lost"));

    // The request is answered before the import fails, so the failure can no longer
    // travel back as a 5xx — it has to land on the batch instead, which is the only
    // thing the page can still read afterwards.
    const res = await request(app())
      .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
      .send(importBody());
    expect(res.status).toBe(202);

    await vi.waitFor(() => {
      const failedCall = execute.mock.calls.find((c) =>
        /SET batch_status = 'failed'/.test(String(c[0])),
      );
      expect(failedCall).toBeDefined();
      expect((failedCall![1] as unknown[])[0]).toMatch(/connection lost/);
      expect((failedCall![1] as unknown[])[1]).toBe(BATCH_ID);
    });
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
