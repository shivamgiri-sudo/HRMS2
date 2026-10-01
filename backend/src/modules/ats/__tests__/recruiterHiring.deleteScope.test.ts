import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DELETE /recruiter/hiring-activity/:id: admin is branch-scoped like hr (owner ruling 2026-10-01) - it may delete a row
 * of its OWN branch (not only its own entries) but never another branch's. Org-wide roles may delete any row.
 */
const { dbExecute, actor, authBox } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  actor: { branch: "NOIDA" as string | null },
  authBox: { value: { id: "u-admin", role: "admin" } as { id: string; role: string } },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, getConnection: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = authBox.value; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../recruiter-hiring.service.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getActorBranch: vi.fn(async () => actor.branch),
}));

async function del() {
  const { recruiterHiringRouter } = await import("../recruiter-hiring.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/ats", recruiterHiringRouter);
  return request(a).delete("/api/ats/recruiter/hiring-activity/row-1");
}
const row = (branch: string) => dbExecute.mockImplementation(async (sql: string) => {
  if (/SELECT id, created_by/.test(sql)) return [[{ id: "row-1", created_by: "someone", recruiter_id: "other", branch_name: branch }], []];
  return [{ affectedRows: 1 }, []];
});
const deleted = () => dbExecute.mock.calls.some(([q]) => /DELETE FROM ats_recruiter_hiring_activity/.test(String(q)));

beforeEach(() => { dbExecute.mockReset(); actor.branch = "NOIDA"; authBox.value = { id: "u-admin", role: "admin" }; });

describe("DELETE recruiter hiring activity", () => {
  it("admin may delete a row of its own branch", async () => {
    row("NOIDA");
    expect((await del()).status).toBe(200);
    expect(deleted()).toBe(true);
  });
  it("admin may not delete a row of another branch", async () => {
    row("DELHI");
    expect((await del()).status).toBe(403);
    expect(deleted()).toBe(false);
  });
  it("an admin with no branch deletes nothing (fail closed)", async () => {
    actor.branch = null; row("NOIDA");
    expect((await del()).status).toBe(403);
    expect(deleted()).toBe(false);
  });
  it("an org-wide role may delete any branch's row", async () => {
    authBox.value = { id: "u-ceo", role: "ceo" }; row("DELHI");
    expect((await del()).status).toBe(200);
  });
});
