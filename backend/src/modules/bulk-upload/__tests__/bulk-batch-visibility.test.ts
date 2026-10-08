import { beforeEach, describe, expect, it, vi } from "vitest";

/** Bulk Upload Hub by-id routes apply the same visibility predicate as GET /batches. */
const { dbExecute, buildScope } = vi.hoisted(() => ({ dbExecute: vi.fn(), buildScope: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause: buildScope }));

function run(visible: boolean, exists = true) {
  buildScope.mockResolvedValue({ sql: "COALESCE(ub.branch_id, uploader_emp.branch_id) = ?", params: ["b-noida"] });
  dbExecute.mockImplementation(async (sql: string) => {
    if (/uploader_emp/.test(sql)) return [visible ? [{ 1: 1 }] : [], []];
    return [exists ? [{ 1: 1 }] : [], []];
  });
  const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  const next = vi.fn();
  return import("../bulk-batch-visibility.js").then(async ({ requireBatchVisible }) => {
    await requireBatchVisible()({ params: { id: "b1" }, authUser: { id: "u1" } } as any, res, next);
    return { res, next };
  });
}
beforeEach(() => { dbExecute.mockReset(); buildScope.mockReset(); });

describe("requireBatchVisible", () => {
  it("passes a batch the caller uploaded or whose branch is in scope", async () => {
    const { next } = await run(true);
    expect(next).toHaveBeenCalledWith();
    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toContain("ub.uploaded_by = ? OR (COALESCE(ub.branch_id, uploader_emp.branch_id) = ?)");
    expect(params).toEqual(["b1", "u1", "b-noida"]);
  });
  it("403 for another branch's batch (hr no longer org-wide: blockOrgWideForRoles hr)", async () => {
    const { res, next } = await run(false);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(buildScope.mock.calls[0][3]).toEqual(expect.objectContaining({ blockOrgWideForRoles: ["hr", "hr_admin"] }));
  });
  it("a missing batch falls through to the handler's own 404", async () => {
    const { next } = await run(false, false);
    expect(next).toHaveBeenCalledWith();
  });
  it("fails closed when the lookup errors", async () => {
    buildScope.mockRejectedValue(new Error("db down"));
    const { requireBatchVisible } = await import("../bulk-batch-visibility.js");
    const next = vi.fn();
    await requireBatchVisible()({ params: { id: "b1" }, authUser: { id: "u1" } } as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
