import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route contracts for /api/analytics-catalogue/dashboards. requireRole is NOT mocked. Pinned here: the role gate, that a
 * dashboard the viewer cannot see is a 404 (never a 403, which would reveal it exists), optimistic locking (409), that an
 * 'edit' share does not let you re-share (403: the viewer can already see the dashboard, so nothing is revealed), and that
 * a bad body is a 400 with a readable message.
 */

const { query, getConnection } = vi.hoisted(() => ({ query: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: query, query, getConnection } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (orig) => ({
  ...(await orig<typeof import("../../../middleware/authMiddleware.js")>()),
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
}));

vi.mock("../../../shared/scopeAccess.js", () => ({
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
  buildScopeWhereClause: async () => ({ sql: "p.id = ?", params: ["proc-1"] }),
  hasAnyRole: async (_id: string, ...roles: string[]) => roles.includes(actor.role),
  hasOrgWideScope: async () => false,
}));

import { dashboardsRouter } from "../dashboards.routes.js";

const DASH = "11111111-1111-4111-8111-111111111111";
function appFor(role: string, id = `user-${role}`) {
  actor = { id, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/analytics-catalogue/dashboards", dashboardsRouter);
  return app;
}

let dashboards: any[];
let shares: any[];
let widgets: any[];
const conn = { query, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };

beforeEach(() => {
  dashboards = [{
    id: DASH, name: "Ops board", description: null, owner_user_id: "owner-1", home_branch_id: null, home_process_id: null, theme: "light",
    settings_json: '{"density":"compact"}', is_template: 0, version: 3, updated_at: new Date("2026-09-30T10:00:00Z"), owner_name: "Olive Owner", widget_count: 1,
  }];
  shares = [];
  widgets = [{ id: "w-1", widget_type: "kpi", title: "Headcount", subtitle: null, query_json: { dataset: "headcount" }, viz_json: '{"color":"gold"}', layout_json: null }];
  query.mockReset(); getConnection.mockReset();
  for (const f of [conn.beginTransaction, conn.commit, conn.rollback, conn.release]) f.mockReset();
  getConnection.mockResolvedValue(conn);
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM process_master p WHERE/.test(sql)) return [[{ id: "proc-1" }]];
    if (/SELECT DISTINCT branch_id FROM process_master/.test(sql)) return [[{ branch_id: "branch-1" }]];
    if (/FROM analytics_dashboard d/.test(sql)) return [/WHERE d\.id = \?/.test(sql) ? dashboards.filter((d) => d.id === params[0]) : dashboards];
    if (/FROM analytics_dashboard_share/.test(sql)) return [shares];
    if (/^SELECT[\s\S]*FROM analytics_widget/.test(sql)) return [/dashboard_id <> \?/.test(sql) ? [] : widgets];
    return [{ affectedRows: 1 }];
  });
});

const base = "/api/analytics-catalogue/dashboards";
const writes = () => query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));

describe("/api/analytics-catalogue/dashboards", () => {
  it("refuses roles outside the viewer list on every route", async () => {
    const app = appFor("employee");
    expect((await request(app).get(base)).status).toBe(403);
    expect((await request(app).get(`${base}/${DASH}`)).status).toBe(403);
    expect((await request(app).post(base).send({ name: "x" })).status).toBe(403);
    expect((await request(app).get(`${base}/share-targets/users?q=a`)).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it("lists only dashboards the viewer can reach, with the agreed fields", async () => {
    expect((await request(appFor("manager")).get(base)).body).toEqual({ success: true, data: [] });
    shares = [{ dashboard_id: DASH, principal_type: "process", principal_value: "proc-1", permission: "view" }];
    const res = await request(appFor("manager")).get(base);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{
      id: DASH, name: "Ops board", description: null, theme: "light", ownerUserId: "owner-1", ownerName: "Olive Owner", isOwner: false,
      canEdit: false, isTemplate: false, widgetCount: 1, homeBranchId: null, homeProcessId: null, updatedAt: "2026-09-30T10:00:00.000Z",
    }]);
  });

  it("a viewer with no access gets 404, not 403, on read and on every write", async () => {
    const app = appFor("manager");
    const res = await request(app).get(`${base}/${DASH}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, code: "NOT_FOUND", message: "Dashboard not found" });
    expect((await request(app).put(`${base}/${DASH}`).send({ name: "x", version: 3 })).status).toBe(404);
    expect((await request(app).put(`${base}/${DASH}/widgets`).send({ widgets: [], version: 3 })).status).toBe(404);
    expect((await request(app).put(`${base}/${DASH}/shares`).send({ shares: [] })).status).toBe(404);
    expect((await request(app).post(`${base}/${DASH}/duplicate`).send({})).status).toBe(404);
    expect((await request(app).delete(`${base}/${DASH}`)).status).toBe(404);
    expect((await request(app).get(`${base}/22222222-2222-4222-8222-222222222222`)).status).toBe(404);
    expect(writes()).toHaveLength(0);
  });

  it("returns the dashboard, parsed widgets, and shares only to editors", async () => {
    shares = [{ dashboard_id: DASH, principal_type: "role", principal_value: "manager", permission: "view" }];
    const viewerRes = await request(appFor("manager")).get(`${base}/${DASH}`);
    expect(viewerRes.status).toBe(200);
    expect(viewerRes.body.data.canEdit).toBe(false);
    expect(viewerRes.body.data.shares).toEqual([]);
    expect(viewerRes.body.data.dashboard).toMatchObject({ id: DASH, settings: { density: "compact" }, version: 3, canEdit: false, isOwner: false });
    expect(viewerRes.body.data.widgets).toEqual([
      { id: "w-1", widgetType: "kpi", title: "Headcount", subtitle: null, query: { dataset: "headcount" }, viz: { color: "gold" }, layout: {} },
    ]);
    const ownerRes = await request(appFor("manager", "owner-1")).get(`${base}/${DASH}`);
    expect(ownerRes.body.data.canEdit).toBe(true);
    expect(ownerRes.body.data.shares).toEqual([{ principalType: "role", principalValue: "manager", permission: "view" }]);
  });

  it("a view-only viewer cannot save (403)", async () => {
    shares = [{ dashboard_id: DASH, principal_type: "role", principal_value: "manager", permission: "view" }];
    const res = await request(appFor("manager")).put(`${base}/${DASH}/widgets`).send({ widgets: [], version: 3 });
    expect(res.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it("a stale version is a 409 and nothing is written", async () => {
    const app = appFor("manager", "owner-1");
    const res = await request(app).put(`${base}/${DASH}`).send({ name: "Renamed", version: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.body.message).toMatch(/changed by someone else/);
    expect((await request(app).put(`${base}/${DASH}/widgets`).send({ widgets: [], version: 2 })).status).toBe(409);
    expect((await request(app).put(`${base}/${DASH}`).send({ name: "Renamed" })).status).toBe(409);
    expect(writes()).toHaveLength(0);
  });

  it("losing the race inside the UPDATE is also a 409", async () => {
    const impl = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, params?: unknown[]) => (/^\s*UPDATE analytics_dashboard SET/.test(sql) ? [{ affectedRows: 0 }] : impl(sql, params)));
    const app = appFor("manager", "owner-1");
    expect((await request(app).put(`${base}/${DASH}`).send({ name: "Renamed", version: 3 })).status).toBe(409);
    expect((await request(app).put(`${base}/${DASH}/widgets`).send({ widgets: [{ widgetType: "kpi" }], version: 3 })).status).toBe(409);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("the current version saves, in one transaction, and bumps the version", async () => {
    const res = await request(appFor("manager", "owner-1")).put(`${base}/${DASH}/widgets`)
      .send({ widgets: [{ id: "33333333-3333-4333-8333-333333333333", widgetType: "bar", query: { dataset: "headcount" } }, { widgetType: "text" }], version: 3 });
    expect(res.status).toBe(200);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    const w = writes();
    expect(w[0][0]).toMatch(/UPDATE analytics_dashboard SET version = version \+ 1 WHERE id = \? AND version = \?/);
    expect(w[0][1]).toEqual([DASH, 3]);
    const inserts = w.filter(([sql]) => /INSERT INTO analytics_widget/.test(sql));
    expect(inserts.map(([, p]) => [p[0] === "33333333-3333-4333-8333-333333333333", p[1], p[2], p[8]])).toEqual([[true, DASH, "bar", 0], [false, DASH, "text", 1]]);
    expect(w[w.length - 1][0]).toMatch(/SET active_status = 0 WHERE dashboard_id = \? AND active_status = 1 AND id NOT IN/);
  });

  it("an 'edit' share does not allow re-sharing or deleting: 403", async () => {
    shares = [{ dashboard_id: DASH, principal_type: "user", principal_value: "user-manager", permission: "edit" }];
    const app = appFor("manager");
    expect((await request(app).get(`${base}/${DASH}`)).body.data.canEdit).toBe(true);
    const res = await request(app).put(`${base}/${DASH}/shares`).send({ shares: [{ principalType: "role", principalValue: "hr", permission: "edit" }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect((await request(app).delete(`${base}/${DASH}`)).status).toBe(403);
    expect(writes()).toHaveLength(0);
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("the owner and a super_admin can replace shares; a branch admin who does not own it cannot even see it", async () => {
    const body = { shares: [{ principalType: "role", principalValue: "hr" }, { principalType: "role", principalValue: "hr", permission: "edit" }] };
    expect((await request(appFor("manager", "owner-1")).put(`${base}/${DASH}/shares`).send(body)).status).toBe(200);
    expect(writes().map(([sql]) => sql.trim().split(" ").slice(0, 3).join(" "))).toEqual(["DELETE FROM analytics_dashboard_share", "INSERT INTO analytics_dashboard_share"]);
    expect((await request(appFor("super_admin")).put(`${base}/${DASH}/shares`).send(body)).status).toBe(200);
    // admin is branch-scoped like hr (owner ruling 2026-10-01): not an org-wide viewer, so another user's private dashboard is a 404.
    const before = writes().length;
    expect((await request(appFor("admin")).put(`${base}/${DASH}/shares`).send(body)).status).toBe(404);
    expect((await request(appFor("admin")).get(`${base}/${DASH}`)).status).toBe(404);
    expect(writes()).toHaveLength(before);
  });

  it("a branch admin still edits dashboards it owns or that are shared to it", async () => {
    dashboards[0].owner_user_id = "user-admin";
    expect((await request(appFor("admin")).get(`${base}/${DASH}`)).body.data.canEdit).toBe(true);
  });

  it("only an admin can make a template", async () => {
    await request(appFor("manager", "owner-1")).put(`${base}/${DASH}`).send({ name: "Ops board", version: 3, isTemplate: true });
    await request(appFor("super_admin")).put(`${base}/${DASH}`).send({ name: "Ops board", version: 3, isTemplate: true });
    dashboards[0].owner_user_id = "user-admin";
    await request(appFor("admin")).put(`${base}/${DASH}`).send({ name: "Ops board", version: 3, isTemplate: true });
    const flags = writes().map(([, p]) => p[6]);
    expect(flags).toEqual([0, 1, 1]);
  });

  it("an invalid body is a 400 with a readable message", async () => {
    const app = appFor("manager", "owner-1");
    const create = await request(app).post(base).send({ name: "" });
    expect(create.status).toBe(400);
    expect(create.body).toEqual({ success: false, code: "INVALID_QUERY", message: "Give the dashboard a name" });
    const theme = await request(app).put(`${base}/${DASH}`).send({ name: "x", theme: "neon", version: 3 });
    expect(theme.status).toBe(400);
    expect(theme.body.message).toMatch(/Unknown theme/);
    const widget = await request(app).put(`${base}/${DASH}/widgets`).send({ widgets: [{ widgetType: "bar", query: {} }], version: 3 });
    expect(widget.status).toBe(400);
    expect(widget.body.message).toBe("Widget 1 query needs a dataset");
    const share = await request(app).put(`${base}/${DASH}/shares`).send({ shares: [{ principalType: "team", principalValue: "x" }] });
    expect(share.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("creates a dashboard owned by the caller", async () => {
    const impl = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (/^\s*INSERT INTO analytics_dashboard \(/.test(sql)) {
        dashboards.push({ ...dashboards[0], id: params[0], name: params[1], owner_user_id: params[3], version: 1, is_template: params[8], widget_count: 0 });
        widgets = [];
      }
      return impl(sql, params);
    });
    const res = await request(appFor("manager")).post(base).send({ name: "Mine", isTemplate: true });
    expect(res.status).toBe(201);
    expect(res.body.data.dashboard).toMatchObject({ name: "Mine", ownerUserId: "user-manager", isOwner: true, canEdit: true, isTemplate: false, version: 1 });
    expect(res.body.data.widgets).toEqual([]);
  });
});
