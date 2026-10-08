import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Communication dispatch (owner ruling 2026-10-01): senders and log readers are limited to their branch / scope. */
const { dbExecute, canViewEmployee, send, bulkSend, getLogs, getStats, retry, state } = vi.hoisted(() => ({
  dbExecute: vi.fn(), canViewEmployee: vi.fn(),
  send: vi.fn(async () => ({})), bulkSend: vi.fn(async () => ({})), getLogs: vi.fn(async () => ({ logs: [] })),
  getStats: vi.fn(async () => ({})), retry: vi.fn(async () => undefined),
  state: { orgWide: false },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee,
  resolveUserBusinessScope: async () => ({}),
  buildEmployeeScopeCondition: () => (state.orgWide ? { sql: "1=1", params: [] } : { sql: "e.branch_id = ?", params: ["b1"] }),
}));
vi.mock("../../../shared/reportingSpan.js", () => ({ reportingSpanClause: async () => null }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn(async () => null) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../dispatch.service.js", () => ({ dispatchService: { send, bulkSend, getLogs, getStats, retry } }));
vi.mock("../template.service.js", () => ({ templateService: {} }));
vi.mock("../notification-preferences.service.js", () => ({ notificationPreferencesService: {} }));
vi.mock("../provider-config.service.js", () => ({ providerConfigService: {} }));
vi.mock("../providers/provider.factory.js", () => ({ providerFactory: {} }));

const { communicationRouter } = await import("../communication.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/communication", communicationRouter); return a; };

beforeEach(() => {
  state.orgWide = false; canViewEmployee.mockReset(); dbExecute.mockReset();
  [send, bulkSend, getLogs, getStats, retry].forEach((f) => f.mockClear());
  dbExecute.mockImplementation(async (sql: string, params: any[]) => {
    if (/SELECT e\.id FROM employees e WHERE e\.id IN/.test(sql)) return [params.filter((p) => p === "emp-a").map((id) => ({ id })), []];
    if (/FROM dispatch_log WHERE id/.test(sql)) return [[{ recipient_employee_id: "emp-b" }], []];
    return [[], []];
  });
});

describe("communication branch scoping", () => {
  it("send refuses recipients outside the sender's scope", async () => {
    const res = await request(app()).post("/api/communication/dispatch/send").send({ recipient_employee_ids: ["emp-a", "emp-b"] });
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it("send to in-scope recipients works; org-wide senders skip the check", async () => {
    expect((await request(app()).post("/api/communication/dispatch/send").send({ recipient_employee_ids: ["emp-a"] })).status).toBe(200);
    state.orgWide = true;
    expect((await request(app()).post("/api/communication/dispatch/send").send({ recipient_employee_ids: ["emp-a", "emp-z"] })).status).toBe(200);
  });
  it("bulk-send, logs and stats receive the scope", async () => {
    const a = app();
    await request(a).post("/api/communication/dispatch/bulk-send").send({ recipient_filter: {} });
    expect((bulkSend.mock.calls[0] as any)[1].sql).toContain("e.branch_id");
    await request(a).get("/api/communication/dispatch/logs");
    expect((getLogs.mock.calls[0] as any)[1].sql).toContain("e.branch_id");
    await request(a).get("/api/communication/dispatch/stats");
    expect((getStats.mock.calls[0] as any)[0].sql).toContain("e.branch_id");
  });
  it("retry of a dispatch addressed outside the scope is 403", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).post("/api/communication/dispatch/retry/d1")).status).toBe(403);
    expect(retry).not.toHaveBeenCalled();
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).post("/api/communication/dispatch/retry/d1")).status).toBe(200);
  });
});
