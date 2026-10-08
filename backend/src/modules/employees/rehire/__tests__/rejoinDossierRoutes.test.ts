import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { canViewEmployee } = vi.hoisted(() => ({ canViewEmployee: vi.fn() }));
vi.mock("../../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));

const { buildDossier } = vi.hoisted(() => ({ buildDossier: vi.fn() }));
vi.mock("../dossier/dossierService.js", () => ({ buildDossier }));

let authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
vi.mock("../../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

const { rejoinDossierRouter } = await import("../../rejoin-dossier.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/employees", rejoinDossierRouter); return a; };

beforeEach(() => {
  dbExecute.mockReset(); canViewEmployee.mockReset(); buildDossier.mockReset();
  canViewEmployee.mockResolvedValue(true);
  dbExecute.mockResolvedValue([[{ employee_id: "e1" }], []]);
  buildDossier.mockResolvedValue({ request: { id: "r1", employeeId: "e1" }, sections: {} });
});

describe("GET /reactivation/:id/dossier", () => {
  it("403s a role that has no business reading it", async () => {
    authUser = { id: "u1", role: "employee", roles: ["employee"] };
    const res = await request(app()).get("/api/employees/reactivation/r1/dossier");
    expect(res.status).toBe(403);
    expect(buildDossier).not.toHaveBeenCalled();
  });

  it("404s an unknown request without building anything", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    dbExecute.mockResolvedValue([[], []]);
    const res = await request(app()).get("/api/employees/reactivation/nope/dossier");
    expect(res.status).toBe(404);
    expect(buildDossier).not.toHaveBeenCalled();
  });

  it("403s a branch head whose scope does not cover the employee, and builds nothing", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).get("/api/employees/reactivation/r1/dossier");
    expect(res.status).toBe(403);
    expect(canViewEmployee).toHaveBeenCalledWith("bh1", "e1");
    expect(buildDossier).not.toHaveBeenCalled();
  });

  it.each(["branch_head", "hr", "admin", "super_admin"])("returns the dossier for %s", async (role) => {
    authUser = { id: "u1", role, roles: [role] };
    const res = await request(app()).get("/api/employees/reactivation/r1/dossier");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { request: { id: "r1", employeeId: "e1" }, sections: {} } });
  });

  it("500s with a message when the aggregator throws", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    buildDossier.mockRejectedValue(new Error("db gone"));
    const res = await request(app()).get("/api/employees/reactivation/r1/dossier");
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
