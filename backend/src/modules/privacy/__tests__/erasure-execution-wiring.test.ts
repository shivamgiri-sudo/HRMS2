import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HRMS2 delta-audit, 2026-08-14 (P0, directory_profile_pii cluster):
 * PATCH /rights/requests/:id marking an erasure request "resolved" performed
 * zero actual data operation — it only ever called the generic
 * resolveRightsRequest status-updater, identical to what an access/
 * correction/nomination/grievance resolution does. dpdpErasure.service.ts's
 * executeErasure() already existed, correct, but was never imported by any
 * route (orphaned dead code from an earlier merge that dropped its wiring).
 *
 * Fix: when a caller resolves an erasure request specifically, the route now
 * calls executeErasure() instead of the generic updater, gated on the `dpo`
 * role (irreversible PII anonymization needs a stricter gate than the
 * admin/hr/dpo the route otherwise allows for ordinary status changes).
 * Every other request_type / status combination is unchanged.
 *
 * User-approved fix, this session (Section K item 4, Option A).
 */

const { hasRole } = vi.hoisted(() => ({
  hasRole: vi.fn(async () => false),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole }));

const { executeErasure } = vi.hoisted(() => ({
  executeErasure: vi.fn(async () => undefined),
}));
vi.mock("../dpdpErasure.service.js", () => ({ executeErasure }));

const { resolveRightsRequest } = vi.hoisted(() => ({
  resolveRightsRequest: vi.fn(async (id: string, update: any) => ({
    id,
    request_type: "access",
    ...update,
  })),
}));
vi.mock("../privacy.service.js", () => ({
  privacyService: {
    resolveRightsRequest,
    getMyConsents: vi.fn(), getAllConsents: vi.fn(), getConsentCoverageStats: vi.fn(),
    getMyRightsRequests: vi.fn(), getAllRightsRequests: vi.fn(),
    listRetentionPolicies: vi.fn(),
  },
}));

const { dbExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(async (sql: string, params: unknown[]) => {
    if (/SELECT\s+request_type,\s*status/i.test(sql)) {
      const id = params[0];
      if (id === "req-erasure-pending") {
        return [[{ request_type: "erasure", status: "pending" }], []];
      }
      if (id === "req-erasure-already-resolved") {
        return [[{ request_type: "erasure", status: "resolved" }], []];
      }
      if (id === "req-access-pending") {
        return [[{ request_type: "access", status: "pending" }], []];
      }
      return [[], []];
    }
    if (/SELECT \* FROM data_rights_request WHERE id = \?/i.test(sql)) {
      return [[{ id: params[0], request_type: "erasure", status: "resolved" }], []];
    }
    return [[], []];
  }),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute, getConnection: vi.fn() },
}));

vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => undefined) }));

const actor = { id: "u-caller-1", role: "hr" };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { privacyRouter } from "../privacy.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/privacy", privacyRouter);
  return a;
}

beforeEach(() => {
  hasRole.mockClear().mockResolvedValue(false);
  executeErasure.mockClear().mockResolvedValue(undefined);
  resolveRightsRequest.mockClear();
  dbExecute.mockClear();
});

describe("PATCH /rights/requests/:id — erasure execution wiring", () => {
  it("refuses to resolve an erasure request for a caller who is not DPO", async () => {
    hasRole.mockResolvedValueOnce(false);
    const res = await request(app())
      .patch("/api/privacy/rights/requests/req-erasure-pending")
      .send({ status: "resolved" });
    expect(res.status).toBe(403);
    expect(executeErasure).not.toHaveBeenCalled();
    expect(resolveRightsRequest).not.toHaveBeenCalled();
  });

  it("calls executeErasure (not the generic updater) when a DPO resolves an erasure request", async () => {
    hasRole.mockResolvedValueOnce(true);
    const res = await request(app())
      .patch("/api/privacy/rights/requests/req-erasure-pending")
      .send({ status: "resolved" });
    expect(res.status).toBe(200);
    expect(executeErasure).toHaveBeenCalledWith("req-erasure-pending", "u-caller-1");
    expect(resolveRightsRequest).not.toHaveBeenCalled();
  });

  it("refuses to re-execute an already-resolved erasure request, even as DPO", async () => {
    hasRole.mockResolvedValueOnce(true);
    const res = await request(app())
      .patch("/api/privacy/rights/requests/req-erasure-already-resolved")
      .send({ status: "resolved" });
    expect(res.status).toBe(409);
    expect(executeErasure).not.toHaveBeenCalled();
  });

  it("leaves non-erasure request types on the unchanged generic path, no DPO check", async () => {
    const res = await request(app())
      .patch("/api/privacy/rights/requests/req-access-pending")
      .send({ status: "resolved" });
    expect(res.status).toBe(200);
    expect(executeErasure).not.toHaveBeenCalled();
    expect(resolveRightsRequest).toHaveBeenCalledWith(
      "req-access-pending",
      expect.objectContaining({ status: "resolved" })
    );
    expect(hasRole).not.toHaveBeenCalled();
  });

  it("leaves non-'resolved' status changes on an erasure request on the generic path (e.g. moving to in_review)", async () => {
    const res = await request(app())
      .patch("/api/privacy/rights/requests/req-erasure-pending")
      .send({ status: "in_review" });
    expect(res.status).toBe(200);
    expect(executeErasure).not.toHaveBeenCalled();
    expect(resolveRightsRequest).toHaveBeenCalled();
  });
});
