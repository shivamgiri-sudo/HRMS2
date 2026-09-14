import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const policyServiceMocks = vi.hoisted(() => ({
  getDomains: vi.fn(),
  getDomainDetail: vi.fn(),
  updateDomain: vi.fn(),
  getDomainHistory: vi.fn(),
}));

vi.mock("../src/modules/policy-engine/policy-engine.service.js", () => policyServiceMocks);

import { policyEngineRouter } from "../src/modules/policy-engine/policy-engine.routes.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/policy-engine", policyEngineRouter);
  return app;
}

describe("policy engine routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when authorization header is missing", async () => {
    const res = await request(buildApp()).get("/api/policy-engine/domains");

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/missing authorization token/i);
    expect(policyServiceMocks.getDomains).not.toHaveBeenCalled();
  });

  it("returns 403 for authenticated non-super-admin users", async () => {
    const res = await request(buildApp())
      .get("/api/policy-engine/domains")
      .set("Authorization", "Bearer mock-token-admin");

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/access denied/i);
    expect(policyServiceMocks.getDomains).not.toHaveBeenCalled();
  });

  it("returns policy domains for super admins", async () => {
    policyServiceMocks.getDomains.mockResolvedValueOnce([
      {
        domain_key: "payroll",
        label: "Payroll",
        description: "Working days",
        icon: "Banknote",
        is_editable: true,
        section_count: 3,
        config_count: 3,
      },
    ]);

    const res = await request(buildApp())
      .get("/api/policy-engine/domains")
      .set("Authorization", "Bearer mock-token-super-admin-role");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].domain_key).toBe("payroll");
    expect(policyServiceMocks.getDomains).toHaveBeenCalledOnce();
  });

  it("validates domain keys before loading domain detail", async () => {
    const res = await request(buildApp())
      .get("/api/policy-engine/domains/INVALID!")
      .set("Authorization", "Bearer mock-token-super-admin-role");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid domain key");
    expect(policyServiceMocks.getDomainDetail).not.toHaveBeenCalled();
  });

  it("passes the authenticated actor to updateDomain", async () => {
    policyServiceMocks.updateDomain.mockResolvedValueOnce(undefined);

    const payload = {
      reason: "Adjust payroll defaults",
      updates: [
        {
          section_key: "calculation",
          config_key: "default_working_days",
          new_value: "26",
        },
      ],
    };

    const res = await request(buildApp())
      .put("/api/policy-engine/domains/payroll")
      .set("Authorization", "Bearer mock-token-super-admin-role")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(policyServiceMocks.updateDomain).toHaveBeenCalledOnce();
    expect(policyServiceMocks.updateDomain).toHaveBeenCalledWith(
      "payroll",
      payload.updates,
      payload.reason,
      "demo-super-admin-id",
      expect.objectContaining({
        authUser: expect.objectContaining({
          id: "demo-super-admin-id",
          role: "super_admin",
        }),
      }),
    );
  });

  it("rejects invalid update payloads before calling updateDomain", async () => {
    const res = await request(buildApp())
      .put("/api/policy-engine/domains/payroll")
      .set("Authorization", "Bearer mock-token-super-admin-role")
      .send({ reason: "x", updates: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toBeTruthy();
    expect(policyServiceMocks.updateDomain).not.toHaveBeenCalled();
  });

  it("returns history for a valid domain", async () => {
    policyServiceMocks.getDomainHistory.mockResolvedValueOnce([
      {
        id: "hist-1",
        domain_key: "payroll",
        section_key: "calculation",
        config_key: "default_working_days",
        old_value: "24",
        new_value: "26",
        reason: "Adjusted default",
        changed_by: "demo-super-admin-id",
        actor_name: "Demo Super Admin",
        changed_at: "2026-07-18T00:00:00Z",
      },
    ]);

    const res = await request(buildApp())
      .get("/api/policy-engine/domains/payroll/history")
      .set("Authorization", "Bearer mock-token-super-admin-role");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(policyServiceMocks.getDomainHistory).toHaveBeenCalledWith("payroll");
  });
});
