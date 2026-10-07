import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { writeAuditLog } = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog }));

const { create, update, generateNextCode } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  generateNextCode: vi.fn(),
}));
vi.mock("../../erp/erp.service.js", () => ({
  vendorService: { create, update, generateNextCode },
}));

import { vendorApprovalService } from "../vendor-approval.service.js";

beforeEach(() => {
  execute.mockReset();
  writeAuditLog.mockReset();
  create.mockReset();
  update.mockReset();
  generateNextCode.mockReset();
});

describe("vendorApprovalService.raise", () => {
  it("writes a pending row with the caller and branch, not the request body", async () => {
    execute.mockResolvedValueOnce([{}]);

    const result = await vendorApprovalService.raise({
      requestType: "create",
      vendorId: null,
      payload: { vendor_name: "Acme Supplies" },
      raisedBy: "user-1",
      branchId: "branch-9",
    });

    expect(result.status).toBe("pending");
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("INSERT INTO vendor_approval_request");
    expect(params).toEqual([
      result.id,
      "create",
      null,
      JSON.stringify({ vendor_name: "Acme Supplies" }),
      "user-1",
      "branch-9",
    ]);
  });

  it("rejects a create/update request with no vendor_name", async () => {
    await expect(
      vendorApprovalService.raise({
        requestType: "create",
        vendorId: null,
        payload: {},
        raisedBy: "user-1",
        branchId: "branch-9",
      }),
    ).rejects.toThrow(/vendor_name/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an update request with no vendorId", async () => {
    await expect(
      vendorApprovalService.raise({
        requestType: "update",
        vendorId: null,
        payload: { vendor_name: "Acme" },
        raisedBy: "user-1",
        branchId: "branch-9",
      }),
    ).rejects.toThrow(/vendorId/);
  });
});

describe("vendorApprovalService.approve", () => {
  const PENDING_ROW = {
    id: "req-1",
    status: "pending",
    request_type: "create",
    vendor_id: null,
    raised_by: "user-branch-admin",
    payload: JSON.stringify({ vendor_name: "Acme Supplies" }),
  };

  it("blocks the requester from approving their own request (maker-checker)", async () => {
    execute.mockResolvedValueOnce([[PENDING_ROW]]);

    await expect(
      vendorApprovalService.approve("req-1", "user-branch-admin", null),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the vendor and marks the request approved when reviewed by someone else", async () => {
    execute.mockResolvedValueOnce([[PENDING_ROW]]);
    generateNextCode.mockResolvedValueOnce("V00099");
    create.mockResolvedValueOnce({ id: "vendor-1" });
    execute.mockResolvedValueOnce([{}]); // the UPDATE ... SET status='approved'

    const result = await vendorApprovalService.approve(
      "req-1",
      "user-finance-head",
      null,
      "ok",
    );

    expect(result).toEqual({ vendorId: "vendor-1" });
    expect(create).toHaveBeenCalledWith({
      vendor_name: "Acme Supplies",
      vendor_code: "V00099",
    });
    const updateCall = execute.mock.calls[1];
    expect(String(updateCall[0])).toContain("status = 'approved'");
    expect(updateCall[1]).toEqual(["user-finance-head", "ok", "req-1"]);
  });

  it("merges an edited payload over the originally submitted one before creating the vendor", async () => {
    execute.mockResolvedValueOnce([[PENDING_ROW]]);
    generateNextCode.mockResolvedValueOnce("V00100");
    create.mockResolvedValueOnce({ id: "vendor-2" });
    execute.mockResolvedValueOnce([{}]);

    await vendorApprovalService.approve("req-1", "user-finance-head", {
      gst_number: "22AAAAA0000A1Z5",
    });

    expect(create).toHaveBeenCalledWith({
      vendor_name: "Acme Supplies",
      gst_number: "22AAAAA0000A1Z5",
      vendor_code: "V00100",
    });
  });

  it("refuses to approve a request that is already decided", async () => {
    execute.mockResolvedValueOnce([[{ ...PENDING_ROW, status: "approved" }]]);

    await expect(
      vendorApprovalService.approve("req-1", "user-finance-head", null),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("404s when the request does not exist", async () => {
    execute.mockResolvedValueOnce([[]]);

    await expect(
      vendorApprovalService.approve("nope", "user-finance-head", null),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("vendorApprovalService.reject", () => {
  it("marks a pending request rejected with the reviewer's notes", async () => {
    execute.mockResolvedValueOnce([[{ id: "req-1", status: "pending" }]]);
    execute.mockResolvedValueOnce([{}]);

    await vendorApprovalService.reject(
      "req-1",
      "user-finance-head",
      "missing GST",
    );

    const updateCall = execute.mock.calls[1];
    expect(String(updateCall[0])).toContain("status = 'rejected'");
    expect(updateCall[1]).toEqual([
      "user-finance-head",
      "missing GST",
      "req-1",
    ]);
  });

  it("refuses to reject an already-decided request", async () => {
    execute.mockResolvedValueOnce([[{ id: "req-1", status: "rejected" }]]);

    await expect(
      vendorApprovalService.reject("req-1", "user-finance-head", "again"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
