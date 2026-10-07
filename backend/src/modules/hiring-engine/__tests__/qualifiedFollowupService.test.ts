import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { enqueueMetaLeadFollowup, enqueueQualifiedFollowup } from "../qualified-followup.service.js";
import type { EnqueueInput } from "../qualified-followup.types.js";

const input: EnqueueInput = { sourceType: "meta_live", requisitionId: "req-1", originId: "c1", originLabel: "Camp", phone: "+91 98765 43210", email: "a@b.com", metaLeadId: "m1" };

beforeEach(() => execute.mockReset());

describe("enqueueQualifiedFollowup", () => {
  it("off: no database call", async () => {
    expect((await enqueueQualifiedFollowup(input, "off")).status).toBe("skipped_off");
    expect(execute).not.toHaveBeenCalled();
  });
  it("dry_run: one INSERT carrying dry_run, returns enqueued", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockImplementationOnce(async () => [[{ id: execute.mock.calls[0][1][0], source_type: "meta_live" }]]);
    const r = await enqueueQualifiedFollowup(input, "dry_run");
    expect(r.status).toBe("enqueued");
    expect(r.id).toBe(execute.mock.calls[0][1][0]);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("(id, source_type");
    expect(params[15]).toBeInstanceOf(Date);
    expect(params[16]).toBeInstanceOf(Date);
    expect(sql).toMatch(/\?, NULL, \?\)/);
    expect(sql).toContain("INSERT INTO qualified_followup");
    expect(sql).toContain("call_due_at");
    expect(params).toContain("dry_run");
    expect(params).toContain("9876543210");
  });
  it("invalid phone or empty requisition: invalid, no INSERT", async () => {
    expect((await enqueueQualifiedFollowup({ ...input, phone: "123" }, "dry_run")).status).toBe("invalid");
    expect((await enqueueQualifiedFollowup({ ...input, requisitionId: "" }, "dry_run")).status).toBe("invalid");
    expect(execute).not.toHaveBeenCalled();
  });
  it("9-digit and junk phones are invalid through the service", async () => {
    expect((await enqueueQualifiedFollowup({ ...input, phone: "987654321" }, "dry_run")).status).toBe("invalid");
    expect((await enqueueQualifiedFollowup({ ...input, phone: "abc-xyz" }, "dry_run")).status).toBe("invalid");
    expect(execute).not.toHaveBeenCalled();
  });
  it("collision with a different source appends it to also_in_sources", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[{ id: "q1", source_type: "he", also_in_sources: null }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const r = await enqueueQualifiedFollowup(input, "live");
    expect(r).toEqual({ status: "exists", id: "q1" });
    const [sql, params] = execute.mock.calls[2];
    expect(sql).toContain("UPDATE qualified_followup SET also_in_sources");
    expect(params[0]).toBe(JSON.stringify(["meta_live"]));
  });
  it("collision with the same source does not update", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[{ id: "q1", source_type: "meta_live" }]]);
    expect((await enqueueQualifiedFollowup(input, "live")).status).toBe("exists");
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("never rejects on a database error", async () => {
    execute.mockRejectedValueOnce(new Error("boom"));
    expect((await enqueueQualifiedFollowup(input, "live")).status).toBe("invalid");
  });
});

describe("enqueueMetaLeadFollowup", () => {
  const lead = { id: "m1", screening_result: "qualified", parsed_phone: "9876543210", parsed_name: "A", parsed_email: null, campaign_id: "c1", req_id: "req-1", campaign_name: "Camp", campaign_status: "active", jr_id: "req-1" };
  it("off: no database call", async () => {
    expect((await enqueueMetaLeadFollowup("m1", "off")).status).toBe("skipped_off");
    expect(execute).not.toHaveBeenCalled();
  });
  it("not qualified", async () => {
    execute.mockResolvedValueOnce([[{ ...lead, screening_result: "rejected" }]]);
    expect((await enqueueMetaLeadFollowup("m1", "dry_run")).status).toBe("not_qualified");
  });
  it("no requisition: invalid", async () => {
    execute.mockResolvedValueOnce([[{ ...lead, req_id: null }]]);
    expect((await enqueueMetaLeadFollowup("m1", "dry_run")).status).toBe("invalid");
  });
  it("requisition row missing: invalid, no INSERT", async () => {
    execute.mockResolvedValueOnce([[{ ...lead, jr_id: null }]]);
    expect((await enqueueMetaLeadFollowup("m1", "dry_run")).status).toBe("invalid");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.some((c) => String(c[0]).includes("INSERT"))).toBe(false);
  });
  it("a paused campaign lead is still meta_live", async () => {
    execute.mockResolvedValueOnce([[{ ...lead, campaign_status: "paused" }]]).mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[{ id: "q1", source_type: "meta_live" }]]);
    await enqueueMetaLeadFollowup("m1", "dry_run");
    expect(execute.mock.calls[1][1][1]).toBe("meta_live");
  });
  it("qualified live lead is enqueued as meta_live with campaign origin", async () => {
    execute.mockResolvedValueOnce([[lead]]).mockResolvedValueOnce([{ affectedRows: 1 }]).mockImplementationOnce(async () => [[{ id: execute.mock.calls[1][1][0], source_type: "meta_live" }]]);
    expect((await enqueueMetaLeadFollowup("m1", "dry_run")).status).toBe("enqueued");
    const params = execute.mock.calls[1][1];
    expect(params[1]).toBe("meta_live");
    expect(params).toContain("c1");
    expect(params).toContain("Camp");
  });
  it("database error is returned as invalid", async () => {
    execute.mockRejectedValueOnce(new Error("boom"));
    await expect(enqueueMetaLeadFollowup("m1", "dry_run")).resolves.toEqual({ status: "invalid" });
  });
});
