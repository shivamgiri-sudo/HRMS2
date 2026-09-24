import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level proof that branch_wfm / ho_wfm / wfm_spoc can use the Bulk Upload Hub for
 * EMPLOYEE_LOB_MAPPING and nothing else, while the roles that already had the hub are untouched.
 * The REAL requireRole and the REAL restriction middleware run; only the database, auth token
 * and import services are mocked. The caller's role keys come from the x-test-roles header.
 */

const LOB = "EMPLOYEE_LOB_MAPPING";
const ME = "user-1";
const OTHER = "user-2";

const { execute, query } = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query } }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const roles = String(req.headers["x-test-roles"] ?? "").split(",").filter(Boolean);
    req.authUser = { id: ME, roles };
    next();
  },
}));

vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=0", params: [] }),
}));
vi.mock("../bulk-approval.service.js", () => ({
  loadRowsWithLiveStatus: vi.fn().mockResolvedValue([]),
  reconcileStuckRows: vi.fn().mockResolvedValue({}),
}));
vi.mock("../bulk-dispatch.js", () => ({
  dispatchImport: vi.fn(),
  assertGatedUploader: vi.fn().mockResolvedValue(undefined),
  assertDepartmentStructureUploader: vi.fn().mockResolvedValue(undefined),
  assertEmployeeLobUploader: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../batch-job.js", () => ({
  getBatchJob: vi.fn().mockReturnValue(undefined),
  readBatchProgress: vi.fn().mockResolvedValue(null),
}));

const { bulkUploadRouter } = await import("../bulk-upload.routes.js");

const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/api/bulk-upload", bulkUploadRouter);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(err?.message ?? err) }));
  return a;
};

const as = (roles: string) => ({ "x-test-roles": roles });
const post = (url: string, roles: string, body: unknown = {}) =>
  request(app()).post(`/api/bulk-upload${url}`).set(as(roles)).send(body as object);
const get = (url: string, roles: string) => request(app()).get(`/api/bulk-upload${url}`).set(as(roles));

/** The batch-ownership lookup the guard performs. */
const batchLookup = (type: string, uploadedBy: string) =>
  execute.mockResolvedValueOnce([[{ upload_type_code: type, uploaded_by: uploadedBy }], []]);
const batchMissing = () => execute.mockResolvedValueOnce([[], []]);

const createBody = (type: string | undefined) => ({
  upload_type_code: type, original_file_name: "f.csv", total_rows: 2, valid_rows: 2, error_rows: 0,
});

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
});

describe.each(["branch_wfm", "ho_wfm", "wfm_spoc"])("LOB-only caller (%s)", (role) => {
  it("POST /batches: 201 for EMPLOYEE_LOB_MAPPING", async () => {
    execute.mockResolvedValueOnce([{}, []]); // insert
    execute.mockResolvedValueOnce([[{ id: "b1", upload_type_code: LOB }], []]); // re-read
    const res = await post("/batches", role, createBody(LOB));
    expect(res.status).toBe(201);
    expect(execute.mock.calls[0][1]).toContain(LOB);
  });

  it.each(["PAYROLL_SALARY", "EMPLOYEE_MASTER", "LEAVE_APPLICATION", "", undefined])(
    "POST /batches: 403 for upload type %j, nothing written",
    async (type) => {
      const res = await post("/batches", role, createBody(type));
      expect(res.status).toBe(403);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("POST /batches/:id/rows: 201 on their own LOB batch, 403 on someone else's, 403 on another type", async () => {
    batchLookup(LOB, ME);
    execute.mockResolvedValueOnce([{}, []]); // staging insert
    const ok = await post("/batches/b1/rows", role, [{ row_no: 1, raw_data: { employee_code: "E1" } }]);
    expect(ok.status).toBe(201);

    execute.mockReset();
    batchLookup(LOB, OTHER);
    const foreign = await post("/batches/b2/rows", role, [{ row_no: 1 }]);
    expect(foreign.status).toBe(403);
    expect(execute).toHaveBeenCalledTimes(1); // only the ownership lookup, no staging insert

    execute.mockReset();
    batchLookup("PAYROLL_SALARY", ME);
    const wrongType = await post("/batches/b3/rows", role, [{ row_no: 1 }]);
    expect(wrongType.status).toBe(403);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("POST /batches/:id/rows: 403 for a batch that does not exist (existence is not revealed)", async () => {
    batchMissing();
    const res = await post("/batches/nope/rows", role, [{ row_no: 1 }]);
    expect(res.status).toBe(403);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("POST /batches/:id/import: 202 for own LOB batch with the LOB rpc", async () => {
    batchLookup(LOB, ME);
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]); // stale release
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // claim
    execute.mockResolvedValueOnce([[{ n: 5 }], []]);          // pending rows
    execute.mockResolvedValueOnce([{}, []]);                  // queue insert
    const res = await post("/batches/b1/import", role, { rpc_name: "import_employee_lob_batch" });
    expect(res.status).toBe(202);
  });

  it("POST /batches/:id/import: 403 for any other rpc, even on their own LOB batch, before touching the batch", async () => {
    for (const rpc of ["import_pf_uan_batch", "import_incentive_bulk_batch", "import_lob_upload_batch", undefined]) {
      execute.mockReset();
      const res = await post("/batches/b1/import", role, { rpc_name: rpc });
      expect(res.status).toBe(403);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("POST /batches/:id/import: 403 for a foreign batch or a batch of another type; no claim taken", async () => {
    batchLookup(LOB, OTHER);
    const foreign = await post("/batches/b2/import", role, { rpc_name: "import_employee_lob_batch" });
    expect(foreign.status).toBe(403);
    expect(execute).toHaveBeenCalledTimes(1);

    execute.mockReset();
    batchLookup("EMPLOYEE_MASTER", ME);
    const other = await post("/batches/b3/import", role, { rpc_name: "import_employee_lob_batch" });
    expect(other.status).toBe(403);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("GET rows / import-status and DELETE are refused for a foreign batch", async () => {
    const calls = [
      () => get("/batches/b2/rows", role),
      () => get("/batches/b2/import-status", role),
      () => request(app()).delete("/api/bulk-upload/batches/b2").set(as(role)),
    ];
    for (const call of calls) {
      execute.mockReset();
      query.mockReset();
      batchLookup(LOB, OTHER);
      const res = await call();
      expect(res.status).toBe(403);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it("DELETE own LOB batch is allowed", async () => {
    batchLookup(LOB, ME);
    query.mockResolvedValueOnce([[{ id: "b1", batch_status: "imported" }], []]);
    query.mockResolvedValue([{}, []]);
    const res = await request(app()).delete("/api/bulk-upload/batches/b1").set(as(role));
    expect(res.status).toBe(200);
  });

  it("GET /templates returns only the LOB template", async () => {
    execute.mockResolvedValueOnce([[
      { upload_type_code: "EMPLOYEE_MASTER" }, { upload_type_code: LOB }, { upload_type_code: "PF_UAN" },
    ], []]);
    const res = await get("/templates", role);
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: any) => t.upload_type_code)).toEqual([LOB]);
  });

  it("GET /batches, /batches/filter-options and /batches/active are narrowed to their own LOB batches", async () => {
    execute.mockResolvedValue([[], []]);
    await get("/batches", role);
    const list = execute.mock.calls[0];
    expect(list[0]).toMatch(/ub\.upload_type_code = \? AND ub\.uploaded_by = \?/);
    expect(list[1].slice(-2)).toEqual([LOB, ME]);

    execute.mockClear();
    await get("/batches/filter-options", role);
    expect(execute).toHaveBeenCalledTimes(3);
    for (const call of execute.mock.calls) {
      expect(call[0]).toMatch(/ub\.upload_type_code = \? AND ub\.uploaded_by = \?/);
      expect(call[1].slice(-2)).toEqual([LOB, ME]);
    }

    execute.mockClear();
    await get("/batches/active", role);
    expect(execute.mock.calls[0][0]).toMatch(/upload_batch\.upload_type_code = \?/);
    expect(execute.mock.calls[0][1]).toEqual([ME, LOB, ME]);
  });

  it("stays closed: process-performance-v2-stats and reconcile", async () => {
    const stats = await get("/process-performance-v2-stats", role);
    expect(stats.status).toBe(403);
    const reconcile = await post("/batches/b1/reconcile", role);
    expect(reconcile.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("callers who already had the hub are unchanged", () => {
  it.each(["admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"])(
    "%s: POST /batches accepts any upload type with no ownership lookup",
    async (role) => {
      execute.mockResolvedValueOnce([{}, []]);
      execute.mockResolvedValueOnce([[{ id: "b1" }], []]);
      const res = await post("/batches", role, createBody("PAYROLL_SALARY"));
      expect(res.status).toBe(201);
      expect(execute).toHaveBeenCalledTimes(2);
    },
  );

  it("wfm: importing a foreign batch of another type is not blocked by the LOB restriction", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    execute.mockResolvedValueOnce([[{ n: 1 }], []]);
    execute.mockResolvedValueOnce([{}, []]);
    const res = await post("/batches/b2/import", "wfm", { rpc_name: "import_pf_uan_batch" });
    expect(res.status).toBe(202);
    expect(execute).toHaveBeenCalledTimes(4); // no ownership lookup
  });

  it("wfm: GET /templates is unfiltered and GET /batches has no LOB narrowing", async () => {
    execute.mockResolvedValueOnce([[{ upload_type_code: "EMPLOYEE_MASTER" }, { upload_type_code: LOB }], []]);
    const templates = await get("/templates", "wfm");
    expect(templates.body.data).toHaveLength(2);

    execute.mockReset();
    execute.mockResolvedValue([[], []]);
    await get("/batches", "wfm");
    expect(execute.mock.calls[0][0]).not.toMatch(/ub\.upload_type_code = \?/);
  });

  it("someone holding branch_wfm AND wfm keeps the full hub", async () => {
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([[{ id: "b1" }], []]);
    const res = await post("/batches", "branch_wfm,wfm", createBody("PAYROLL_SALARY"));
    expect(res.status).toBe(201);
  });

  it("v2-stats still works for wfm", async () => {
    execute.mockResolvedValueOnce([[{ total_files: 3, active_users: 2 }], []]);
    const res = await get("/process-performance-v2-stats", "wfm");
    expect(res.status).toBe(200);
    expect(res.body.data.totalFilesUploaded).toBe(3);
  });

  it("roles without hub access are still refused (employee, branch_head)", async () => {
    for (const role of ["employee", "branch_head", "recruiter"]) {
      const res = await get("/templates", role);
      expect(res.status).toBe(403);
    }
  });
});
