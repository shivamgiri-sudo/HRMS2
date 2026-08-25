import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { esiRegDocsRouter } from "../esi-reg-docs.routes.js";

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (_req as any).authUser = { id: "user-1", roles: ["payroll_head"] };
      next();
    },
}));

import { db } from "../../../db/mysql.js";

const app = express();
app.use(express.json());
app.use("/api/payroll", esiRegDocsRouter);

describe("GET /api/payroll/esi-reg-docs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated ESI-eligible employees with readiness flags", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ total: 1 }] as any, []])
      .mockResolvedValueOnce([
        [
          {
            employee_id: "emp-1",
            emp_code: "EMP001",
            name: "Alice Smith",
            branch: "Chennai",
            esic_number: "1234567890",
            pan_ready: 1,
            pan_doc_id: "doc-1",
            pan_file_url: "/api/files/employee-documents/pan.jpg",
            photo_ready: 1,
            photo_url: "/api/files/employee-photos/emp1.jpg",
            bank_ready: 1,
          },
        ] as any,
        [],
      ]);

    const res = await request(app).get("/api/payroll/esi-reg-docs");
    expect(res.status).toBe(200);
    expect(res.body.employees).toHaveLength(1);
    expect(res.body.employees[0].pan_ready).toBe(true);
    expect(res.body.total).toBe(1);
  });

  it("returns 400 when limit exceeds 200", async () => {
    const res = await request(app).get("/api/payroll/esi-reg-docs?limit=999");
    expect(res.status).toBe(400);
  });
});
