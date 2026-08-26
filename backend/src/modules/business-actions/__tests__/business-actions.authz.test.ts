import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Every route on this router stopped at requireAuth. Any authenticated employee could
 * read the org-wide action queue, create/assign/escalate/complete anyone's action, and
 * fire the org-wide signal syncs. The only thing keeping them out was the frontend
 * <Gate pageCode="BUSINESS_ACTION_QUEUE"> on the queue page.
 *
 * Roles mirror the live role_page_access grants: super_admin full, branch_head view-only.
 */

const { currentRoles } = vi.hoisted(() => ({ currentRoles: { value: ["employee"] } }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u-1", roles: currentRoles.value };
    next();
  },
}));

const svc = { summary: vi.fn(async () => ({})), list: vi.fn(async () => []), get: vi.fn(async () => ({ id: "a-1" })), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), assign: vi.fn(async () => ({})), escalate: vi.fn(async () => ({})), complete: vi.fn(async () => ({})), comment: vi.fn(async () => ({})) };
vi.mock("../business-actions.service.js", () => ({ businessActionsService: svc }));
vi.mock("../business-actions.signal-sync.js", () => ({
  businessActionSignalSync: { syncAll: vi.fn(async () => ({})), syncPeopleExperience: vi.fn(async () => ({})), syncSupportSla: vi.fn(async () => ({})), syncGrievances: vi.fn(async () => ({})), syncPayrollReadiness: vi.fn(async () => ({ created: 0 })), syncAttendanceGaps: vi.fn(async () => ({ created: 0 })), syncOnboardingStuck: vi.fn(async () => ({ created: 0 })), syncRosterShortages: vi.fn(async () => ({ created: 0 })) },
}));

const { businessActionsRouter } = await import("../business-actions.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/business-actions", businessActionsRouter);
  return a;
}

function as(roles: string[]) { currentRoles.value = roles; return app(); }

describe("business-actions authorization", () => {
  it("denies an ordinary employee the org-wide queue", async () => {
    const res = await request(as(["employee"])).get("/api/business-actions");
    expect(res.status).toBe(403);
  });

  it("denies an ordinary employee the signal sync", async () => {
    const res = await request(as(["employee"])).post("/api/business-actions/sync-signals/payroll");
    expect(res.status).toBe(403);
  });

  it("denies an ordinary employee completing someone else's action", async () => {
    const res = await request(as(["employee"])).post("/api/business-actions/a-1/complete").send({});
    expect(res.status).toBe(403);
  });

  it("allows admin to read", async () => {
    const res = await request(as(["admin"])).get("/api/business-actions");
    expect(res.status).toBe(200);
  });

  it("allows branch_head to read — it holds can_view=1", async () => {
    const res = await request(as(["branch_head"])).get("/api/business-actions/summary");
    expect(res.status).toBe(200);
  });

  it("denies branch_head writes — it holds can_create/can_edit/can_delete=0", async () => {
    const res = await request(as(["branch_head"])).post("/api/business-actions").send({});
    expect(res.status).toBe(403);
  });

  it("allows super_admin everything", async () => {
    const res = await request(as(["super_admin"])).post("/api/business-actions/a-1/escalate").send({});
    expect(res.status).toBe(200);
  });
});

describe("no route is left on requireAuth alone", () => {
  const SRC = readFileSync(
    resolve(process.cwd(), "src/modules/business-actions/business-actions.routes.ts"),
    "utf8",
  );

  it("every registered route carries requireRead or requireWrite", () => {
    const routes = SRC.match(/businessActionsRouter\.(get|post|patch|put|delete)\([^)]*/g) ?? [];
    expect(routes.length).toBeGreaterThan(0);
    const ungated = routes.filter((r) => !/require(Read|Write)/.test(r));
    expect(ungated).toEqual([]);
  });
});
