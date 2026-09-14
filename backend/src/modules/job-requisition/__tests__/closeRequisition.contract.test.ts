import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Feature added 2026-09-08 per an explicit product decision: "there must be
 * an option to close the Job requisition and creator and Super admin should
 * have right to close that, HR team (any designation) can request there to
 * close this batch with reason."
 *
 * Direct-close right = super_admin (org-wide) OR branch_head (unchanged,
 * pre-existing right) OR the requisition's own creator (requested_by) —
 * added on top of, not instead of, what already existed. Everyone else in
 * the HR-family role set can only ask one of those three to close it via
 * requestClose, which changes nothing about the requisition itself.
 */
const serviceCode = fs.readFileSync(
  path.resolve(__dirname, "../job-requisition.service.ts"),
  "utf8",
);
const routesCode = fs.readFileSync(
  path.resolve(__dirname, "../job-requisition.routes.ts"),
  "utf8",
);

function extractFn(code: string, signature: string, nextSignature: string) {
  const start = code.indexOf(signature);
  expect(start, `could not find "${signature}"`).toBeGreaterThan(-1);
  const end = code.indexOf(nextSignature, start + signature.length);
  expect(end, `could not find "${nextSignature}" after "${signature}"`).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe("closeRequisition (service)", () => {
  const fn = extractFn(serviceCode, "async closeRequisition(", "async requestClose(");

  it("refuses to re-close an already-closed requisition", () => {
    expect(fn).toContain("already closed");
    expect(fn).toContain("statusCode: 409");
  });

  it("authorizes exactly super_admin, branch_head, or the requisition's own creator", () => {
    expect(fn).toContain("scope.isSuperAdmin");
    expect(fn).toContain('scope.roles.includes("branch_head")');
    expect(fn).toContain("existing.requested_by === actorId");
    expect(fn).toContain("statusCode: 403");
  });

  it("does not gate on resolveUserBusinessScope's isHr/isAdmin flags, only isSuperAdmin", () => {
    // isHr / isAdmin would be far too broad here — the request-close path
    // exists precisely so ordinary HR roles do NOT get a direct-close right.
    expect(fn).not.toContain("scope.isHr");
    expect(fn).not.toContain("scope.isAdmin");
  });

  it("records the closure with a reason and timestamps it", () => {
    expect(fn).toContain("approval_status = 'closed'");
    expect(fn).toContain("closed_at = NOW()");
    expect(fn).toContain("closed_reason");
  });

  it("logs the close action to the approval audit trail", () => {
    expect(fn).toContain('"closed"');
  });
});

describe("requestClose (service)", () => {
  const fn = extractFn(serviceCode, "async requestClose(", "async extendDeadline(");

  it("refuses to request-close an already-closed requisition", () => {
    expect(fn).toContain("already closed");
    expect(fn).toContain("statusCode: 409");
  });

  it("does not itself change the requisition's approval_status", () => {
    expect(fn).not.toContain("approval_status = 'closed'");
    expect(fn).not.toContain("UPDATE job_requisition");
  });

  it("logs the request to the approval audit trail as close_requested", () => {
    expect(fn).toContain('"close_requested"');
  });

  it("notifies the people who actually hold direct-close rights", () => {
    expect(fn).toContain("notifyApprovers(existing");
  });

  it("explicitly notifies the creator too, since they may not be super_admin/branch_head", () => {
    expect(fn).toContain("existing.requested_by");
    expect(fn).toContain("existing.requested_by !== actorId");
  });
});

describe("logApprovalAction action type", () => {
  it("accepts both 'closed' and 'close_requested' as valid audit actions", () => {
    const idx = serviceCode.indexOf("async logApprovalAction(");
    expect(idx).toBeGreaterThan(-1);
    const sig = serviceCode.slice(idx, idx + 400);
    expect(sig).toContain('"closed"');
    expect(sig).toContain('"close_requested"');
  });
});

describe("job-requisition routes: close & request-close", () => {
  it("POST /:id/close requires a non-empty reason and delegates authorization to the service", () => {
    const route = extractFn(routesCode, '"/:id/close"', '"/:id/request-close"');
    expect(route).toContain("A close reason is required");
    expect(route).toContain("closeRequisition(id, userId, reason.trim())");
  });

  it("POST /:id/request-close is open to the full HR-designation read-role set", () => {
    const idx = routesCode.indexOf('"/:id/request-close"');
    expect(idx).toBeGreaterThan(-1);
    const route = routesCode.slice(idx, idx + 1500);
    expect(route).toContain("REQUISITION_READ_ROLES");
    expect(route).toContain("requestClose(id, userId, userName, userRole, reason.trim())");
  });

  it("request-close enforces a minimum reason length server-side", () => {
    const idx = routesCode.indexOf('"/:id/request-close"');
    const route = routesCode.slice(idx, idx + 1500);
    expect(route).toContain("reason.trim().length < 5");
  });
});
