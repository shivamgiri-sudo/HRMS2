import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The access rules around a TDS certificate, exercised end to end through the
 * router.
 *
 * The document carries PAN, salary and tax deposited, so the two rules that
 * matter are: an employee reaches only their own, and an unverified certificate
 * reaches nobody. The second exists because a misfiled certificate is easy to
 * produce and impossible for an employee to detect — they would simply see
 * someone else's tax figures presented as their own.
 *
 * Mounts the router directly rather than importing app.ts, so it stays runnable
 * regardless of the wider application graph.
 */

const SELF = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";

const {
  hasAnyRole, getEmployeeForUser, registerUpload, issueDownloadToken,
  getPartAAvailability, recordPartA, verifyPartA, logSensitiveAction,
} = vi.hoisted(() => ({
  hasAnyRole: vi.fn(), getEmployeeForUser: vi.fn(),
  registerUpload: vi.fn(), issueDownloadToken: vi.fn(),
  getPartAAvailability: vi.fn(), recordPartA: vi.fn(), verifyPartA: vi.fn(),
  logSensitiveAction: vi.fn(),
}));

vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../document-vault/documentVault.service.js", () => ({ registerUpload, issueDownloadToken }));
vi.mock("../tds-certificate-part-a.service.js", () => ({ getPartAAvailability, recordPartA, verifyPartA }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: USER };
    next();
  },
}));
// requireRole answers "may you call this"; these tests are about "about whom",
// so it passes through and the ownership rules are what get asserted.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { tdsCertificatePartARouter } from "../tds-certificate-part-a.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/payroll/tds-certificate/part-a", tdsCertificatePartARouter);
  return a;
}

const VERIFIED = {
  financialYear: 2026, expectedFormNumber: "130", present: true, verified: true,
  certificateNumber: "ABCDE1234F", vaultDocumentId: "vault-9", coversQuarters: "Q1-Q4",
  status: "verified" as const, message: "ok",
};
const UNVERIFIED = {
  ...VERIFIED, verified: false, vaultDocumentId: null,
  status: "awaiting_verification" as const,
  message: "Part A for FY 2026-27 has been uploaded but not yet verified",
};

describe("Part A access rules", () => {
  beforeEach(() => {
    for (const m of [hasAnyRole, getEmployeeForUser, registerUpload, issueDownloadToken,
      getPartAAvailability, recordPartA, verifyPartA, logSensitiveAction]) m.mockReset();
    logSensitiveAction.mockResolvedValue(undefined);
    issueDownloadToken.mockResolvedValue({ rawToken: "tok-abc", expiresAt: new Date("2027-01-01T00:00:00Z") });
    getPartAAvailability.mockResolvedValue(VERIFIED);
    verifyPartA.mockResolvedValue(true);
  });

  it("lets an employee read their own certificate status", async () => {
    hasAnyRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: SELF });

    const res = await request(app()).get(`/api/payroll/tds-certificate/part-a/${SELF}/2026`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("verified");
  });

  it("refuses an employee reading a colleague's certificate", async () => {
    hasAnyRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: SELF });

    const res = await request(app()).get(`/api/payroll/tds-certificate/part-a/${OTHER}/2026`);

    expect(res.status).toBe(403);
    // The certificate must not even be looked up for someone else.
    expect(getPartAAvailability).not.toHaveBeenCalled();
  });

  it("refuses a user with no employee record", async () => {
    hasAnyRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue(null);

    const res = await request(app()).get(`/api/payroll/tds-certificate/part-a/${SELF}/2026`);
    expect(res.status).toBe(403);
  });

  it("lets payroll read any employee's certificate", async () => {
    hasAnyRole.mockResolvedValue(true);

    const res = await request(app()).get(`/api/payroll/tds-certificate/part-a/${OTHER}/2026`);

    expect(res.status).toBe(200);
    // Privileged callers short-circuit before the ownership lookup.
    expect(getEmployeeForUser).not.toHaveBeenCalled();
  });

  it("rejects a malformed financial year instead of guessing", async () => {
    hasAnyRole.mockResolvedValue(true);
    const res = await request(app()).get("/api/payroll/tds-certificate/part-a/emp/20");
    expect(res.status).toBe(400);
    expect(getPartAAvailability).not.toHaveBeenCalled();
  });
});

describe("Part A download grants", () => {
  beforeEach(() => {
    for (const m of [hasAnyRole, getEmployeeForUser, issueDownloadToken, getPartAAvailability, logSensitiveAction]) m.mockReset();
    logSensitiveAction.mockResolvedValue(undefined);
    issueDownloadToken.mockResolvedValue({ rawToken: "tok-abc", expiresAt: new Date("2027-01-01T00:00:00Z") });
  });

  it("issues a short-lived token for a verified certificate", async () => {
    hasAnyRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: SELF });
    getPartAAvailability.mockResolvedValue(VERIFIED);

    const res = await request(app()).post(`/api/payroll/tds-certificate/part-a/${SELF}/2026/download-token`);

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe("tok-abc");
    const grant = issueDownloadToken.mock.calls[0][0];
    expect(grant.vaultItemId).toBe("vault-9");
    // Bounded in time and uses — a tax certificate link should not be a
    // permanent, shareable URL.
    expect(grant.ttlMinutes).toBe(15);
    expect(grant.maxUses).toBe(3);
  });

  it("refuses to release an unverified certificate, even to payroll", async () => {
    hasAnyRole.mockResolvedValue(true);
    getPartAAvailability.mockResolvedValue(UNVERIFIED);

    const res = await request(app()).post(`/api/payroll/tds-certificate/part-a/${OTHER}/2026/download-token`);

    expect(res.status).toBe(409);
    expect(res.body.data.status).toBe("awaiting_verification");
    // The way to release it is to verify it, which is a recorded act.
    expect(issueDownloadToken).not.toHaveBeenCalled();
  });

  it("refuses a download for someone else's certificate", async () => {
    hasAnyRole.mockResolvedValue(false);
    getEmployeeForUser.mockResolvedValue({ id: SELF });

    const res = await request(app()).post(`/api/payroll/tds-certificate/part-a/${OTHER}/2026/download-token`);

    expect(res.status).toBe(403);
    expect(issueDownloadToken).not.toHaveBeenCalled();
  });
});

describe("Part A verification", () => {
  beforeEach(() => {
    for (const m of [verifyPartA, logSensitiveAction]) m.mockReset();
    logSensitiveAction.mockResolvedValue(undefined);
  });

  it("records the verification and who performed it", async () => {
    verifyPartA.mockResolvedValue(true);

    const res = await request(app()).post(`/api/payroll/tds-certificate/part-a/${SELF}/2026/verify`);

    expect(res.status).toBe(200);
    expect(verifyPartA).toHaveBeenCalledWith(SELF, 2026, USER);
    // Releasing a document to an employee is a sensitive act and is audited.
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "TDS_PART_A_VERIFIED" }),
    );
  });

  it("404s when there is nothing on file to verify", async () => {
    verifyPartA.mockResolvedValue(false);

    const res = await request(app()).post(`/api/payroll/tds-certificate/part-a/${SELF}/2026/verify`);

    expect(res.status).toBe(404);
  });
});
