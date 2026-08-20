import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

const assignEmployeeMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "assign-1" }));
vi.mock("../roster.service.js", () => ({ rosterService: { assignEmployee: assignEmployeeMock } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "user-1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { rosterBuilderRouter } from "../roster-builder.routes.js";

describe("POST /assign", () => {
  it("calls assignEmployee with cycleId threaded through", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/wfm/roster-builder", rosterBuilderRouter);

    const res = await request(app)
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "shift-1" });

    expect(res.status).toBe(201);
    expect(assignEmployeeMock).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "shift-1" }),
      "user-1"
    );
  });

  it("returns 400 when employeeId is missing", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/wfm/roster-builder", rosterBuilderRouter);

    const res = await request(app)
      .post("/api/wfm/roster-builder/assign")
      .send({ rosterDate: "2026-08-24", cycleId: "cycle-1" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when cycleId is missing", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/wfm/roster-builder", rosterBuilderRouter);

    const res = await request(app)
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24" });

    expect(res.status).toBe(400);
  });
});
