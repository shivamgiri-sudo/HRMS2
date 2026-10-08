import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Owner policy 2026-10-01: access-request approve / deny / list are limited to requesters of the admin's OWN branch; org-wide (super_admin ...) decide any; nobody decides their own request. */
const { execute, approve, deny, list, policy, userBranch, userBranches } = vi.hoisted(() => ({
  execute: vi.fn(), approve: vi.fn(), deny: vi.fn(), list: vi.fn(),
  policy: { orgWide: false, ownBranchId: "br-A" as string | null },
  userBranch: vi.fn(), userBranches: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../role-page-access.service.js", () => ({ approveAccessRequest: approve, denyAccessRequest: deny, listAccessRequests: list }));
vi.mock("../access.service.js", () => ({}));
vi.mock("../user-page-access.service.js", () => ({}));
vi.mock("../../../shared/enterpriseScope.js", () => ({}));
vi.mock("../../../shared/branchDecisionScope.js", () => ({
  userBranchId: userBranch, userBranchIds: userBranches,
  loadBranchPolicy: async () => ({
    ...policy,
    allows: (b: unknown) => policy.orgWide || (!!policy.ownBranchId && !!b && String(b) === policy.ownBranchId),
  }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-me" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

const { accessRouter } = await import("../access.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/access", accessRouter); return a; };

const requester = (id: string | null) => execute.mockResolvedValue([id ? [{ user_id: id }] : [], []]);
beforeEach(() => {
  [execute, approve, deny, list, userBranch, userBranches].forEach((f) => f.mockReset());
  policy.orgWide = false; policy.ownBranchId = "br-A";
});

const cases: Array<[string, string, Record<string, unknown>, () => ReturnType<typeof vi.fn>]> = [
  ["requests/approve", "/api/access/requests/r1/approve", {}, () => approve],
  ["requests/deny", "/api/access/requests/r1/deny", { reason: "x" }, () => deny],
  ["access-requests/approve", "/api/access/access-requests/r1/approve", {}, () => approve],
  ["access-requests/deny", "/api/access/access-requests/r1/deny", { reason: "x" }, () => deny],
];

describe.each(cases)("POST %s", (_n, url, body, svc) => {
  it("admin of another branch gets 403", async () => {
    requester("u-req"); userBranch.mockResolvedValue("br-B");
    expect((await request(app()).post(url).send(body)).status).toBe(403);
    expect(svc()).not.toHaveBeenCalled();
  });
  it("admin of the same branch is allowed", async () => {
    requester("u-req"); userBranch.mockResolvedValue("br-A");
    expect((await request(app()).post(url).send(body)).status).toBe(200);
    expect(svc()).toHaveBeenCalledTimes(1);
  });
  it("requester with unknown branch fails closed", async () => {
    requester("u-req"); userBranch.mockResolvedValue(null);
    expect((await request(app()).post(url).send(body)).status).toBe(403);
  });
  it("org-wide (super_admin) is allowed whatever the branch", async () => {
    policy.orgWide = true; requester("u-req"); userBranch.mockResolvedValue("br-B");
    expect((await request(app()).post(url).send(body)).status).toBe(200);
  });
  it("nobody decides their own request, org-wide included", async () => {
    policy.orgWide = true; requester("u-me");
    expect((await request(app()).post(url).send(body)).status).toBe(403);
    expect(svc()).not.toHaveBeenCalled();
  });
});

describe.each(["/api/access/requests", "/api/access/access-requests"])("GET %s", (url) => {
  const rows = [{ id: "1", user_id: "u1" }, { id: "2", user_id: "u2" }, { id: "3", user_id: "u3" }];
  it("admin sees only requests of own-branch requesters", async () => {
    list.mockResolvedValue(rows);
    userBranches.mockResolvedValue(new Map([["u1", "br-A"], ["u2", "br-B"]]));
    const res = await request(app()).get(url);
    expect(res.body.data.map((r: any) => r.id)).toEqual(["1"]);
  });
  it("org-wide sees all", async () => {
    policy.orgWide = true; list.mockResolvedValue(rows);
    expect((await request(app()).get(url)).body.data).toHaveLength(3);
  });
});
