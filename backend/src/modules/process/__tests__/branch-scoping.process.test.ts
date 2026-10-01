import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Process writes (configuration, edit, status, create): hr and admin are limited to their own branch; only org-wide roles are unrestricted. */
const { execute, resolveScope, saveConfiguration, update, create, updateStatus } = vi.hoisted(() => ({
  execute: vi.fn(), resolveScope: vi.fn(),
  saveConfiguration: vi.fn(async (_req: any, res: any) => res.json({ ok: true })),
  update: vi.fn(async (_req: any, res: any) => res.json({ ok: true })),
  create: vi.fn(async (_req: any, res: any) => res.json({ ok: true })),
  updateStatus: vi.fn(async (_req: any, res: any) => res.json({ ok: true })),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: resolveScope }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../process.controller.js", () => ({
  processController: {
    list: vi.fn(), listMyProcesses: vi.fn(), getById: vi.fn(), getConfiguration: vi.fn(),
    saveConfiguration, update, create, updateStatus,
  },
}));

import { processRouter } from "../process.routes.js";
const app = () => { const a = express(); a.use(express.json()); a.use("/api/processes", processRouter); return a; };

const hr = { roles: ["hr"], branchId: "b1", assignments: [] };
beforeEach(() => {
  [saveConfiguration, update, create, updateStatus].forEach((m) => m.mockClear());
  resolveScope.mockResolvedValue(hr);
  execute.mockReset();
  execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/FROM process_master WHERE id/.test(String(sql))) return [params?.[0] === "p-own" ? [{ branch_id: "b1" }] : params?.[0] === "p-other" ? [{ branch_id: "b2" }] : [], []];
    if (/FROM branch_master WHERE branch_name/.test(String(sql))) return [params?.[0] === "Noida" ? [{ id: "b1" }] : [{ id: "b2" }], []];
    return [[], []];
  });
});

describe("process writes", () => {
  it("hr cannot configure / edit / (de)activate a process of another branch", async () => {
    expect((await request(app()).put("/api/processes/p-other/configuration").send({ values: {} })).status).toBe(403);
    expect((await request(app()).put("/api/processes/p-other").send({})).status).toBe(403);
    expect((await request(app()).patch("/api/processes/p-other/status").send({ activeStatus: false })).status).toBe(403);
    expect([saveConfiguration, update, updateStatus].every((m) => m.mock.calls.length === 0)).toBe(true);
  });
  it("hr can write to a process of its own branch", async () => {
    expect((await request(app()).put("/api/processes/p-own/configuration").send({ values: {} })).status).toBe(200);
    expect((await request(app()).patch("/api/processes/p-own/status").send({ activeStatus: true })).status).toBe(200);
  });
  it("hr cannot move or create a process into another branch", async () => {
    expect((await request(app()).put("/api/processes/p-own").send({ branchName: "Mumbai" })).status).toBe(403);
    expect((await request(app()).post("/api/processes").send({ branchName: "Mumbai" })).status).toBe(403);
    expect((await request(app()).post("/api/processes").send({ branchName: "Noida" })).status).toBe(200);
  });
  it("hr with no resolvable branch cannot create anything (fail closed)", async () => {
    resolveScope.mockResolvedValue({ roles: ["hr"], branchId: null, assignments: [] });
    expect((await request(app()).post("/api/processes").send({})).status).toBe(403);
  });
  it("admin is branch-scoped like hr (owner ruling 2026-10-01)", async () => {
    resolveScope.mockResolvedValue({ roles: ["admin"], branchId: "b1", assignments: [] });
    expect((await request(app()).put("/api/processes/p-other/configuration").send({ values: {} })).status).toBe(403);
    expect((await request(app()).put("/api/processes/p-own/configuration").send({ values: {} })).status).toBe(200);
    expect((await request(app()).post("/api/processes").send({ branchName: "Mumbai" })).status).toBe(403);
  });
  it("org-wide roles (super_admin) are unrestricted", async () => {
    resolveScope.mockResolvedValue({ roles: ["super_admin"], branchId: null, assignments: [] });
    expect((await request(app()).put("/api/processes/p-other/configuration").send({ values: {} })).status).toBe(200);
    expect((await request(app()).post("/api/processes").send({ branchName: "Mumbai" })).status).toBe(200);
  });
});
