import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn(), getConnection: vi.fn() } }));

const { getPipelineHealth } = vi.hoisted(() => ({ getPipelineHealth: vi.fn() }));
vi.mock("../he-pipeline-health.service.js", () => ({ getPipelineHealth }));

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});

import { heRouter } from "../he.routes.js";
import { runHealthAlertOnce, shouldAlert, startPipelineHealthAlerts, stopPipelineHealthAlerts } from "../pipeline-health.cron.js";
import type { HealthCheck } from "../he-pipeline-health.js";

const crit = (key: string): HealthCheck => ({ key, label: `L-${key}`, level: "critical", detail: `D-${key}` });
const warn: HealthCheck = { key: "w", label: "W", level: "warn", detail: "w" };
const H = 60 * 60 * 1000;

describe("shouldAlert", () => {
  it("alerts once, suppresses within 6h, alerts again after 6h", () => {
    const prev = new Map<string, number>();
    expect(shouldAlert(prev, [crit("a")], 0).map((c) => c.key)).toEqual(["a"]);
    expect(shouldAlert(prev, [crit("a")], 5 * H)).toEqual([]);
    expect(shouldAlert(prev, [crit("a")], 6 * H).map((c) => c.key)).toEqual(["a"]);
  });
  it("never alerts non-critical checks", () => {
    expect(shouldAlert(new Map(), [warn, { ...warn, level: "ok" }], 0)).toEqual([]);
  });
});

describe("alert scheduler", () => {
  beforeEach(() => { send.mockReset(); getPipelineHealth.mockReset(); });
  afterEach(() => { stopPipelineHealthAlerts(); delete process.env.PIPELINE_HEALTH_ALERTS; vi.restoreAllMocks(); });

  it("schedules nothing when PIPELINE_HEALTH_ALERTS is unset", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startPipelineHealthAlerts();
    expect(spy).not.toHaveBeenCalled();
  });
  it("is idempotent when enabled", () => {
    process.env.PIPELINE_HEALTH_ALERTS = "true";
    const spy = vi.spyOn(globalThis, "setInterval");
    startPipelineHealthAlerts();
    startPipelineHealthAlerts();
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("emails only label and detail of critical checks; send failure is swallowed", async () => {
    getPipelineHealth.mockResolvedValue({ generatedAt: "x", level: "critical", checks: [crit("a"), warn] });
    send.mockRejectedValue(new Error("smtp down"));
    await expect(runHealthAlertOnce(new Map(), 0)).resolves.toBeUndefined();
    const arg = send.mock.calls[0][0];
    expect(arg.subject).toBe("[HRMS] Pipeline health: 1 critical");
    expect(arg.text).toContain("L-a");
    expect(arg.text).toContain("D-a");
  });
});

describe("GET /api/he/pipeline-health", () => {
  function appFor(role: string) {
    actor = { id: `u-${role}`, role, roles: [role] };
    const app = express();
    app.use("/api/he", heRouter);
    return app;
  }
  it("returns 200 with checks", async () => {
    getPipelineHealth.mockResolvedValue({ generatedAt: "x", level: "ok", checks: [] });
    const res = await request(appFor("hr")).get("/api/he/pipeline-health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { generatedAt: "x", level: "ok", checks: [] } });
  });
  it("403 for non-view role", async () => {
    const res = await request(appFor("employee")).get("/api/he/pipeline-health");
    expect(res.status).toBe(403);
  });
  it("500 generic on failure", async () => {
    getPipelineHealth.mockRejectedValue(new Error("secret"));
    const res = await request(appFor("hr")).get("/api/he/pipeline-health");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});
