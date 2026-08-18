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
  it("claims the batch, runs the import, and returns its result on a clean call", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // claim succeeds

    const res = await request(app())
      .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
      .send(importBody());

    expect(res.status).toBe(200);
    expect(res.body.data.importedRows).toBe(720);
    expect(importReportingManagerBatch).toHaveBeenCalledWith(BATCH_ID, ACTOR);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatch(/SET batch_status = 'importing'/);
    expect(execute.mock.calls[0][0]).toMatch(/NOT IN \('importing'\)/);
  });

  it("rejects a second concurrent import of the same batch with 409, without running the service", async () => {
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
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // claim succeeds
    execute.mockResolvedValueOnce([{}, []]); // failed-status UPDATE
    importReportingManagerBatch.mockRejectedValue(new Error("connection lost"));

    const res = await request(app())
      .post(`/api/bulk-upload/batches/${BATCH_ID}/import`)
      .send(importBody());

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toMatch(/SET batch_status = 'failed'/);
    expect(execute.mock.calls[1][1][0]).toMatch(/connection lost/);
    expect(execute.mock.calls[1][1][1]).toBe(BATCH_ID);
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
