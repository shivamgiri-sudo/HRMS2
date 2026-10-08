import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));

import { clearRequisitionSourcesCache, getRequisitionSources } from "../he-requisition-sources.service.js";
import { getSourcesForRequisitions } from "../he-sources-window.service.js";
import { stripRule } from "./attributionSql.js";
import { qfTypeKeysSql, sourcesLeadsRows } from "../he-requisition-sources.service.js";
import { PersonFacts } from "../he-person-facts.service.js";
import { fillTypeSql } from "../he-source-attribution.js";

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
  q.includes("FROM qualified_followup qf") ? "stages" : q.includes("FROM he_drive d") ? "driveLeads"
    : q.includes("FROM meta_campaign") ? "campaigns" : q.includes("FROM requisition_stream") ? "streams" : "other";

describe("getSourcesForRequisitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    failOn = null;
    execute.mockImplementation(async (sql: string) => {
      const k = kindOf(String(sql));
      if (failOn && failOn.section === k) throw Object.assign(new Error("SELECT boom WHERE mobile = 9876543210"), { code: failOn.code });
      if (k === "stages") return [[{ requisition_id: "r1", source_type: "meta_live", origin_id: "c9", origin_label: "x", ...zeros, qualified: 20, joined: 2 }]];
      // one leads statement (sourcesLeadsSql): campaign fills and drive line-ups, one origin per person
      if (k === "driveLeads") return [[
        { requisition_id: "r1", source_type: "meta_live", origin_kind: "campaign", origin_id: "c9", origin_label: "Ad", leads: 60 },
        { requisition_id: "r1", source_type: "he", origin_id: "pool", origin_label: "Pool: ATS history", leads: 10 },
        { requisition_id: "r2", source_type: "meta_old", origin_id: "d7", origin_label: "Launch 7", leads: 30 },
      ]];
      if (k === "campaigns") return [[{ id: "c9", requisition_id: "r1", campaign_name: "Ad" }]];
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

  it("types qualified .. joined by the person rule, never by qualified_followup.source_type (the pipeline's enqueue-time type)", async () => {
    await getSourcesForRequisitions(["r1"], W);
    const stages = calls().find(([q]) => kindOf(q) === "stages")![0];
    expect(stages).toContain(`${qfTypeKeysSql("2026-10-08")}, qf.origin_id`);
    expect(stages).not.toMatch(/qf\.source_type/);
  });

  it("counts a person once: one type and one origin per person and requisition (a campaign fill plus a re-run line-up is one lead)", async () => {
    await getSourcesForRequisitions(["r1"], W);
    const q = calls().find(([x]) => kindOf(x) === "driveLeads")![0].replace(/\s+/g, " ");
    // per person (a hash of the mobile, never the mobile) the best campaign key of their fills, typed in SQL ...
    expect(q).toContain("SELECT /*+ MAX_EXECUTION_TIME(8000) */ 'f' AS src, MD5(f.person) AS pkey, f.requisition_id, MAX(CONCAT(4 - f.ft, 3, CHAR(31), 'campaign'");
    expect(q).toContain(`FIELD(${fillTypeSql("r", "2026-10-08").replace(/\s+/g, " ")}, 'meta_live', 'meta_old', 'he') AS ft`);
    expect(q).toContain("GROUP BY pkey, f.requisition_id");
    // ... and every line-up with its person signals, typed once per person in JS
    expect(q).toContain("SELECT 'l', MD5(al.mobile10 COLLATE utf8mb4_unicode_ci), d.requisition_id COLLATE utf8mb4_unicode_ci, NULL, m.lead_id AS tl,");
  });

  it("sourcesLeadsRows picks the same origin and type the SQL used to: most-Meta type, then stream > campaign > drive > pool", async () => {
    execute.mockResolvedValue([[{ id: "old", pm: 1, fl: 0 }]]);
    const pf = new PersonFacts("2026-10-08");
    await pf.load(["old"]);
    const sep = String.fromCharCode(31);
    const f = (pkey: string, rank: number, cid: string, name: string) => ({ src: "f", pkey, requisition_id: "r1", fkey: `${4 - rank}3${sep}campaign${sep}${cid}${sep}${name}` });
    const l = (pkey: string, tl: string | null, tm: number, o: Record<string, unknown> = {}) =>
      ({ src: "l", pkey, requisition_id: "r1", tl, tm, tr: 0, sid: null, so_id: null, so_label: null, drive_id: "d7", dlabel: "Re-run 2026-10-07", ...o });
    const out = sourcesLeadsRows([
      f("p1", 2, "c9", "Ad"), l("p1", "old", 0), // a campaign fill and a re-run line-up of one Old person: one lead, under the campaign
      l("p2", "old", 0),                          // an Old person on a pool drive: the drive is the origin
      l("p3", "new-pool", 0),                     // a Hiring Engine person: the pool
      l("p4", "new-pool", 1),                     // on a Meta drive: Old Meta data, the drive
      l("p5", "new-pool", 0, { sid: 5, so_id: "pool", so_label: "HR run" }), // a he stream credit: the stream's origin
    ] as never, pf);
    expect(out).toEqual([
      { requisition_id: "r1", source_type: "meta_old", origin_kind: "campaign", origin_id: "c9", origin_label: "Ad", leads: 1 },
      { requisition_id: "r1", source_type: "meta_old", origin_kind: "drive", origin_id: "d7", origin_label: "Re-run 2026-10-07", leads: 2 },
      { requisition_id: "r1", source_type: "he", origin_kind: "pool", origin_id: "pool", origin_label: "Pool: ATS history", leads: 1 },
      { requisition_id: "r1", source_type: "he", origin_kind: "stream", origin_id: "pool", origin_label: "HR run", leads: 1 },
    ]);
  });

  it("adds the leads rows per origin and never lets a person-typed origin double", async () => {
    execute.mockImplementation(async (sql: string) => {
      const k = kindOf(String(sql));
      if (k === "driveLeads") return [[
        { requisition_id: "r1", source_type: "meta_old", origin_kind: "campaign", origin_id: "c9", origin_label: "Ad", leads: 5 },
        { requisition_id: "r1", source_type: "meta_old", origin_kind: "drive", origin_id: "d7", origin_label: "Re-run 2026-10-07", leads: 3 },
      ]];
      if (k === "campaigns") return [[{ id: "c9", requisition_id: "r1", campaign_name: "Ad" }]];
      return [[]];
    });
    const rows = (await getSourcesForRequisitions(["r1"], W)).byRequisition[0].rows;
    expect(rows.map((r) => [r.sourceType, r.originId, r.leads])).toEqual([["meta_live", "c9", 0], ["meta_old", "c9", 5], ["meta_old", "d7", 3]]);
  });

  it("binds the window as IST day bounds on the follow-up, drive and form-fill statements", async () => {
    await getSourcesForRequisitions(["r1", "r2"], W);
    const by = (k: string) => calls().filter(([q]) => kindOf(q) === k);
    expect(by("stages")[0][1].slice(-2)).toEqual(["2026-10-01 00:00:00", "2026-10-15 00:00:00"]);
    expect(by("driveLeads")[0][1].slice(-2)).toEqual(["2026-10-01", "2026-10-14"]);
    // form fills by import time, line-ups by drive date, in one statement: ids, bounds, ids, dates
    expect(by("driveLeads")[0][1]).toEqual(["r1", "r2", "2026-10-01 00:00:00", "2026-10-15 00:00:00", "r1", "r2", "2026-10-01", "2026-10-14"]);
    expect(by("driveLeads")[0][0]).toContain("r.created_at >= ? AND r.created_at < ?");
    expect(by("stages")[0][0]).toContain("qf.qualified_at >= ? AND qf.qualified_at < ?");
    expect(by("driveLeads")[0][0]).toContain("d.drive_date BETWEEN ? AND ?");
  });

  it("batches 450 ids into statements of 200, 200 and 50, never one per requisition", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `r${i}`);
    await getSourcesForRequisitions(ids, W);
    const stages = calls().filter(([q]) => kindOf(q) === "stages");
    expect(stages.map(([, p]) => p.length - 3)).toEqual([200, 200, 50]); // cur start, ids, window bounds
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
    for (const q of calls().map(([c]) => stripRule(c))) { // the source rule's subqueries are keyed (sourceAttribution.test.ts)
      expect(q).toMatch(/requisition_id IN \(|campaign_id IN \(/);
      // form fills only by import-time range (idx_ml_created) of the window, each tied to one of the requisitions' campaigns
      if (q.includes("FROM meta_lead_raw")) { expect(q).toContain("FROM meta_lead_raw r FORCE INDEX (idx_ml_created)"); expect(q).toContain("r.created_at >= ? AND r.created_at < ?"); }
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
