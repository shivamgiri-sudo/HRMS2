import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { enqueueMetaLeadFollowup, enqueueQualifiedFollowup } from "../qualified-followup.service.js";
import { readSwitches } from "../qualified-followup.policy.js";
import type { EnqueueInput } from "../qualified-followup.types.js";

const input: EnqueueInput = { sourceType: "meta_live", requisitionId: "req-1", originId: "c1", originLabel: "Camp", phone: "+91 98765 43210", email: "a@b.com", metaLeadId: "m1", eligibilityChecked: true };
const sw = (env: Record<string, string>, codes: Record<string, number> = { meta_live: 4, meta_old: 4, he: 4 }) =>
  readSwitches(env as NodeJS.ProcessEnv, new Map(Object.entries(codes).map(([k, v]) => [`policy.followup.${k}`, v])));
const LIVE = sw({ QUAL_FOLLOWUP_MODE: "live" });
const OPEN = [[{ approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0 }]];
/** requisition open -> no existing row -> INSERT -> read back (the inserted id, or `winner`). */
const wireNew = (winner: Record<string, unknown> | null = null) => {
  let inserted: unknown = null;
  execute.mockImplementation(async (sql: string, p: unknown[] = []) => {
    if (sql.includes("FROM job_requisition")) return OPEN;
    if (sql.startsWith("INSERT")) { inserted = p[0]; return [{ affectedRows: 1 }]; }
    if (sql.includes("FROM qualified_followup WHERE mobile10")) return [inserted ? [winner ?? { id: inserted, source_type: "meta_live", mode_at_enqueue: "live", stopped_reason: null }] : []];
    return [{ affectedRows: 1 }];
  });
};
const insertCall = () => execute.mock.calls.find(([q]) => String(q).startsWith("INSERT INTO qualified_followup"))!;

beforeEach(() => { execute.mockReset(); });

describe("enqueueQualifiedFollowup", () => {
  it("env off: no database call", async () => {
    expect((await enqueueQualifiedFollowup(input, sw({}))).status).toBe("skipped_off");
    expect(execute).not.toHaveBeenCalled();
  });
  it("loads the switches itself: env unset -> no database call", async () => {
    vi.stubEnv("QUAL_FOLLOWUP_MODE", "");
    expect((await enqueueQualifiedFollowup(input)).status).toBe("skipped_off");
    expect(execute).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("dry_run source: one INSERT carrying dry_run, returns enqueued with the generated id", async () => {
    wireNew();
    const r = await enqueueQualifiedFollowup(input, sw({ QUAL_FOLLOWUP_MODE: "live" }, { meta_live: 1 }));
    expect(r.status).toBe("enqueued");
    const [sql, params] = insertCall();
    expect(r.id).toBe(params[0]);
    expect(sql).toContain("INSERT INTO qualified_followup");
    expect(params.at(-1)).toBe("dry_run");
    expect(params).toContain("9876543210");
  });
  it("invalid phone or empty requisition: invalid, no INSERT", async () => {
    expect((await enqueueQualifiedFollowup({ ...input, phone: "123" }, LIVE)).status).toBe("invalid");
    expect((await enqueueQualifiedFollowup({ ...input, requisitionId: "" }, LIVE)).status).toBe("invalid");
    expect((await enqueueQualifiedFollowup({ ...input, phone: "987654321" }, LIVE)).status).toBe("invalid");
    expect((await enqueueQualifiedFollowup({ ...input, phone: "abc-xyz" }, LIVE)).status).toBe("invalid");
    expect(execute).not.toHaveBeenCalled();
  });
  it("a concurrent enrolment that won the insert answers exists and records the other source", async () => {
    wireNew({ id: "q1", source_type: "he", also_in_sources: null, mode_at_enqueue: "live", stopped_reason: null });
    expect(await enqueueQualifiedFollowup(input, LIVE)).toEqual({ status: "exists", id: "q1" });
    const also = execute.mock.calls.find(([q]) => String(q).startsWith("UPDATE qualified_followup SET also_in_sources"))!;
    expect(also[1][0]).toBe(JSON.stringify(["meta_live"]));
  });
  it("never rejects on a database error", async () => {
    execute.mockRejectedValueOnce(new Error("boom"));
    expect((await enqueueQualifiedFollowup(input, LIVE)).status).toBe("invalid");
  });
});

describe("row tag (screen switch capped by the env)", () => {
  const tagFor = async (env: Record<string, string>, code: number) => {
    wireNew();
    await enqueueQualifiedFollowup(input, sw(env, { meta_live: code }));
    return insertCall()[1].at(-1);
  };
  it("live + test flag writes the test tag", async () => expect(await tagFor({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true" }, 4)).toBe("test"));
  it("live writes live", async () => expect(await tagFor({ QUAL_FOLLOWUP_MODE: "live" }, 4)).toBe("live"));
  it("env dry_run caps a live source at dry_run", async () => expect(await tagFor({ QUAL_FOLLOWUP_MODE: "dry_run" }, 4)).toBe("dry_run"));
  it("screen test writes test", async () => expect(await tagFor({ QUAL_FOLLOWUP_MODE: "live" }, 2)).toBe("test"));
});

describe("enqueueMetaLeadFollowup", () => {
  const lead = { id: "m1", screening_result: "qualified", parsed_phone: "9876543210", parsed_name: "A", parsed_email: null, campaign_id: "c1", req_id: "req-1", campaign_name: "Camp", jr_id: "req-1", meta_screening_config: null };
  const wireLead = (row: Record<string, unknown>) => {
    let inserted: unknown = null;
    execute.mockImplementation(async (sql: string, p: unknown[] = []) => {
      if (sql.includes("FROM meta_lead_raw r")) return [[row]];
    if (sql.includes("FROM job_requisition")) return OPEN;
      if (sql.includes("FROM he_lead")) return [[]];
      if (sql.startsWith("INSERT INTO qualified_followup")) { inserted = p[0]; return [{ affectedRows: 1 }]; }
      if (sql.includes("FROM qualified_followup WHERE mobile10")) return [inserted ? [{ id: inserted, source_type: "meta_live", mode_at_enqueue: "live", stopped_reason: null }] : []];
      return [[]];
    });
  };
  it("Live Meta off: no database call", async () => {
    expect((await enqueueMetaLeadFollowup("m1", { switches: sw({ QUAL_FOLLOWUP_MODE: "live" }, { he: 4 }) })).status).toBe("skipped_off");
    expect(execute).not.toHaveBeenCalled();
  });
  it("not qualified", async () => {
    wireLead({ ...lead, screening_result: "rejected" });
    expect((await enqueueMetaLeadFollowup("m1", { switches: LIVE })).status).toBe("not_qualified");
  });
  it("no requisition or a missing requisition row: invalid, no INSERT", async () => {
    wireLead({ ...lead, req_id: null });
    expect((await enqueueMetaLeadFollowup("m1", { switches: LIVE })).status).toBe("invalid");
    wireLead({ ...lead, jr_id: null });
    expect((await enqueueMetaLeadFollowup("m1", { switches: LIVE })).status).toBe("invalid");
    expect(execute.mock.calls.some((c) => String(c[0]).includes("INSERT"))).toBe(false);
  });
  it("qualified lead is enqueued as meta_live with campaign origin", async () => {
    wireLead(lead);
    expect((await enqueueMetaLeadFollowup("m1", { switches: LIVE })).status).toBe("enqueued");
    const params = insertCall()[1];
    expect(params[1]).toBe("meta_live");
    expect(params).toContain("c1");
    expect(params).toContain("Camp");
  });
  it("database error is returned as invalid", async () => {
    execute.mockRejectedValueOnce(new Error("boom"));
    await expect(enqueueMetaLeadFollowup("m1", { switches: LIVE })).resolves.toEqual({ status: "invalid" });
  });
});
