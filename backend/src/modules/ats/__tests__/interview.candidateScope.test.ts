import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recording an interview outcome: HR / admin may act on a candidate they were never assigned, but admin is branch-scoped like
 * hr (owner ruling 2026-10-01) - only candidates of their own branch. Org-wide roles act on any candidate.
 */
const h = vi.hoisted(() => ({
  execute: vi.fn(), roleKeys: { value: ["admin"] as string[] }, scope: { value: null as any },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: h.execute, getConnection: vi.fn() } }));
vi.mock("../../../shared/roleResolver.js", () => ({ getUserRoleKeys: vi.fn(async () => h.roleKeys.value) }));
vi.mock("../ats-branch-scope.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveAtsBranchScope: vi.fn(async () => h.scope.value),
}));
vi.mock("../ats.email.service.js", () => ({ sendSelectionCongratulationsEmail: vi.fn() }));
vi.mock("../ats.onboarding.service.js", () => ({ sendOnboardingToken: vi.fn() }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: {} }));
vi.mock("../candidate-portal.service.js", () => ({ createPortalAccess: vi.fn() }));

import { assertCandidateAssignedToCaller } from "../interview.service.js";

const scoped = { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA", "b-noida"], branchNames: ["NOIDA"], processNames: ["Sales"] };
const candidate = (over: Record<string, unknown> = {}) => h.execute.mockImplementation(async (sql: string) => {
  if (/FROM ats_candidate WHERE id/.test(sql)) return [[{ recruiter_id: "r-other", applied_for_branch: "NOIDA", applied_for_process: null, ...over }], []];
  return [[], []]; // caller has no recruiter roster row
});

beforeEach(() => { h.execute.mockReset(); h.roleKeys.value = ["admin"]; h.scope.value = scoped; });

describe("assertCandidateAssignedToCaller", () => {
  it("admin may act on an unassigned candidate of its own branch", async () => {
    candidate();
    await expect(assertCandidateAssignedToCaller("c1", "u1")).resolves.toBeUndefined();
  });
  it("admin is refused for a candidate of another branch (403)", async () => {
    candidate({ applied_for_branch: "DELHI" });
    await expect(assertCandidateAssignedToCaller("c1", "u1")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("admin with no branch scope is refused (fail closed)", async () => {
    h.scope.value = { orgWide: false, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
    candidate();
    await expect(assertCandidateAssignedToCaller("c1", "u1")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("hr is held to the same rule", async () => {
    h.roleKeys.value = ["hr"]; candidate({ applied_for_branch: "DELHI" });
    await expect(assertCandidateAssignedToCaller("c1", "u1")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("an org-wide role acts on any candidate", async () => {
    h.roleKeys.value = ["super_admin"]; h.scope.value = { ...scoped, orgWide: true }; candidate({ applied_for_branch: "DELHI" });
    await expect(assertCandidateAssignedToCaller("c1", "u1")).resolves.toBeUndefined();
  });
  it("a process-only scope covers candidates of that process", async () => {
    candidate({ applied_for_branch: "DELHI", applied_for_process: "Sales" });
    await expect(assertCandidateAssignedToCaller("c1", "u1")).resolves.toBeUndefined();
  });
  it("someone with no admin / hr role and no assignment is still refused", async () => {
    h.roleKeys.value = ["employee"]; candidate();
    await expect(assertCandidateAssignedToCaller("c1", "u1")).rejects.toMatchObject({ statusCode: 403 });
  });
});
