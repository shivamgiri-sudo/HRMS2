import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

/**
 * A bulk upload has to survive the night and reach payroll.
 *
 * Three separate breaks between "the file uploaded" and "the money is right" are
 * guarded here, each verified against the live database before it was fixed:
 *
 *  1. REACHABILITY — five upload types were live, selectable templates with a working
 *     backend import and no entry in the Hub's rpc map, so Import answered "not enabled
 *     yet". Zero batches existed for any of them.
 *
 *  2. TERMINAL STATUS — bulk leave approved as 'branch_head_approved', a status only
 *     two readers in the codebase recognise. attendance-engine.service.ts resolves its
 *     approved-leave override on `status = 'approved'` alone and leaves the day
 *     is_locked = 0, so the nightly run reclassified an approved leave day from
 *     biometric evidence and payroll charged LWP.
 *
 *  3. THE LOCK — `bulk_upload_locked_entity` was written on every bulk approval and
 *     `getEntityLock` was written to read it, but no production code called it, so an
 *     approved bulk row could still be discarded one at a time.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf8");

describe("every built import is reachable from the Bulk Upload Hub", () => {
  const hub = read("src/pages/BulkUploadHub.tsx");
  const routes = read("backend/src/modules/bulk-upload/bulk-upload.routes.ts");

  const mapBody = hub.slice(
    hub.indexOf("const IMPORT_RPC_BY_TYPE"),
    hub.indexOf("function getImportRpc"),
  );
  const mappedRpcs = [...mapBody.matchAll(/"(import_[a-z_]+)"/g)].map((m) => m[1]);

  const knownBody = routes.slice(
    routes.indexOf("const KNOWN_IMPORT_RPCS"),
    routes.indexOf("// POST /batches/:id/import"),
  );
  const knownRpcs = new Set([...knownBody.matchAll(/"(import_[a-z_]+)"/g)].map((m) => m[1]));

  // The four approval-gated types plus PF UAN — every one of them an active row in
  // upload_template_master on the live database.
  it.each([
    ["LEAVE_APPLICATION_BULK", "import_leave_application_batch"],
    ["ATTENDANCE_REGULARIZATION_BULK", "import_attendance_regularization_batch"],
    ["INCENTIVE_BULK", "import_incentive_bulk_batch"],
    ["DEDUCTION_BULK", "import_deduction_bulk_batch"],
    ["PF_UAN_UPDATE", "import_pf_uan_batch"],
  ])("%s can actually be imported", (typeCode, rpc) => {
    expect(mapBody).toContain(`${typeCode}: "${rpc}"`);
    expect(knownRpcs.has(rpc)).toBe(true);
  });

  it("never offers an rpc the backend would refuse with 501", () => {
    const orphans = mappedRpcs.filter((rpc) => !knownRpcs.has(rpc));
    expect(orphans).toEqual([]);
  });
});

describe("bulk leave lands in the status the attendance engine reads", () => {
  it("approves as 'approved', not a status only the leave module knows", async () => {
    const reviewRequest = vi.fn().mockResolvedValue(undefined);
    const lockEntities = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../../../db/mysql.js", () => ({
      db: {
        execute: vi.fn().mockResolvedValue([
          [{ id: "row-1", row_no: 2, created_entity_id: "leave-1" }],
        ]),
      },
    }));
    vi.doMock("../../leave/leave.service.js", () => ({ leaveService: { reviewRequest } }));
    vi.doMock("../bulk-approval.service.js", () => ({
      loadStagedRows: vi.fn(), resolveEmployees: vi.fn(), resolveSingleBranch: vi.fn(),
      linkRowToEntity: vi.fn(), markRowFailed: vi.fn(), markPendingApproval: vi.fn(),
      normalizeDate: (v: string) => v, lockEntities,
      BulkUploadError: class extends Error {},
    }));

    const { applyLeaveBatch } = await import("../leave-application-bulk.service.js");
    const out = await applyLeaveBatch(
      { id: "b1", upload_batch_no: "BATCH-1" } as any, "approver-1", null,
    );

    expect(out.applied).toBe(1);
    expect(reviewRequest).toHaveBeenCalledTimes(1);
    const status = reviewRequest.mock.calls[0]![1].status;
    expect(status).toBe("approved");
    // The engine's override query is `leave_request.status = 'approved'`. Anything
    // else and the nightly run cannot see the leave behind the attendance day.
    expect(status).not.toBe("branch_head_approved");
    // The row is recorded as locked (batched, one call) so it cannot be unpicked
    // one at a time.
    expect(lockEntities).toHaveBeenCalledTimes(1);
    expect(lockEntities.mock.calls[0][0]).toHaveLength(1);
    vi.resetModules();
  });

  it("still matches the status the attendance engine actually queries", () => {
    const engine = read("backend/src/modules/wfm/attendance-engine.service.ts");
    const override = engine.slice(engine.indexOf("// 1. Approved leave"));
    expect(override).toMatch(/FROM leave_request[\s\S]{0,120}status = 'approved'/);
  });
});
