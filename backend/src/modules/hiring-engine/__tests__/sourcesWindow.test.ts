import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));

import { clearRequisitionSourcesCache, getRequisitionSources } from "../he-requisition-sources.service.js";
import { getSourcesForRequisitions } from "../he-sources-window.service.js";

describe("getRequisitionSources SQL (pinned)", () => {
  beforeEach(() => { vi.clearAllMocks(); clearRequisitionSourcesCache(); });

  it("issues the same statements and parameters as before the window read model", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM job_requisition WHERE id")) return [[{ requisition_code: "REQ-1", branch_name: "Pune", designation_name: "Agent" }]];
      if (q.includes("FROM meta_campaign")) return [[{ id: "c9", campaign_name: "Ad" }]];
      return [[]];
    });
    await getRequisitionSources("r1", { all: true } as never);
    expect(execute.mock.calls.map((c) => [String(c[0]), c[1]])).toMatchSnapshot();
  });
});

const W = { from: "2026-10-01", to: "2026-10-14" };
const zeros = { qualified: 0, emailed: 0, whatsapped: 0, replied: 0, called: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
let failOn: { section: string; code: string } | null;
const calls = (): Array<[string, unknown[]]> => execute.mock.calls.map((c) => [String(c[0]), c[1] as unknown[]]);
const kindOf = (q: string): string =>
  q.includes("FROM qualified_followup qf") ? "stages" : q.includes("FROM he_drive d") ? "driveLeads" : q.includes("FROM meta_lead_raw") ? "campaignLeads"
    : q.includes("FROM meta_campaign") ? "campaigns" : q.includes("FROM requisition_stream") ? "streams" : "other";

describe("getSourcesForRequisitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failOn = null;
    execute.mockImplementation(async (sql: string) => {
      const k = kindOf(String(sql));
      if (failOn && failOn.section === k) throw Object.assign(new Error("SELECT boom WHERE mobile = 9876543210"), { code: failOn.code });
      if (k === "stages") return [[{ requisition_id: "r1", source_type: "meta_live", origin_id: "c9", origin_label: "x", ...zeros, qualified: 20, joined: 2 }]];
      if (k === "driveLeads") return [[
        { requisition_id: "r1", source_type: "he", origin_id: "pool", origin_label: "Pool: ATS history", leads: 10 },
        { requisition_id: "r2", source_type: "meta_old", origin_id: "d7", origin_label: "Launch 7", leads: 30 },
      ]];
      if (k === "campaigns") return [[{ id: "c9", requisition_id: "r1", campaign_name: "Ad" }]];
      if (k === "campaignLeads") return [[{ campaign_id: "c9", leads: 60 }]];
      return [[]];
    });
  });

  it("returns rows per requisition with shares computed per requisition", async () => {
    const out = await getSourcesForRequisitions(["r1", "r2"], W);
    expect(out).toMatchObject({ partial: false, failedSections: [] });
    const r1 = out.byRequisition.find((r) => r.requisitionId === "r1")!;
    const r2 = out.byRequisition.find((r) => r.requisitionId === "r2")!;
    expect(r1.rows.map((r) => [r.sourceType, r.originId, r.leads])).toEqual([["meta_live", "c9", 60], ["he", "pool", 10]]);
    expect(r1.rows.map((r) => r.shareOfLeads)).toEqual([60 / 70, 10 / 70]);
    expect(r2.rows.map((r) => [r.sourceType, r.originId, r.leads, r.shareOfLeads])).toEqual([["meta_old", "d7", 30, 1]]);
  });

  it("raises leads to the qualified count of a row", async () => {
    execute.mockImplementation(async (sql: string) => {
      const k = kindOf(String(sql));
      if (k === "stages") return [[{ requisition_id: "r1", source_type: "he", origin_id: "pool", origin_label: "Pool", ...zeros, qualified: 12 }]];
      if (k === "driveLeads") return [[{ requisition_id: "r1", source_type: "he", origin_id: "pool", origin_label: "Pool", leads: 5 }]];
      return [[]];
    });
    const out = await getSourcesForRequisitions(["r1"], W);
    expect(out.byRequisition[0].rows[0].leads).toBe(12);
  });

  it("binds the window as IST day bounds on the follow-up, drive and form-fill statements", async () => {
    await getSourcesForRequisitions(["r1", "r2"], W);
    const by = (k: string) => calls().filter(([q]) => kindOf(q) === k);
    expect(by("stages")[0][1].slice(-2)).toEqual(["2026-10-01 00:00:00", "2026-10-15 00:00:00"]);
    expect(by("driveLeads")[0][1].slice(-2)).toEqual(["2026-10-01", "2026-10-14"]);
    expect(by("campaignLeads")[0][1].slice(-2)).toEqual(["2026-10-01 00:00:00", "2026-10-15 00:00:00"]);
    expect(by("stages")[0][0]).toContain("qf.qualified_at >= ? AND qf.qualified_at < ?");
    expect(by("driveLeads")[0][0]).toContain("d.drive_date BETWEEN ? AND ?");
  });

  it("batches 450 ids into statements of 200, 200 and 50, never one per requisition", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `r${i}`);
    await getSourcesForRequisitions(ids, W);
    const stages = calls().filter(([q]) => kindOf(q) === "stages");
    expect(stages.map(([, p]) => p.length - 2)).toEqual([200, 200, 50]);
    expect(calls().filter(([q]) => kindOf(q) === "driveLeads")).toHaveLength(3);
  });

  it("makes no query for an empty list", async () => {
    const out = await getSourcesForRequisitions([], W);
    expect(out).toEqual({ byRequisition: [], partial: false, failedSections: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  it("flags a failing statement, keeps the other rows and logs only the section and code", async () => {
    failOn = { section: "stages", code: "ER_BAD_FIELD_ERROR" };
    const out = await getSourcesForRequisitions(["r1", "r2"], W);
    expect(out.partial).toBe(true);
    expect(out.failedSections).toEqual(["stages"]);
    expect(out.byRequisition.find((r) => r.requisitionId === "r2")!.rows).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith({ section: "stages", code: "ER_BAD_FIELD_ERROR" }, expect.any(String));
    for (const c of logError.mock.calls) expect(JSON.stringify(c)).not.toMatch(/boom|9876543210|message/);
  });

  it("lists a failed section once however many batches fail", async () => {
    failOn = { section: "stages", code: "ER_BAD_FIELD_ERROR" };
    const out = await getSourcesForRequisitions(Array.from({ length: 450 }, (_, i) => `r${i}`), W);
    expect(out.failedSections).toEqual(["stages"]);
  });

  it("treats a missing stream table as no streams, not a failure", async () => {
    failOn = { section: "streams", code: "ER_NO_SUCH_TABLE" };
    const out = await getSourcesForRequisitions(["r1"], W);
    expect(out).toMatchObject({ partial: false, failedSections: [] });
    expect(out.byRequisition[0].rows.length).toBeGreaterThan(0);
  });

  it("treats a missing stream table on the drive-leads statement as empty, not a failure (M2)", async () => {
    failOn = { section: "driveLeads", code: "ER_NO_SUCH_TABLE" };
    const out = await getSourcesForRequisitions(["r1"], W);
    expect(out).toMatchObject({ partial: false, failedSections: [] });
    expect(out.byRequisition[0].rows.map((r) => r.sourceType)).toEqual(["meta_live"]);
  });

  it("flags the window section instead of throwing a RangeError on malformed dates (M1)", async () => {
    for (const bad of [{ from: "garbage", to: "2026-10-14" }, { from: "2026-10-01", to: "2026-13-45" }, { from: "2026-10-01", to: "" }]) {
      const out = await getSourcesForRequisitions(["r1", "r2"], bad);
      expect(out).toMatchObject({ partial: true, failedSections: ["window"] });
      expect(out.byRequisition.map((r) => [r.requisitionId, r.rows])).toEqual([["r1", []], ["r2", []]]);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("adds a zero row for a stream and carries its status", async () => {
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, p: unknown[]) => kindOf(String(sql)) === "streams"
      ? [[{ requisition_id: "r2", id: "s1", source_type: "he", origin_id: "pool", origin_label: "Pool: ATS history", status: "open" }]] : base(sql, p));
    const r2 = (await getSourcesForRequisitions(["r1", "r2"], W)).byRequisition.find((r) => r.requisitionId === "r2")!;
    expect(r2.rows.find((r) => r.sourceType === "he")).toMatchObject({ streamId: "s1", streamStatus: "open", leads: 0, joined: 0 });
  });

  it("scopes every statement by requisition or campaign and never scans lead or message tables", async () => {
    await getSourcesForRequisitions(["r1", "r2"], W);
    for (const [q] of calls()) {
      expect(q).toMatch(/requisition_id IN \(|campaign_id IN \(/);
      if (q.includes("FROM meta_lead_raw")) expect(q).toContain("campaign_id IN (");
      // he_lead / he_message appear only as keyed EXISTS subqueries or key joins of the follow-up rows, never as a scan
      expect(q.replaceAll("SELECT 1 FROM he_message", "").replaceAll("SELECT 1 FROM he_lead", "")).not.toMatch(/FROM he_message|FROM he_lead/);
    }
    for (const [q] of calls().filter(([c]) => kindOf(c) === "stages")) {
      expect(q).toContain("qf.requisition_id IN (");
      expect(q).toContain("GROUP BY f.requisition_id");
      expect(q).toContain("COLLATE utf8mb4_unicode_ci");
    }
  });
});
