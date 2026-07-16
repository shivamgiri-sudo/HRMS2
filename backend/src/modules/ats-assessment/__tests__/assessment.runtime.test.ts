import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db/supabaseAdmin.js", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
  supabaseAuthClient: {
    auth: {
      getUser: vi.fn(),
    },
  },
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

vi.mock("../../../modules/process/process.repository.js", () => ({
  getProcessRepository: vi.fn(),
}));

import { app } from "../../../app.js";
import { db, pingDb } from "../../../db/mysql.js";
import { supabaseAuthClient } from "../../../db/supabaseAdmin.js";
import { getProcessRepository } from "../../../modules/process/process.repository.js";

const repositoryRoot = resolve(process.cwd(), "..");
const readRepositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

const mockDbExecute = db.execute as ReturnType<typeof vi.fn>;
const mockPingDb = pingDb as ReturnType<typeof vi.fn>;
const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const mockGetRepo = getProcessRepository as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockDbExecute.mockReset().mockResolvedValue([[{ role_key: "admin" }], []]);
  mockGetRepo.mockReturnValue({
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
  });
  mockPingDb.mockResolvedValue(undefined);
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("ATS assessment app routing", () => {
  it("mounts ats-ext before the generic /api client router", () => {
    const appSource = readRepositoryFile("backend/src/app.ts");
    const atsExtMount = appSource.indexOf('app.use("/api/ats-ext", atsExtRouter)');
    const genericApiMount = appSource.indexOf('app.use("/api", clientRouter)');

    expect(atsExtMount).toBeGreaterThan(-1);
    expect(genericApiMount).toBeGreaterThan(-1);
    expect(atsExtMount).toBeLessThan(genericApiMount);
    expect(appSource.match(/app\.use\(\"\/api\/ats-ext\", atsExtRouter\)/g)).toHaveLength(1);
  });

  it("serves the public assessment health endpoint without auth", async () => {
    const res = await request(app).get("/api/ats-ext/assessment/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.queueLifecycleIsolated).toBe(true);
    expect(res.body.data.oneAssessmentAttempt).toBe(true);
    expect(["enabled", "disabled"]).toContain(res.body.data.status);
  });

  it("keeps the assessment admin dashboard protected", async () => {
    const res = await request(app).get("/api/ats-ext/assessment-admin/dashboard");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("serves the candidate assessment page publicly", async () => {
    const res = await request(app).get("/api/ats-ext/assessment");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("<!doctype html>");
  });

  it("serves the canonical template-builder page publicly", async () => {
    const res = await request(app).get("/api/ats-ext/assessment-admin/template-builder");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Assessment Template Builder");
  });

  it("redirects the legacy template-builder URL to the canonical route", async () => {
    const res = await request(app).get("/api/ats-ext/assessment-template-builder");

    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("/api/ats-ext/assessment-admin/template-builder");
  });
});
