/**
 * The joining-kit router is mounted at /api/employees BEFORE the reactivation and rejoin-dossier
 * routers. Its HR-only role gate used to be a bare joiningKitRouter.use(requireAuth, requireRole(...)),
 * which runs for EVERY request reaching the router, so a branch head / manager / payroll head got
 * 403 on /api/employees/reactivation/* before the reactivation router ever saw the request.
 * The gate must cover the kit's own paths only.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, getConnection: vi.fn() } }));

let authUser: { id: string; role: string; roles: string[] } = { id: "u1", role: "hr", roles: ["hr"] };
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

vi.mock("../joiningKitPublic.service.js", () => ({
  getPublicKitSession: vi.fn(), getPublicKitFile: vi.fn(), startKitEsign: vi.fn(),
}));
vi.mock("../joiningKitDispatch.service.js", () => ({
  queueJoiningKit: vi.fn(), dispatchJoiningKit: vi.fn(), resendKitEsignLink: vi.fn(),
  redispatchDeadKit: vi.fn(), kitEsignSessionIsAlive: vi.fn(async () => true),
}));
vi.mock("../joiningKitSync.service.js", () => ({ syncKitEsignStatus: vi.fn() }));
vi.mock("../joiningKitAssembly.service.js", () => ({ kitEligibleDocuments: vi.fn(async () => []) }));
vi.mock("../joiningKitDraftRepair.service.js", () => ({ regenerateMissingKitDrafts: vi.fn() }));

const { joiningKitRouter } = await import("../joiningKit.routes.js");

/** A stand-in for the routers app.ts mounts after the kit router (reactivation, dossier). */
const probeRouter = express.Router();
probeRouter.get("/reactivation/queue", (_req, res) => res.status(200).json({ success: true, probe: "queue" }));
probeRouter.get("/reactivation/:id/dossier", (_req, res) => res.status(200).json({ success: true, probe: "dossier" }));
probeRouter.post("/reactivation/initiate", (_req, res) => res.status(200).json({ success: true, probe: "initiate" }));

const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/api/employees", joiningKitRouter);
  a.use("/api/employees", probeRouter);
  return a;
};

const as = (role: string) => { authUser = { id: `u-${role}`, role, roles: [role] }; };
const EMP = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockResolvedValue([[], []]);
});

describe("joining-kit role gate does not shadow routers mounted after it", () => {
  it.each(["branch_head", "manager", "payroll_head"])("a %s reaches the reactivation queue", async (role) => {
    as(role);
    const res = await request(app()).get("/api/employees/reactivation/queue");
    expect(res.status).toBe(200);
    expect(res.body.probe).toBe("queue");
  });

  it.each(["branch_head", "manager", "payroll_head"])("a %s reaches a request's dossier", async (role) => {
    as(role);
    const res = await request(app()).get("/api/employees/reactivation/abc/dossier");
    expect(res.status).toBe(200);
    expect(res.body.probe).toBe("dossier");
  });

  it("a manager can POST to a later router (raise a request)", async () => {
    as("manager");
    const res = await request(app()).post("/api/employees/reactivation/initiate").send({});
    expect(res.status).toBe(200);
  });
});

describe("joining-kit routes keep their HR-only gate", () => {
  it.each(["branch_head", "manager", "payroll_head"])("GET kit state 403s a %s", async (role) => {
    as(role);
    const res = await request(app()).get(`/api/employees/${EMP}/joining-kit`);
    expect(res.status).toBe(403);
  });

  it.each(["branch_head", "manager"])("kit sub-paths 403 a %s", async (role) => {
    as(role);
    expect((await request(app()).get(`/api/employees/${EMP}/joining-kit/preview`)).status).toBe(403);
    expect((await request(app()).post(`/api/employees/${EMP}/joining-kit/send`).send({})).status).toBe(403);
    expect((await request(app()).get(`/api/employees/${EMP}/joining-kit/k1/file`)).status).toBe(403);
  });

  it.each(["hr", "super_admin"])("GET kit state works for %s", async (role) => {
    as(role);
    const res = await request(app()).get(`/api/employees/${EMP}/joining-kit`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });
});

describe("source guard", () => {
  it("joiningKitRouter.use( is never called without a path argument", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "..", "joiningKit.routes.ts"), "utf8");
    const calls = [...src.matchAll(/joiningKitRouter\.use\(\s*([^,)]*)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const firstArg of calls) expect(firstArg).toMatch(/^["'`]\//);
  });
});
