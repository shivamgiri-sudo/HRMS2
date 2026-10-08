import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** GST export batches: branch_admin only reaches registrations / batches of its own branch (owner ruling 2026-10-01). */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
let actor = { id: "u1", role: "branch_admin", roles: ["branch_admin"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; req.userRoles = actor.roles; next(); } };
});
import { gstExportRouter } from "../gst-export.routes.js";

const app = (role: string) => {
  actor = { id: `u-${role}`, role, roles: [role] };
  const a = express(); a.use(express.json()); a.use("/gst", gstExportRouter); return a;
};
const find = (re: RegExp) => execute.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/FROM user_assignment_scope/.test(sql)) return [[], []];
    if (/SELECT branch_id\s+FROM employees/.test(sql)) return [[{ branch_id: "b1" }], []];
    if (/FROM gst_export_batch WHERE id/.test(sql)) {
      return [[{ id: params?.[0], company_gstin: params?.[0] === "batch-own" ? "GST-OWN" : "GST-OTHER", exception_rows: 0, export_type: "GSTR1", period_month: "2026-09" }], []];
    }
    // branch_master rows carrying that GSTIN inside the caller's branch
    if (/SELECT branch_name FROM branch_master WHERE gstin = \?/.test(sql)) {
      return [params?.[0] === "GST-OWN" ? [{ branch_name: "Noida" }] : [], []];
    }
    return [[], []];
  });
});

describe("gst export branch scoping", () => {
  it("branch_admin registrations are limited to its branch; finance sees all", async () => {
    await request(app("branch_admin")).get("/gst/registrations");
    const c = find(/FROM branch_master bm/)!;
    expect(String(c[0])).toMatch(/bm\.id IN \(\?\)/);
    expect(c[1]).toEqual(["b1"]);
    execute.mockClear();
    await request(app("finance")).get("/gst/registrations");
    expect(String(find(/FROM branch_master bm/)![0])).not.toMatch(/bm\.id IN/);
  });
  it("batch list only returns GSTINs of the caller's branch", async () => {
    await request(app("branch_admin")).get("/gst/exports?companyGstin=GST-OTHER");
    const c = find(/FROM gst_export_batch/)!;
    expect(String(c[0])).toMatch(/company_gstin IN \(SELECT gstin FROM branch_master/);
    expect(c[1]).toContain("b1");
  });
  it("a batch of a foreign GSTIN is 403 on detail, exceptions and csv", async () => {
    for (const p of ["/gst/exports/batch-other", "/gst/exports/batch-other/exceptions", "/gst/exports/batch-other/csv"]) {
      expect((await request(app("branch_admin")).get(p)).status, p).toBe(403);
    }
  });
  it("own batch is served and its rows are limited to the branch", async () => {
    const res = await request(app("branch_admin")).get("/gst/exports/batch-own");
    expect(res.status).toBe(200);
    expect(String(find(/FROM gst_export_row/)![0])).toMatch(/branch_name IN \(\?\)/);
  });
  it("finance_head reads any batch without a branch lookup", async () => {
    const res = await request(app("finance_head")).get("/gst/exports/batch-other");
    expect(res.status).toBe(200);
    expect(String(find(/FROM gst_export_row/)![0])).not.toMatch(/branch_name IN/);
  });
});
