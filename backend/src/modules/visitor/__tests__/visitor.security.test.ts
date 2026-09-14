import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../visitor.service.js", () => ({
  visitorService: {
    checkEvent: vi.fn(),
    createDeskVisit: vi.fn(),
    emergencyRegister: vi.fn(),
    liveOccupancy: vi.fn(),
  },
}));

import { visitorSecurityRouter } from "../visitor-security.routes.js";
import { visitorService } from "../visitor.service.js";

const visitId = "9c5f8669-6901-4c92-8f1e-4f18ffae6101";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/visitor", visitorSecurityRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    return res.status(error?.issues ? 400 : error?.statusCode ?? 500).json({ success: false });
  });
  return app;
}

describe("visitor security routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication for gate operations", async () => {
    const response = await request(createApp())
      .post(`/api/visitor/visits/${visitId}/check-in`)
      .send({ gate_code: "MAIN" });

    expect(response.status).toBe(401);
    expect(visitorService.checkEvent).not.toHaveBeenCalled();
  });

  it("rejects an employee without a security role", async () => {
    const response = await request(createApp())
      .post(`/api/visitor/visits/${visitId}/check-in`)
      .set("Authorization", "Bearer mock-token-employee")
      .send({ gate_code: "MAIN" });

    expect(response.status).toBe(403);
    expect(visitorService.checkEvent).not.toHaveBeenCalled();
  });

  it("allows an authorized administrator to process check-in", async () => {
    vi.mocked(visitorService.checkEvent).mockResolvedValueOnce({ id: visitId, status: "checked_in" });

    const response = await request(createApp())
      .post(`/api/visitor/visits/${visitId}/check-in`)
      .set("Authorization", "Bearer mock-token-admin")
      .send({ gate_code: "MAIN", badge_number: "MAS-101" });

    expect(response.status).toBe(200);
    expect(visitorService.checkEvent).toHaveBeenCalledWith(
      "demo-admin-id",
      visitId,
      "checked_in",
      expect.objectContaining({ gate_code: "MAIN", badge_number: "MAS-101" }),
      expect.anything(),
    );
  });

  it("allows an authorized desk user to capture a complete visitor entry", async () => {
    vi.mocked(visitorService.createDeskVisit).mockResolvedValueOnce({
      id: visitId,
      visit_number: "VIS-20260716-ABC12345",
      tracking_token: "a".repeat(64),
      status: "pending_approval",
    });

    const response = await request(createApp())
      .post("/api/visitor/desk/visits")
      .set("Authorization", "Bearer mock-token-admin")
      .send({
        visitor: { full_name: "Ananya Sharma", mobile: "9876543210" },
        branch_id: "3f7a3a66-413a-4c6c-a54e-7fda57fc8c1e",
        host_employee_id: "06c012c0-a297-485d-9868-88d78ce14de2",
        visit_type: "business",
        purpose: "Quarterly service review",
        scheduled_start: "2026-07-20T10:00:00+05:30",
        scheduled_end: "2026-07-20T11:00:00+05:30",
      });

    expect(response.status).toBe(201);
    expect(visitorService.createDeskVisit).toHaveBeenCalledWith(
      "demo-admin-id",
      expect.objectContaining({ host_employee_id: "06c012c0-a297-485d-9868-88d78ce14de2" }),
      expect.anything(),
    );
  });

  it("prevents ordinary employees from reading the emergency register", async () => {
    const response = await request(createApp())
      .get("/api/visitor/emergency-register")
      .set("Authorization", "Bearer mock-token-employee");

    expect(response.status).toBe(403);
    expect(visitorService.emergencyRegister).not.toHaveBeenCalled();
  });
});

describe("visitor persistence security", () => {
  it("stores only a tracking-token hash and contains no Aadhaar field", () => {
    const migration = readFileSync(new URL("../../../../sql/409_visitor_management_foundation.sql", import.meta.url), "utf8");
    expect(migration).toContain("tracking_token_hash");
    expect(migration).not.toMatch(/tracking_token\s+(?:CHAR|VARCHAR|TEXT)/i);
    expect(migration).not.toMatch(/aadhaar|aadhar/i);
  });

  it("scopes badge identity and configuration uniqueness by branch", () => {
    const migration = readFileSync(new URL("../../../../sql/409_visitor_management_foundation.sql", import.meta.url), "utf8");
    expect(migration).toContain("uq_visitor_badge_branch_number (branch_id, badge_number)");
    expect(migration).toContain("uq_visitor_config_scope (scope_key, config_key)");
  });
});
