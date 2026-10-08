import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeCtx } from "./_ctx.js";

const hasAnyRole = vi.fn();
const hasScopedAccess = vi.fn();
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a), hasScopedAccess: (...a: unknown[]) => hasScopedAccess(...a) }));
vi.mock("../../bulk-upload/bulk-approval.service.js", () => ({ APPROVER_ROLES: ["branch_head"], PAYROLL_APPROVER_ROLES: ["payroll_head"] }));
import { bulkUploadAdapter as a } from "../adapters/bulkUpload.js";
import { beforeEach as __scopeBeforeEach } from "vitest";
import { useScope, ORG_WIDE } from "./scope-fixture.js";
__scopeBeforeEach(() => useScope(ORG_WIDE));

const r = (o: any = {}) => ({ id: "u1", upload_batch_no: "UB-1", upload_type_code: "INCENTIVE_BULK", original_file_name: "inc.xlsx", total_rows: 50, imported_rows: 48, error_rows: 2, approval_status: "pending_branch_head", branch_id: "br1", branch_name: "Pune", uploaded_by: "up1", uploaded_by_name: "Wfm User", submitted_for_approval_at: "2026-10-01T00:00:00Z", ...o });
const roles = (set: string[]) => hasAnyRole.mockImplementation(async (_u: string, ...rr: string[]) => rr.some((x) => set.includes(x)));
beforeEach(() => { hasAnyRole.mockReset(); hasScopedAccess.mockReset(); hasScopedAccess.mockResolvedValue(true); });

describe("bulk upload adapter", () => {
  it("branch head sees only branch-stage, not own upload, in scope", async () => {
    roles(["branch_head"]);
    hasScopedAccess.mockImplementation(async (_u: string, _r: string[], t: any) => t.branchId === "br1");
    const { ctx } = fakeCtx({ "GET /api/bulk-upload/approvals/pending": { data: [r(), r({ id: "u2", approval_status: "pending_payroll_head" }), r({ id: "u3", uploaded_by: "u-caller" }), r({ id: "u4", branch_id: "other" })] } });
    const items = await a.list(ctx);
    expect(items.map((i) => i.id)).toEqual(["u1"]);
    const labels = items[0].fields.map((f) => f.label);
    for (const l of ["Batch no", "Upload type", "File", "Total rows", "Error rows", "Uploaded by", "Branch"]) expect(labels).toContain(l);
    expect(items[0].viewPath).toBe("/bulk-upload/approvals?approvalId=u1");
    expect(items[0].rejectNeedsReason).toBe(true);
  });
  it("payroll head sees payroll stage except ones they approved at branch stage", async () => {
    roles(["payroll_head"]);
    const { ctx } = fakeCtx({ "GET /api/bulk-upload/approvals/pending": { data: [r({ id: "u2", approval_status: "pending_payroll_head" }), r({ id: "u5", approval_status: "pending_payroll_head", branch_head_approved_by: "u-caller" }), r()] } });
    expect((await a.list(ctx)).map((i) => i.id)).toEqual(["u2"]);
  });
  it("decide", async () => {
    const { ctx, calls } = fakeCtx({ "POST /api/bulk-upload/approvals/batches/u1/approve": {}, "POST /api/bulk-upload/approvals/batches/u1/reject": {} });
    await a.decide(ctx, { id: "u1" }, "approve", "");
    await a.decide(ctx, { id: "u1" }, "reject", "wrong month in file");
    expect(calls.map((c) => c.path.split("/").pop())).toEqual(["approve", "reject"]);
    expect(calls[1].body).toEqual({ remarks: "wrong month in file" });
  });
});
