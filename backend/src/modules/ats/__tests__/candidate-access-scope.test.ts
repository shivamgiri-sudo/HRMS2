/**
 * atsService.getCandidate(id) was `SELECT ... FROM ats_candidate WHERE id = ?` with no actor
 * predicate, and that SELECT returns mobile, email, date_of_birth and gender. The controller
 * passed only req.params.id.
 *
 * GET /api/ats/candidates HAS always scoped by branch/process. The by-id routes did not — and
 * recruiter and manager, the roles the list path exists to scope, are admitted to them. So a
 * recruiter assigned to Branch A could read a Branch B candidate's PII by id.
 *
 * The rule now lives once in candidate-access.ts. This pins the security property (an
 * out-of-scope candidate is refused, and refused as 404 so its existence is not disclosed)
 * and that the list path's behaviour is unchanged by the extraction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTROLLER = readFileSync(
  resolve(process.cwd(), "src/modules/ats/ats.controller.ts"),
  "utf8",
);
const ROUTES = readFileSync(
  resolve(process.cwd(), "src/modules/ats/ats.routes.ts"),
  "utf8",
);

const mockDb = { execute: vi.fn() };
vi.mock("../../../db/mysql.js", () => ({ db: mockDb }));

const mockRoleKeys = vi.fn();
const mockScopes = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({
  getUserRoleKeys: (...a: unknown[]) => mockRoleKeys(...a),
  getUserAssignmentScopes: (...a: unknown[]) => mockScopes(...a),
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
}));

const { resolveCandidateScope, canAccessCandidate, assertCandidateInScope } =
  await import("../candidate-access.js");

/** db fake: the caller's own employee branch, branch_master rows, and whether the probe finds the candidate. */
function fakeDb(opts: { ownBranch?: string | null; branches?: Record<string, { name: string; code?: string }>; probeHit?: boolean } = {}) {
  mockDb.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM employees/.test(sql)) return [opts.ownBranch ? [{ branch_id: opts.ownBranch }] : [], []];
    if (/FROM branch_master/.test(sql)) {
      return [(params as string[]).filter((id) => opts.branches?.[id]).map((id) => ({ branch_name: opts.branches![id].name, branch_code: opts.branches![id].code ?? null })), []];
    }
    if (/FROM ats_candidate/.test(sql)) return [opts.probeHit ? [{ 1: 1 }] : [], []];
    return [[], []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockScopes.mockResolvedValue([]);
  fakeDb();
});

describe("owner ruling 2026-10-01: only org-wide roles see every candidate", () => {
  it.each(["super_admin", "admin", "ceo", "payroll_head", "finance"])("%s gets unrestricted access", async (role) => {
    mockRoleKeys.mockResolvedValue([role]);
    expect(await resolveCandidateScope("u1")).toEqual({ sql: "1=1", params: [] });
  });

  it("hr is no longer wide: limited to its own employee branch (names, codes, ids and aliases)", async () => {
    mockRoleKeys.mockResolvedValue(["hr"]);
    fakeDb({ ownBranch: "b-1", branches: { "b-1": { name: "NOIDA-2", code: "N2" } } });
    const scope = await resolveCandidateScope("u1");
    expect(scope.sql).toMatch(/^\(applied_for_branch IN \(/);
    expect(scope.params).toEqual(expect.arrayContaining(["b-1", "NOIDA-2", "N2"]));
  });

  it("manager is no longer wide either", async () => {
    mockRoleKeys.mockResolvedValue(["manager"]);
    fakeDb({ ownBranch: "b-1", branches: { "b-1": { name: "Noida" } } });
    expect((await resolveCandidateScope("u1")).sql).not.toBe("1=1");
  });

  it("hr with NO resolvable branch sees nothing (fail closed)", async () => {
    mockRoleKeys.mockResolvedValue(["hr"]);
    fakeDb({ ownBranch: null });
    expect(await resolveCandidateScope("u1")).toEqual({ sql: "1=0", params: [] });
  });

  it("a recruiter with no assignment and no employee branch sees nothing", async () => {
    mockRoleKeys.mockResolvedValue(["recruiter"]);
    expect(await resolveCandidateScope("u1")).toEqual({ sql: "1=0", params: [] });
  });

  it("scope_type 'all' does NOT widen a non-org-wide role: it is downgraded to the own branch", async () => {
    mockRoleKeys.mockResolvedValue(["recruiter"]);
    mockScopes.mockResolvedValue([{ scope_type: "all", branch_id: null, process_id: null }]);
    fakeDb({ ownBranch: "b-9", branches: { "b-9": { name: "Pune" } } });
    const scope = await resolveCandidateScope("u1");
    expect(scope.sql).not.toBe("1=1");
    expect(scope.params).toContain("Pune");
  });

  it("restricts a branch-scoped recruiter to the assigned branch and aliases the column on request", async () => {
    mockRoleKeys.mockResolvedValue(["recruiter"]);
    mockScopes.mockResolvedValue([{ scope_type: "branch", branch_id: "b-1" }]);
    fakeDb({ branches: { "b-1": { name: "Noida" } } });
    const scope = await resolveCandidateScope("u1", "c");
    expect(scope.sql).toContain("c.applied_for_branch IN");
    expect(scope.params).toContain("Noida");
  });

  it("process-only assignment scopes by applied_for_process", async () => {
    mockRoleKeys.mockResolvedValue(["recruiter"]);
    mockScopes.mockResolvedValue([{ scope_type: "process", process_id: "p-1" }]);
    const scope = await resolveCandidateScope("u1");
    expect(scope.sql).toContain("applied_for_process IN");
    expect(scope.params).toEqual(["p-1"]);
  });
});

describe("an out-of-scope candidate is refused on the by-id path", () => {
  it("denies when the actor has no scope, without querying the candidate", async () => {
    mockRoleKeys.mockResolvedValue(["recruiter"]);
    expect(await canAccessCandidate("u1", "cand-1")).toBe(false);
    const probes = mockDb.execute.mock.calls.filter((c: any[]) =>
      /FROM ats_candidate/.test(String(c[0])),
    );
    expect(probes).toHaveLength(0);
  });

  it("applies the scope predicate to the existence probe, not just the id", async () => {
    mockRoleKeys.mockResolvedValue(["recruiter"]);
    mockScopes.mockResolvedValue([{ scope_type: "branch", branch_id: "b-1" }]);
    fakeDb({ branches: { "b-1": { name: "Noida" } }, probeHit: false });

    expect(await canAccessCandidate("u1", "cand-b")).toBe(false);

    const probe = mockDb.execute.mock.calls.find((c: any[]) =>
      /FROM ats_candidate/.test(String(c[0])),
    );
    expect(String(probe![0])).toMatch(/applied_for_branch IN/);
    expect((probe![1] as unknown[])[0]).toBe("cand-b");
    expect(probe![1]).toContain("Noida");
  });

  it("an hr user outside the candidate's branch is refused", async () => {
    mockRoleKeys.mockResolvedValue(["hr"]);
    fakeDb({ ownBranch: "b-1", branches: { "b-1": { name: "Noida" } }, probeHit: false });
    expect(await canAccessCandidate("u-hr", "cand-in-pune")).toBe(false);
  });

  it("allows an in-scope candidate", async () => {
    mockRoleKeys.mockResolvedValue(["hr"]);
    fakeDb({ ownBranch: "b-1", branches: { "b-1": { name: "Noida" } }, probeHit: true });
    expect(await canAccessCandidate("u1", "cand-a")).toBe(true);
  });

  it("an org-wide role still reaches any candidate", async () => {
    mockRoleKeys.mockResolvedValue(["admin"]);
    fakeDb({ probeHit: true });
    expect(await canAccessCandidate("u1", "cand-x")).toBe(true);
  });
});

describe("every by-id candidate surface carries the guard", () => {
  // Source-level, because these are route/controller wiring rather than pure functions.
  // Pins that the guard was actually applied, and that the mutating paths check BEFORE
  // they parse or write.
  it.each([
    ["getCandidate", "async getCandidate"],
    ["updateCandidate", "async updateCandidate"],
    ["moveStage", "async moveStage"],
    ["listStageLogs", "async listStageLogs"],
  ])("%s asserts scope", (_label, marker) => {
    const body = CONTROLLER.slice(
      CONTROLLER.indexOf(marker),
      CONTROLLER.indexOf(marker) + 1200,
    );
    expect(body).toMatch(/assertCandidateInScope/);
  });

  it("updateCandidate and moveStage guard BEFORE parsing the body", () => {
    for (const marker of ["async updateCandidate", "async moveStage"]) {
      const body = CONTROLLER.slice(
        CONTROLLER.indexOf(marker),
        CONTROLLER.indexOf(marker) + 1200,
      );
      expect(body.indexOf("assertCandidateInScope")).toBeLessThan(
        body.indexOf(".parse(req.body)"),
      );
    }
  });

  it.each([
    "/queue-tokens/candidate/:candidateId",
    "/convert/:candidateId",
    "/candidates/:id/reassign",
  ])("route %s asserts scope", (route) => {
    const at = ROUTES.indexOf(route);
    expect(at).toBeGreaterThan(-1);
    expect(ROUTES.slice(at, at + 1400)).toMatch(/assertCandidateInScope/);
  });

  it("the PUBLIC candidate upload is deliberately NOT staff-scoped", () => {
    // atsPublicRouter — the candidate uploading their own resume/selfie, proven by mobile,
    // not a recruiter acting on someone. Applying staff scope here would break self-upload.
    const at = ROUTES.indexOf('"/candidates/:id/upload"');
    expect(ROUTES.slice(at - 200, at)).toMatch(/atsPublicRouter/);
  });
});

describe("refusal does not disclose that the candidate exists", () => {
  it("answers 404, not 403", async () => {
    mockRoleKeys.mockResolvedValue(["recruiter"]);
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };

    const ok = await assertCandidateInScope("u1", "cand-1", res as any);

    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: "Candidate not found",
    });
  });

  it("returns true and writes no response when access is allowed", async () => {
    mockRoleKeys.mockResolvedValue(["admin"]);
    fakeDb({ probeHit: true });
    const res = { status: vi.fn() };

    expect(await assertCandidateInScope("u1", "cand-1", res as any)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });
});
