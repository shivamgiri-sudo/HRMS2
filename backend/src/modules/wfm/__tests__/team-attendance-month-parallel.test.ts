import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u1" };
    next();
  },
  requireWriteAccess: (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  hasRole: vi.fn(async () => true),
  getEmployeeForUser: vi.fn(async () => ({ id: "me" })),
}));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: {} }));
vi.mock("../../leave/leave.service.js", () => ({ leaveService: {} }));

const m = vi.hoisted(() => ({ query: vi.fn(), started: [] as string[] }));
vi.mock("../../../db/mysql.js", () => ({
  db: { query: m.query, execute: m.query },
}));

import { teamAttendanceMonthRouter } from "../team-attendance-month.routes.js";

describe("GET /team-month", () => {
  it("starts attendance and regularization queries concurrently and merges results", async () => {
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attendance_daily_record")) {
        m.started.push("adr");
        await new Promise((r) => setTimeout(r, 15));
        return [
          [
            {
              employee_id: "e1",
              d: "2026-09-01",
              attendance_status: "present",
            },
          ],
        ];
      }
      if (sql.includes("FROM attendance_regularization")) {
        m.started.push("reg");
        return [
          [{ id: "r1", employee_id: "e1", d: "2026-09-02", status: "pending" }],
        ];
      }
      return [
        [{ id: "e1", employee_name: "A", date_of_joining: "2020-01-01" }],
      ];
    });
    const app = express();
    app.use("/x", teamAttendanceMonthRouter);
    const res = await request(app).get("/x/team-month?month=2026-09");
    expect(res.status).toBe(200);
    expect(m.started).toEqual(["adr", "reg"]);
    const days = res.body.employees[0].days;
    expect(days[0].hasRecord).toBe(true);
    expect(days[1].pendingRegularizationId).toBe("r1");
  });
});
