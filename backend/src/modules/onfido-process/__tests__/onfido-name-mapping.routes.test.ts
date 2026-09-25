import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  listMappings,
  verifyMapping,
  getMappingRowById,
  employeeExists,
} = vi.hoisted(() => ({
  listMappings: vi.fn(),
  verifyMapping: vi.fn(),
  getMappingRowById: vi.fn(),
  employeeExists: vi.fn(),
}));

vi.mock("../onfido-name-mapping.service.js", () => ({
  listMappings,
  verifyMapping,
  getMappingRowById,
  employeeExists,
}));

// requireAuth/requireRole default to an authenticated "admin" caller so every
// test below is exercising the route logic, not the gate. x-test-role lets a
// couple of tests specifically probe the 403 boundary.
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "user-9", role: String(req.headers["x-test-role"] ?? "admin") };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole:
    (...roles: string[]) =>
    (req: any, res: any, next: any) => {
      const role = req.authUser?.role;
      if (!role || !roles.includes(role)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      next();
    },
}));

let onfidoNameMappingRouter: (typeof import("../onfido-name-mapping.routes.js"))["onfidoNameMappingRouter"];
let app: express.Express;

beforeAll(async () => {
  ({ onfidoNameMappingRouter } = await import("../onfido-name-mapping.routes.js"));
  app = express();
  app.use(express.json());
  app.use("/api/onfido-process/name-mapping", onfidoNameMappingRouter);
});

beforeEach(() => {
  listMappings.mockReset();
  verifyMapping.mockReset();
  getMappingRowById.mockReset();
  employeeExists.mockReset();
  employeeExists.mockResolvedValue(true);
});

describe("GET /api/onfido-process/name-mapping", () => {
  it("returns every mapping row when no ?verified filter is given", async () => {
    listMappings.mockResolvedValueOnce([{ id: "map-1", rawName: "Priya Sharma" }]);

    const res = await request(app).get("/api/onfido-process/name-mapping");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(listMappings).toHaveBeenCalledWith({ verified: undefined });
  });

  it("passes verified=false through as a boolean filter, not the string 'false'", async () => {
    listMappings.mockResolvedValueOnce([]);

    await request(app).get("/api/onfido-process/name-mapping?verified=false");

    expect(listMappings).toHaveBeenCalledWith({ verified: false });
  });

  it("passes verified=true through as a boolean filter", async () => {
    listMappings.mockResolvedValueOnce([]);

    await request(app).get("/api/onfido-process/name-mapping?verified=true");

    expect(listMappings).toHaveBeenCalledWith({ verified: true });
  });

  it("rejects a caller without admin or hr role", async () => {
    const res = await request(app)
      .get("/api/onfido-process/name-mapping")
      .set("x-test-role", "employee");

    expect(res.status).toBe(403);
    expect(listMappings).not.toHaveBeenCalled();
  });

  it("allows a caller with the hr role (not just admin)", async () => {
    listMappings.mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/api/onfido-process/name-mapping")
      .set("x-test-role", "hr");

    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/onfido-process/name-mapping/:id", () => {
  it("verifies the mapping with the caller's own id, never a body-supplied one", async () => {
    getMappingRowById
      .mockResolvedValueOnce({ id: "map-1", employeeId: "emp-1" }) // existence check
      .mockResolvedValueOnce({ id: "map-1", employeeId: "emp-2", verifiedByHr: true }); // post-write read
    verifyMapping.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .patch("/api/onfido-process/name-mapping/map-1")
      .send({ employeeId: "emp-2", verifiedByUserId: "someone-else" }); // attempted spoof, must be ignored

    expect(res.status).toBe(200);
    expect(verifyMapping).toHaveBeenCalledWith("map-1", {
      employeeId: "emp-2",
      verifiedByUserId: "user-9", // from req.authUser, not the request body
    });
    expect(res.body.data.verifiedByHr).toBe(true);
  });

  it("accepts employeeId: null as a valid HR decision (no employee matches)", async () => {
    getMappingRowById
      .mockResolvedValueOnce({ id: "map-1", employeeId: "emp-1" })
      .mockResolvedValueOnce({ id: "map-1", employeeId: null, verifiedByHr: true });
    verifyMapping.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .patch("/api/onfido-process/name-mapping/map-1")
      .send({ employeeId: null });

    expect(res.status).toBe(200);
    expect(verifyMapping).toHaveBeenCalledWith("map-1", {
      employeeId: null,
      verifiedByUserId: "user-9",
    });
  });

  it("rejects a non-string, non-null employeeId with 400 before touching the service", async () => {
    const res = await request(app)
      .patch("/api/onfido-process/name-mapping/map-1")
      .send({ employeeId: 12345 });

    expect(res.status).toBe(400);
    expect(getMappingRowById).not.toHaveBeenCalled();
    expect(verifyMapping).not.toHaveBeenCalled();
  });

  it("rejects an employeeId that matches no employee with 400 and writes nothing", async () => {
    getMappingRowById.mockResolvedValueOnce({ id: "map-1", employeeId: "emp-1" });
    employeeExists.mockResolvedValueOnce(false);

    const res = await request(app)
      .patch("/api/onfido-process/name-mapping/map-1")
      .send({ employeeId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(400);
    expect(employeeExists).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000000");
    expect(verifyMapping).not.toHaveBeenCalled();
  });

  it("does not look up an employee when employeeId is null", async () => {
    getMappingRowById
      .mockResolvedValueOnce({ id: "map-1", employeeId: "emp-1" })
      .mockResolvedValueOnce({ id: "map-1", employeeId: null });
    verifyMapping.mockResolvedValueOnce(undefined);

    await request(app)
      .patch("/api/onfido-process/name-mapping/map-1")
      .send({ employeeId: null });

    expect(employeeExists).not.toHaveBeenCalled();
  });

  it("returns 404 when the mapping row does not exist", async () => {
    getMappingRowById.mockResolvedValueOnce(null);

    const res = await request(app)
      .patch("/api/onfido-process/name-mapping/nonexistent")
      .send({ employeeId: "emp-1" });

    expect(res.status).toBe(404);
    expect(verifyMapping).not.toHaveBeenCalled();
  });

  it("rejects a caller without admin or hr role", async () => {
    const res = await request(app)
      .patch("/api/onfido-process/name-mapping/map-1")
      .set("x-test-role", "employee")
      .send({ employeeId: "emp-1" });

    expect(res.status).toBe(403);
    expect(verifyMapping).not.toHaveBeenCalled();
  });
});
