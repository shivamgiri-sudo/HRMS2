import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { OTHER_BRANCH_CAMPAIGN, aggregatePersons, campaignProgress, personsSql, readPersonStages } from "../he-drive-persons.service.js";
import { fillFirstCampaignSql, fillTypeSql, metaOriginSql } from "../he-source-attribution.js";
import { stripRule } from "./attributionSql.js";

const W = { from: "2026-10-01", to: "2026-10-14" };
const row = (o: Record<string, unknown>) => ({ requisition_id: "r1", source_type: "he", campaign_id: null, leads: 0, qualified: 0, contacted: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });

beforeEach(() => { vi.clearAllMocks(); });

describe("personsSql (events-based stages, one row per person and requisition)", () => {
  const sql = personsSql(2, true, "2026-10-08");
  const flat = sql.replace(/\s+/g, " ");
  it("unions form fills, drive line-ups, sent messages, confirmation events and arrival events", () => {
    expect(flat).toContain("FROM meta_campaign mc JOIN meta_lead_raw r ON r.campaign_id = mc.id COLLATE utf8mb4_unicode_ci");
    expect(flat).toContain("FROM he_drive d JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id");
    expect(flat).toContain("FROM he_message hm FORCE INDEX (idx_he_msg_req) WHERE hm.requisition_id IN (?,?) AND hm.created_at >= ? AND hm.created_at < ? AND hm.direction = 'out'");
    expect(flat).toContain("FROM he_lead_event ev JOIN he_message x ON x.id = (SELECT h.id FROM he_message h WHERE h.lead_id = ev.lead_id");
    expect(flat).toContain("WHERE ev.event_type IN ('confirmed','call_confirmed') AND ev.created_at >= ? AND ev.created_at < ? AND x.requisition_id IN (?,?)");
    expect(flat).toContain("JOIN he_lead_event ev ON ev.drive_id = d.id AND ev.event_type = 'arrived'");
    expect(sql.match(/UNION ALL/g)).toHaveLength(4);
  });
  it("form fills are typed per person (first fill decides) and carry the campaign of the person's first fill", () => {
    // the person's first-fill campaign is looked up (by uq_he_lead_mobile) for the window's fills only, not for the previous window's
    expect(sql).toContain(`${fillTypeSql("r", "2026-10-08")} AS source_type, IF(r.created_at >= ?, ${fillFirstCampaignSql("r")}, NULL) COLLATE utf8mb4_unicode_ci AS campaign_id`);
    expect(flat).not.toContain("LEFT JOIN he_lead pl ON");
  });
  it("activity before the cutoff is never Live: every typed part passes its own activity time", () => {
    for (const ref of ["d.drive_date", "x.last_at", "ev.created_at"]) expect(flat).toContain(`THEN IF(${ref} >= TIMESTAMP '2026-10-08 00:00:00' AND`);
  });
  it("a confirmation is credited through the last outbound message that did not fail", () => {
    expect(flat).toContain("AND h.requisition_id IS NOT NULL AND (h.delivery_status IS NULL OR h.delivery_status <> 'failed') AND h.created_at <= ev.created_at");
  });
  it("a walk-in invite is invited, any other sent message is contacted; a failed send is neither", () => {
    expect(flat).toContain("MAX(IF(hm.template_key LIKE 'he_walkin_invite%', 2, 1)) AS stage");
    expect(flat).toContain("(hm.delivery_status IS NULL OR hm.delivery_status <> 'failed')");
  });
  it("current match states keep counting (nothing the buckets counted is lost) and selected / joined use the drive credit rule", () => {
    expect(flat).toContain("WHEN m.state IN ('arrived','selected') THEN 4 WHEN m.state = 'confirmed' THEN 3 WHEN m.state IN ('invited','slot_released','no_show') THEN 2 ELSE 0 END");
    expect(flat).toContain("m.state IN ('arrived','selected') AND"); // he-drive-credit arrival gate
  });
  it("types every person by the shared rule and keeps ONE type and ONE campaign per person and requisition", () => {
    expect(sql).toContain(metaOriginSql("al"));
    expect(flat).toContain("GROUP BY u.cur, u.person, u.requisition_id");
    expect(flat).toContain("SUBSTRING(MIN(CONCAT(FIELD(u.source_type, 'meta_live', 'meta_old', 'he'), u.source_type)), 2) AS source_type");
    expect(flat).toContain("SUM(p.stage >= 2) AS invited, SUM(p.stage >= 3) AS confirmed, SUM(p.stage >= 4) AS arrived");
    expect(flat).toContain("GROUP BY p.cur, p.requisition_id, p.source_type, p.campaign_id");
  });
  it("never scans: each part starts from an index range bounded by requisition ids and the window", () => {
    const own = stripRule(sql);
    for (const m of own.matchAll(/FROM (he_lead_event|he_message|meta_lead_raw|he_lead)\b(\s+\w+)?\s+WHERE\s+(\S+)/g)) {
      expect(["hm.requisition_id", "ev.event_type", "h.lead_id"]).toContain(m[3]);
    }
    expect(own).not.toMatch(/FROM he_lead\b/);
  });
  it("binds ids, window bounds and drive dates in statement order", () => {
    // fills: ids + bounds; line-ups: ids + dates; messages: ids + bounds; confirmations: bounds + ids; arrivals: ids + dates
    // each part: its cur start (fills twice: type and campaign), ids, then bounds or dates
    expect((sql.match(/\?/g) ?? []).length).toBe(5 * 2 + 5 * 2 + 6);
    for (const part of ["(r.created_at >= ?) AS cur", "SELECT (d.drive_date >= ?), al.mobile10", "(hm.created_at >= ?) AS cur", "SELECT (ev.created_at >= ?), al.mobile10"]) expect(flat).toContain(part);
  });
});

describe("aggregatePersons", () => {
  it("adds rows per type and keeps per-campaign rows for Meta types only", () => {
    const out = aggregatePersons([
      row({ source_type: "meta_old", campaign_id: "c1", leads: 10, qualified: 4, contacted: 8, invited: 7, confirmed: 3, arrived: 1, selected: 1 }),
      row({ source_type: "meta_old", campaign_id: null, leads: 2, invited: 2 }),
      row({ requisition_id: "r2", source_type: "meta_live", campaign_id: "c2", leads: 5, contacted: 1 }),
      row({ source_type: "he", leads: 20, invited: 9, confirmed: 2, arrived: 2 }),
      row({ source_type: "weird", leads: 99 }),
    ]);
    expect(out.byType.meta_old).toEqual({ leads: 12, invited: 9, confirmed: 3, arrived: 1 });
    expect(out.byType.meta_live).toEqual({ leads: 5, invited: 0, confirmed: 0, arrived: 0 });
    expect(out.byType.he).toEqual({ leads: 20, invited: 9, confirmed: 2, arrived: 2 });
    expect(out.campaigns).toEqual([
      { campaignId: "c1", requisitionId: "r1", sourceType: "meta_old", leads: 10, qualified: 4, contacted: 8, invited: 7, confirmed: 3, arrived: 1, selected: 1, joined: 0 },
      { campaignId: null, requisitionId: "r1", sourceType: "meta_old", leads: 2, qualified: 0, contacted: 0, invited: 2, confirmed: 0, arrived: 0, selected: 0, joined: 0 },
      { campaignId: "c2", requisitionId: "r2", sourceType: "meta_live", leads: 5, qualified: 0, contacted: 1, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 },
    ]);
  });
});

describe("readPersonStages", () => {
  it("runs one statement per 200 requisitions with the window bounds and dates", async () => {
    execute.mockResolvedValue([[row({ source_type: "he", leads: 3, invited: 1 })]]);
    const out = await readPersonStages(["r1"], W, "2026-10-08");
    expect(out.byType.he.leads).toBe(3);
    expect(execute).toHaveBeenCalledTimes(1);
    const params = execute.mock.calls[0][1] as unknown[];
    const b = ["2026-10-01 00:00:00", "2026-10-15 00:00:00"], d = ["2026-10-01", "2026-10-14"], c = "2026-10-01 00:00:00";
    expect(params).toEqual([c, c, "r1", ...b, "2026-10-01", "r1", ...d, c, "r1", ...b, c, ...b, "r1", "2026-10-01", "r1", ...d]);
  });
  it("reads the previous window in the same statement and splits the rows by cur (campaigns of the window only)", async () => {
    execute.mockResolvedValue([[
      { ...row({ source_type: "meta_old", campaign_id: "c1", leads: 4, invited: 2 }), cur: 1 },
      { ...row({ source_type: "meta_old", campaign_id: null, leads: 9, invited: 5, confirmed: 1 }), cur: 0 },
      { ...row({ source_type: "he", leads: 6 }), cur: 0 },
    ]]);
    const out = await readPersonStages(["r1"], W, "2026-10-08", { from: "2026-09-17", to: "2026-09-30" });
    expect(execute).toHaveBeenCalledTimes(1);
    const params = execute.mock.calls[0][1] as unknown[];
    const b = ["2026-09-17 00:00:00", "2026-10-15 00:00:00"], d = ["2026-09-17", "2026-10-14"], c = "2026-10-01 00:00:00";
    expect(params).toEqual([c, c, "r1", ...b, "2026-10-01", "r1", ...d, c, "r1", ...b, c, ...b, "r1", "2026-10-01", "r1", ...d]);
    expect(out.byType.meta_old).toEqual({ leads: 4, invited: 2, confirmed: 0, arrived: 0 });
    expect(out.previous.meta_old).toEqual({ leads: 9, invited: 5, confirmed: 1, arrived: 0 });
    expect(out.previous.he.leads).toBe(6);
    expect(out.campaigns.map((x) => x.campaignId)).toEqual(["c1"]);
  });
});

describe("campaignProgress branch scope", () => {
  const r = (campaignId: string | null, leads: number) => ({ campaignId, requisitionId: "r1", sourceType: "meta_old" as const, leads, qualified: 0, contacted: 0, invited: leads, confirmed: 0, arrived: 0, selected: 0, joined: 0 });
  const heads = new Map([["r1", { code: "REQ-1", branch: "Pune" }]]);
  beforeEach(() => {
    execute.mockResolvedValue([[
      { id: "c1", campaign_name: "Pune ads", campaign_status: "active", requisition_id: "r1", requisition_code: "REQ-1" },
      { id: "c2", campaign_name: "Delhi ads", campaign_status: "active", requisition_id: "rD", requisition_code: "REQ-D" },
      { id: "c3", campaign_name: "Noida ads", campaign_status: "paused", requisition_id: "rN", requisition_code: "REQ-N" },
    ]]);
  });
  it("a branch-scoped caller never sees another branch's campaign; its people stay counted under one blank row", async () => {
    const out = await campaignProgress([r("c1", 5), r("c2", 3), r("c3", 2)], heads, false);
    expect(out.map((c) => [c.campaignId, c.campaignName, c.campaignStatus, c.campaignRequisitionCode, c.stages.leads])).toEqual([
      ["c1", "Pune ads", "active", "REQ-1", 5], [null, OTHER_BRANCH_CAMPAIGN, null, null, 5],
    ]);
    expect(JSON.stringify(out)).not.toMatch(/Delhi|Noida|REQ-D|REQ-N/);
  });
  it("an org-wide caller sees every campaign", async () => {
    const out = await campaignProgress([r("c1", 5), r("c2", 3)], heads, true);
    expect(out.map((c) => c.campaignName)).toEqual(["Pune ads", "Delhi ads"]);
  });
});
