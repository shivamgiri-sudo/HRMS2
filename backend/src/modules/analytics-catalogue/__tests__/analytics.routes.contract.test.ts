import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route contracts for /api/analytics-catalogue. requireRole is NOT mocked, so the role lists are exercised for real.
 * The guarantees pinned here: who may register datasets, that a viewer's mistake is a 400 with a readable message,
 * that the SQL sent to the database always carries the viewer's scope clause, and that an org-wide dataset is
 * refused to a scoped viewer.
 */

const { query, getConnection } = vi.hoisted(() => ({ query: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: query, query, getConnection } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (orig) => ({
  ...(await orig<typeof import("../../../middleware/authMiddleware.js")>()),
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
}));

const scopeClause = vi.fn();
const orgWide = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
  buildScopeWhereClause: (...a: unknown[]) => scopeClause(...a),
  hasAnyRole: async (_id: string, ...roles: string[]) => roles.includes(actor.role),
  hasOrgWideScope: (...a: unknown[]) => orgWide(...a),
  isOrgWideUser: async () => ["super_admin", "ceo"].includes(actor.role),
}));

import { analyticsCatalogueRouter } from "../analytics.routes.js";
import { invalidateCatalogue } from "../catalogue.service.js";

function appFor(role: string) {
  actor = { id: `user-${role}-${Math.random()}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/analytics-catalogue", analyticsCatalogueRouter);
  return app;
}

const DATASETS = [
  { id: "d1", code: "process_kpi_daily", name: "Process KPIs", connection: "hrms", source_table: "process_metric_actual", time_field: "date", scope_mode: "process", process_column: "process_id", max_rows: 5000 },
  { id: "d2", code: "org_thing", name: "Org thing", connection: "hrms", source_table: "org_table", time_field: null, scope_mode: "org", max_rows: 100 },
];
const FIELDS = [
  { dataset_id: "d1", field_key: "date", label: "Date", column_name: "score_date", role: "time", data_type: "date", default_agg: "count", format: "date", lookup: "none", sort_order: 1, hidden: 0 },
  { dataset_id: "d1", field_key: "value", label: "Value", column_name: "actual_value", role: "measure", data_type: "number", default_agg: "avg", format: "number", lookup: "none", sort_order: 2, hidden: 0 },
  { dataset_id: "d2", field_key: "n", label: "N", column_name: "n", role: "measure", data_type: "number", default_agg: "sum", format: "number", lookup: "none", sort_order: 1, hidden: 0 },
];

beforeEach(() => {
  invalidateCatalogue();
  query.mockReset(); scopeClause.mockReset(); orgWide.mockReset();
  orgWide.mockResolvedValue(false);
  scopeClause.mockResolvedValue({ sql: "t.`process_id` = ?", params: ["proc-1"] });
  query.mockImplementation(async (sql: string) => {
    if (/FROM analytics_dataset WHERE/.test(sql)) return [DATASETS];
    if (/FROM analytics_dataset_field/.test(sql)) return [FIELDS];
    return [[{ d0: "2026-09-01", m0: "12.5" }]];
  });
});

describe("/api/analytics-catalogue", () => {
  it("refuses roles outside the viewer list", async () => {
    const res = await request(appFor("employee")).get("/api/analytics-catalogue/datasets");
    expect(res.status).toBe(403);
  });

  it("hides organisation-wide datasets and physical column names from a scoped viewer", async () => {
    const res = await request(appFor("process_manager")).get("/api/analytics-catalogue/datasets");
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: any) => d.code)).toEqual(["process_kpi_daily"]);
    expect(res.body.data[0].sourceTable).toBeUndefined();
    expect(res.body.data[0].fields[0].columnName).toBe("");
  });

  it("always sends the viewer's scope clause to the database", async () => {
    const res = await request(appFor("process_manager")).post("/api/analytics-catalogue/query")
      .send({ dataset: "process_kpi_daily", dimensions: [{ field: "date", grain: "day" }], measures: [{ field: "value" }], dateRange: { preset: "custom", from: "2026-09-01", to: "2026-09-30" } });
    expect(res.status).toBe(200);
    const dataCall = query.mock.calls.find(([sql]) => /FROM `process_metric_actual` t/.test(sql) && /GROUP BY/.test(sql))!;
    expect(dataCall[0]).toContain("(t.`process_id` = ?)");
    expect(dataCall[1]).toEqual(["2026-09-01", "2026-09-30", "proc-1"]);
    expect(res.body.data.rows[0]).toEqual({ d0: "2026-09-01", m0: 12.5 });
  });

  it("turns a viewer's mistake into a 400 with a readable message", async () => {
    const res = await request(appFor("manager")).post("/api/analytics-catalogue/query")
      .send({ dataset: "process_kpi_daily", dimensions: [{ field: "password" }], measures: [{ agg: "count" }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unknown field "password"/);
  });

  it("unknown dataset is 404; org dataset is 403 for a scoped viewer", async () => {
    expect((await request(appFor("manager")).post("/api/analytics-catalogue/query").send({ dataset: "nope", dimensions: [], measures: [{ agg: "count" }] })).status).toBe(404);
    expect((await request(appFor("manager")).post("/api/analytics-catalogue/query").send({ dataset: "org_thing", dimensions: [], measures: [{ field: "n" }] })).status).toBe(403);
  });

  it("admin is branch-scoped like hr: organisation-wide datasets are refused, a super_admin is let through", async () => {
    const q = { dataset: "org_thing", dimensions: [], measures: [{ field: "n" }] };
    expect((await request(appFor("admin")).post("/api/analytics-catalogue/query").send(q)).status).toBe(403);
    const list = await request(appFor("admin")).get("/api/analytics-catalogue/datasets");
    expect(list.body.data.map((d: any) => d.code)).toEqual(["process_kpi_daily"]);
    expect((await request(appFor("super_admin")).post("/api/analytics-catalogue/query").send(q)).status).not.toBe(403);
  });

  it("only admins may register datasets or list tables", async () => {
    expect((await request(appFor("process_manager")).post("/api/analytics-catalogue/admin/datasets").send({})).status).toBe(403);
    expect((await request(appFor("ceo")).get("/api/analytics-catalogue/admin/tables")).status).toBe(403);
    const res = await request(appFor("admin")).post("/api/analytics-catalogue/admin/datasets").send({ code: "Bad Code" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATASET");
  });
});
