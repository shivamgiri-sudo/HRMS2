import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

// The global setup mocks db to return empty results, which is all these route checks need.
let actor: any = { id: "u1", role: "finance_head", roles: ["finance_head"] };
vi.mock("../../../middleware/authMiddleware.js", async (orig) => ({
  ...(await orig<any>()),
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = actor;
    next();
  },
}));

import { grnTallyRouter } from "../grn-tally-export.routes.js";

const app = express();
app.use("/api/finance/grn-tally", grnTallyRouter);

describe("GET /api/finance/grn-tally/download", () => {
  it.each([
    ["xml", "application/xml"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["csv", "text/csv"],
  ])("serves %s as an attachment", async (format, type) => {
    actor = { id: "u1", role: "finance_head", roles: ["finance_head"] };
    const res = await request(app).get(`/api/finance/grn-tally/download?format=${format}&month=2026-09`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(type);
    expect(res.headers["content-disposition"]).toMatch(new RegExp(`attachment; filename="GRN_Tally_2026-09_.*\\.${format}"`));
  });

  it("rejects an unknown format and a malformed month", async () => {
    actor = { id: "u1", role: "finance_head", roles: ["finance_head"] };
    expect((await request(app).get("/api/finance/grn-tally/download?format=pdf")).status).toBe(400);
    expect((await request(app).get("/api/finance/grn-tally/download?format=csv&month=2026-13")).status).toBe(400);
  });

  it("is closed to branch roles", async () => {
    actor = { id: "u2", role: "branch_head", roles: ["branch_head"] };
    expect((await request(app).get("/api/finance/grn-tally/download?format=csv")).status).toBe(403);
    expect((await request(app).get("/api/finance/grn-tally/download/summary")).status).toBe(403);
  });
});
