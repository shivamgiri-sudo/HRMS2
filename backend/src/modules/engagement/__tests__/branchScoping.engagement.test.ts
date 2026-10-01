import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Engagement badge award / point adjustment (owner ruling 2026-10-01): target must be inside the caller's scope. */
const { canViewEmployee, isInSpan, awardBadge, addPoints } = vi.hoisted(() => ({
  canViewEmployee: vi.fn(), isInSpan: vi.fn(), awardBadge: vi.fn(async () => ({ id: "ub1" })), addPoints: vi.fn(async () => ({})),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));
vi.mock("../../../shared/reportingSpan.js", () => ({ isInReportingSpan: isInSpan }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn(async () => ({ id: "e-self" })) }));
vi.mock("../badge.service.js", () => ({ awardBadge, getBadges: vi.fn(), getEmployeeBadges: vi.fn() }));
vi.mock("../gamification.service.js", () => ({ addPoints, getEmployeeTier: vi.fn(), getLeaderboard: vi.fn(), getPointsHistory: vi.fn(), getTiers: vi.fn() }));
vi.mock("../engagement.service.js", () => ({ getEmployeeEngagementSummary: vi.fn() }));
vi.mock("../kudos.service.js", () => ({ getMonthlyKudosLimit: vi.fn(), listKudos: vi.fn(), listKudosTemplates: vi.fn(), sendKudos: vi.fn() }));

const { engagementController: c } = await import("../engagement.controller.js");
const uuid = "11111111-1111-4111-8111-111111111111";
const app = () => {
  const a = express(); a.use(express.json());
  a.use((req: any, _res, next) => { req.authUser = { id: "22222222-2222-4222-8222-222222222222" }; next(); });
  a.post("/badges/award", (req: any, res, next) => c.awardBadge(req, res).catch(next));
  a.post("/points/adjust", (req: any, res, next) => c.adjustPoints(req, res).catch(next));
  return a;
};

beforeEach(() => { canViewEmployee.mockReset(); isInSpan.mockReset(); isInSpan.mockResolvedValue(false); awardBadge.mockClear(); addPoints.mockClear(); });

describe("engagement scoping", () => {
  it("awarding a badge to an employee outside the caller's scope is 403", async () => {
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).post("/badges/award").send({ employeeId: uuid, badgeId: uuid, reason: "great work" });
    expect(res.status).toBe(403);
    expect(awardBadge).not.toHaveBeenCalled();
  });
  it("in scope, or in the manager's reporting span, it works", async () => {
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).post("/badges/award").send({ employeeId: uuid, badgeId: uuid, reason: "great work" })).status).toBe(201);
    canViewEmployee.mockResolvedValue(false); isInSpan.mockResolvedValue(true);
    expect((await request(app()).post("/badges/award").send({ employeeId: uuid, badgeId: uuid, reason: "great work" })).status).toBe(201);
  });
  it("points adjustment is scoped the same way", async () => {
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).post("/points/adjust").send({ employeeId: uuid, points: 5, reason: "bonus for help" });
    expect(res.status).toBe(403);
    expect(addPoints).not.toHaveBeenCalled();
  });
});
