import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { OTHER_BRANCH_CAMPAIGN, aggregatePersons, campaignProgress, personType, personsSql, readPersonStages, typePersonRows } from "../he-drive-persons.service.js";
import { attributeSource, fillFirstCampaignSql, fillTypeSql, metaOriginSql } from "../he-source-attribution.js";
import { PersonFacts, typeKeyColsSql } from "../he-person-facts.service.js";
import { stripRule } from "./attributionSql.js";

const W = { from: "2026-10-01", to: "2026-10-14" };
const row = (o: Record<string, unknown>) => ({ requisition_id: "r1", source_type: "he", campaign_id: null, leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });

beforeEach(() => { vi.clearAllMocks(); });

describe("personsSql (events-based stages, one row per person and requisition)", () => {
  const sql = personsSql(2, true, "2026-10-08");
  const flat = sql.replace(/\s+/g, " ");
  it("unions form fills, drive line-ups, sent messages, confirmation events and arrival events", () => {
    // form fills by import time (idx_ml_created, forced), each with its campaign by primary key
    expect(flat).toContain("FROM meta_lead_raw r FORCE INDEX (idx_ml_created) STRAIGHT_JOIN meta_campaign mc ON mc.id = r.campaign_id COLLATE utf8mb4_unicode_ci");
    expect(flat).toContain("FROM he_drive d JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id");
    expect(flat).toContain("FROM he_message hm FORCE INDEX (idx_he_msg_req) WHERE hm.requisition_id IN (?,?) AND hm.created_at >= ? AND hm.created_at < ? AND hm.direction = 'out'");
    expect(flat).toContain("FROM he_lead_event ev JOIN he_message x ON x.id = (SELECT h.id FROM he_message h WHERE h.lead_id = ev.lead_id");
    expect(flat).toContain("WHERE ev.event_type IN ('confirmed','call_confirmed') AND ev.created_at >= ? AND ev.created_at < ? AND x.requisition_id IN (?,?)");
    expect(flat).toContain("JOIN he_lead_event ev ON ev.drive_id = d.id AND ev.event_type = 'arrived'");
    expect(sql.match(/UNION ALL/g)).toHaveLength(4);
  });
  it("form fills are typed per person (first fill decides) and carry the campaign of the person's first fill", () => {
    // the person's first-fill campaign is looked up (by uq_he_lead_mobile) for the window's fills only, not for the previous window's
    expect(sql).toContain(`FIELD(${fillTypeSql("r", "2026-10-08")}, 'meta_live', 'meta_old', 'he') AS ft, NULL AS tl, 0 AS tm, 0 AS tr,
               IF(r.created_at >= ?, ${fillFirstCampaignSql("r")}, NULL) COLLATE utf8mb4_unicode_ci AS campaign_id`);
    expect(flat).not.toContain("LEFT JOIN he_lead pl ON");
  });
  it("activity before the cutoff is never Live: every other part returns its person signals with its own activity time", () => {
    for (const [leadId, ref] of [["m.lead_id", "d.drive_date"], ["x.lead_id", "x.last_at"], ["ev.lead_id", "ev.created_at"], ["ev.lead_id", "d.drive_date"]]) {
      expect(sql).toContain(typeKeyColsSql({ streams: true, d: "d", leadId, ref, liveFrom: "2026-10-08" }));
    }
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
  it("returns one row per person and requisition with the signals to type them once (no person lookups in the statement)", () => {
    expect(sql).not.toContain(metaOriginSql("al")); // the person facts are read once per build (he-person-facts.service.ts)
    expect(flat).toContain("GROUP BY u.cur, u.person, u.requisition_id");
    expect(flat).toContain("MIN(u.ft) AS frank, MAX(u.tl) AS tl, MAX(u.ft IS NULL) AS lead_rows, MAX(u.ft IS NULL AND u.tm) AS any_m, MAX(u.ft IS NULL AND u.tr) AS any_r, MAX(u.ft IS NULL AND u.tm AND u.tr) AS any_mr");
    // the mobile groups people inside the statement and never leaves it
    expect(flat.startsWith("SELECT p.cur, p.requisition_id, p.tl, p.frank, p.lead_rows, p.any_m, p.any_r, p.any_mr, p.campaign_id, p.stage, p.q, p.sel, p.joi, p.fill, p.scr, (p.stage = 2 AND EXISTS")).toBe(true);
  });
  it("never scans: each part starts from an index range bounded by requisition ids and the window", () => {
    const own = stripRule(sql);
    for (const m of own.matchAll(/FROM (he_lead_event|he_message|meta_lead_raw|he_lead)\b(\s+\w+)?\s+WHERE\s+(\S+)/g)) {
      expect(["hm.requisition_id", "ev.event_type", "h.lead_id", "hr.lead_id"]).toContain(m[3]);
    }
    expect(own).not.toMatch(/FROM he_lead\b/);
  });
  it("binds ids, window bounds and drive dates in statement order", () => {
    // reply bounds (outer select); fills: ids + bounds; line-ups: ids + dates; messages: ids + bounds; confirmations: bounds + ids; arrivals: ids + dates
    // each part: its cur start (fills twice: type and campaign), ids, then bounds or dates
    expect((sql.match(/\?/g) ?? []).length).toBe(2 + 5 * 2 + 5 * 2 + 6);
    expect((personsSql(2, true, "2026-10-08", false).match(/\?/g) ?? []).length).toBe(5 * 2 + 5 * 2 + 6);
    for (const part of ["(r.created_at >= ?) AS cur", "SELECT (d.drive_date >= ?), al.mobile10", "(hm.created_at >= ?) AS cur", "SELECT (ev.created_at >= ?), al.mobile10"]) expect(flat).toContain(part);
  });
  it("a form fill carries the old Meta outreach on its own row: a notification is contact, an interview slot is a slot given (no extra read)", () => {
    expect(flat).toContain("CASE WHEN r.interview_date IS NOT NULL THEN 2 WHEN r.notification_sent_at IS NOT NULL THEN 1 ELSE 0 END AS stage");
  });
  it("counts form fills in the window, screened fills and people who replied after an invite (a confirmation counts as a reply)", () => {
    expect(flat).toContain("(r.screening_result IN ('qualified','disqualified')) AS scr");
    expect(flat).toContain("MAX(u.ft IS NOT NULL) AS fill, MAX(u.scr) AS scr");
    // one keyed lookup per person, and only for people invited but not confirmed (a confirmation already counts as a reply)
    expect(flat).toContain("(p.stage = 2 AND EXISTS (SELECT 1 FROM he_message hr WHERE hr.lead_id = p.tl AND hr.direction = 'in' AND hr.created_at >= ? AND hr.created_at < ?)) AS rep");
    expect(personsSql(2, true, "2026-10-08", false).replace(/\s+/g, " ")).toContain("p.fill, p.scr, 0 AS rep");
  });
});

describe("personType: the person rule over a person's signals, as typing each row and keeping the most-Meta one", () => {
  const LIVE = "2026-10-08 10:00:00", OLD = "2026-09-20 10:00:00";
  const people = { live: { metaOrigin: true, first: LIVE }, old: { metaOrigin: true, first: OLD }, pool: { metaOrigin: false, first: null } } as const;
  it("matches attributeSource row by row for every combination of two rows and every person", async () => {
    execute.mockResolvedValue([[{ id: "live", pm: 1, fl: 1 }, { id: "old", pm: 1, fl: 0 }, { id: "pool", pm: 0, fl: 0 }]]);
    const f = new PersonFacts("2026-10-08");
    await f.load(Object.keys(people));
    const combos = [[0, 0], [0, 1], [1, 0], [1, 1]];
    for (const [tl, p] of Object.entries(people)) for (const a of combos) for (const b of combos) for (const frank of [null, 1, 2]) {
      const rows = [a, b].map(([tm, tr]) => attributeSource({ metaOrigin: p.metaOrigin, driveSourceKind: tm ? "meta" : "pool", firstFillAt: p.first, activityAt: tr ? "2026-10-09" : "2026-10-01" }));
      const rank = Math.min(...rows.map((t) => ["meta_live", "meta_old", "he"].indexOf(t) + 1), frank ?? 3);
      const signals = { tl, frank, lead_rows: 1, any_m: Number(a[0] || b[0]), any_r: Number(a[1] || b[1]), any_mr: Number((a[0] && a[1]) || (b[0] && b[1])) };
      expect(personType(signals, f)).toBe(["meta_live", "meta_old", "he"][rank - 1]);
    }
    // a person with form fills only (no other rows) is the fills' type
    expect(personType({ tl: null, frank: 2, lead_rows: 0 }, f)).toBe("meta_old");
  });
  it("counts people per requisition, type and campaign from the per-person rows", async () => {
    execute.mockResolvedValue([[{ id: "old", pm: 1, fl: 0 }]]);
    const f = new PersonFacts("2026-10-08");
    await f.load(["old"]);
    const p = (o: Record<string, unknown>) => ({ cur: 1, requisition_id: "r1", tl: "old", frank: null, lead_rows: 1, any_m: 0, any_r: 0, any_mr: 0, campaign_id: "c1", stage: 0, q: 0, sel: 0, joi: 0, ...o });
    const out = typePersonRows([p({ stage: 3, q: 1 }), p({ stage: 2, rep: 1 }), p({ tl: null, lead_rows: 0, frank: 1, campaign_id: "c2", fill: 1, scr: 1 }), p({ tl: "x", campaign_id: null, stage: 4, sel: 1 })] as never, f);
    expect(out).toEqual([
      { cur: 1, requisition_id: "r1", source_type: "meta_old", campaign_id: "c1", leads: 2, fills: 0, screened: 0, qualified: 1, contacted: 2, invited: 2, replied: 2, confirmed: 1, arrived: 0, selected: 0, joined: 0 },
      { cur: 1, requisition_id: "r1", source_type: "meta_live", campaign_id: "c2", leads: 1, fills: 1, screened: 1, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 },
      { cur: 1, requisition_id: "r1", source_type: "he", campaign_id: null, leads: 1, fills: 0, screened: 0, qualified: 0, contacted: 1, invited: 1, replied: 1, confirmed: 1, arrived: 1, selected: 1, joined: 0 },
    ]);
  });
});

describe("funnel per campaign x requisition x drive (WS3 C3)", () => {
  it("a Meta fill counts under the requisition it was routed to (the campaign's primary only when the fill has none)", () => {
    const flat = personsSql(2, true, "2026-10-08").replace(/\s+/g, " ");
    expect(flat).toContain("COALESCE(r.requisition_id, mc.requisition_id) COLLATE utf8mb4_unicode_ci AS requisition_id");
    expect(flat).toContain("WHERE COALESCE(r.requisition_id, mc.requisition_id) IN (?,?) AND r.parsed_phone IS NOT NULL");
    expect(flat).not.toContain("(r.requisition_id IS NULL OR r.requisition_id = mc.requisition_id)");
  });

  it("requisition rows: every type per requisition from the same person rows; their sums equal the journey per type", () => {
    const out = aggregatePersons([
      row({ source_type: "meta_old", campaign_id: "c1", leads: 10, contacted: 8 }),
      row({ source_type: "meta_old", campaign_id: "c2", leads: 2, contacted: 1 }),
      row({ requisition_id: "r2", source_type: "meta_live", campaign_id: "c2", leads: 5, contacted: 1 }),
      row({ source_type: "he", leads: 20, invited: 9 }),
      row({ requisition_id: "r2", source_type: "he", leads: 3, invited: 1 }),
    ]);
    const z = { fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
    expect(out.requisitions).toEqual([
      { requisitionId: "r2", sourceType: "meta_live", stages: { ...z, leads: 5, contacted: 1 } },
      { requisitionId: "r1", sourceType: "meta_old", stages: { ...z, leads: 12, contacted: 9 } },
      { requisitionId: "r1", sourceType: "he", stages: { ...z, leads: 20, invited: 9 } },
      { requisitionId: "r2", sourceType: "he", stages: { ...z, leads: 3, invited: 1 } },
    ]);
    for (const t of ["meta_live", "meta_old", "he"] as const) {
      const sum = out.requisitions.filter((x) => x.sourceType === t).reduce((a, x) => a + x.stages.leads, 0);
      expect(sum).toBe(out.byType[t].leads);
    }
    // a Hiring Engine person never shows in a campaign row, a Meta person never in an he row
    expect(out.campaigns.every((c) => c.sourceType !== ("he" as never))).toBe(true);
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
    expect(out.byType.meta_old).toEqual({ leads: 12, fills: 0, screened: 0, qualified: 4, contacted: 8, invited: 9, replied: 0, confirmed: 3, arrived: 1 });
    expect(out.byType.meta_live).toEqual({ leads: 5, fills: 0, screened: 0, qualified: 0, contacted: 1, invited: 0, replied: 0, confirmed: 0, arrived: 0 });
    expect(out.byType.he).toEqual({ leads: 20, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 9, replied: 0, confirmed: 2, arrived: 2 });
    const c = (o: Record<string, unknown>) => ({ fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
    expect(out.campaigns).toEqual([
      c({ campaignId: "c1", requisitionId: "r1", sourceType: "meta_old", leads: 10, qualified: 4, contacted: 8, invited: 7, confirmed: 3, arrived: 1, selected: 1 }),
      c({ campaignId: null, requisitionId: "r1", sourceType: "meta_old", leads: 2, invited: 2 }),
      c({ campaignId: "c2", requisitionId: "r2", sourceType: "meta_live", leads: 5, contacted: 1 }),
    ]);
  });
  it("carries form fills, screened and replied per type and per campaign", () => {
    const out = aggregatePersons([
      row({ source_type: "meta_live", campaign_id: "c1", leads: 9, fills: 8, screened: 7, qualified: 5, contacted: 4, invited: 3, replied: 2, confirmed: 1 }),
      row({ source_type: "he", leads: 4, contacted: 4, invited: 3, replied: 1 }),
    ]);
    expect(out.byType.meta_live).toMatchObject({ fills: 8, screened: 7, qualified: 5, contacted: 4, replied: 2 });
    expect(out.byType.he).toMatchObject({ fills: 0, contacted: 4, replied: 1 });
    expect(out.campaigns[0]).toMatchObject({ fills: 8, screened: 7, replied: 2 });
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
    expect(params).toEqual([...b, c, c, "r1", ...b, "2026-10-01", "r1", ...d, c, "r1", ...b, c, ...b, "r1", "2026-10-01", "r1", ...d]);
  });
  it("reads the previous window with the same statement side by side (its rows have cur = 0) and keeps the window's campaigns only", async () => {
    execute.mockImplementation(async (_sql: string, p: unknown[]) => (p.includes("2026-09-17 00:00:00")
      ? [[{ ...row({ source_type: "meta_old", campaign_id: null, leads: 9, invited: 5, confirmed: 1 }), cur: 0 }, { ...row({ source_type: "he", leads: 6 }), cur: 0 }]]
      : [[{ ...row({ source_type: "meta_old", campaign_id: "c1", leads: 4, invited: 2 }), cur: 1 }]]));
    const out = await readPersonStages(["r1"], W, "2026-10-08", { from: "2026-09-17", to: "2026-09-30" });
    expect(execute).toHaveBeenCalledTimes(2);
    const c = "2026-10-01 00:00:00";
    const paramsOf = (b: string[], d: string[]) => [c, c, "r1", ...b, "2026-10-01", "r1", ...d, c, "r1", ...b, c, ...b, "r1", "2026-10-01", "r1", ...d];
    const wb = ["2026-10-01 00:00:00", "2026-10-15 00:00:00"];
    expect(execute.mock.calls.map((x) => x[1])).toEqual([
      [...wb, ...paramsOf(wb, ["2026-10-01", "2026-10-14"])], // reply bounds first: the window only
      paramsOf(["2026-09-17 00:00:00", "2026-10-01 00:00:00"], ["2026-09-17", "2026-09-30"]), // ends where the window starts: every cur is 0
    ]);
    expect(String(execute.mock.calls[1][0])).not.toContain("hr.lead_id"); // the previous window needs no replies
    const st = (o: Record<string, number>) => ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, ...o });
    expect(out.byType.meta_old).toEqual(st({ leads: 4, invited: 2 }));
    expect(out.previous.meta_old).toEqual(st({ leads: 9, invited: 5, confirmed: 1 }));
    expect(out.previous.he.leads).toBe(6);
    expect(out.campaigns.map((x) => x.campaignId)).toEqual(["c1"]);
  });
});

describe("campaignProgress branch scope", () => {
  const r = (campaignId: string | null, leads: number) => ({ campaignId, requisitionId: "r1", sourceType: "meta_old" as const, leads, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: leads, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 });
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

describe("campaignProgress statement (pinned)", () => {
  it("reads campaign names, status and the campaign's own requisition by key", async () => {
    execute.mockResolvedValue([[]]);
    await campaignProgress([{ campaignId: "c1", requisitionId: "r1", sourceType: "meta_live", leads: 1, fills: 1, screened: 1, qualified: 1, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 }],
      new Map([["r1", { code: "REQ-1", branch: "Pune" }]]));
    expect(execute.mock.calls.map((c) => [String(c[0]).replace(/\s+/g, " ").trim(), c[1]])).toMatchSnapshot();
  });
});

describe("campaignProgress blockers (why qualified leads may stall)", () => {
  const base = { campaignId: "c1", requisitionId: "r1", sourceType: "meta_live" as const, leads: 5, fills: 5, screened: 5, qualified: 4, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
  const info = (o: Record<string, unknown>) => ({ id: "c1", campaign_name: "K7BK", campaign_status: "active", meta_form_id: "f1", requisition_id: "r1", requisition_code: "REQ-1", approval_status: "approved",
    active_status: 1, closed_at: null, requested_headcount: 20, fulfilled_headcount: 2, has_bmi: 1, ...o });
  const run = async (o: Record<string, unknown>) => {
    execute.mockResolvedValue([[info(o)]]);
    return (await campaignProgress([base], new Map([["r1", { code: "REQ-1", branch: "Pune" }]])))[0].blockers;
  };
  it("reads the campaign's form, status and requisition state by key in the same statement", async () => {
    await run({});
    const sql = String(execute.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(sql).toContain("mc.meta_form_id");
    expect(sql).toContain("jr.approval_status, jr.active_status, jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount, jr.bmi_assessment_url IS NOT NULL AND jr.bmi_assessment_url <> '' AS has_bmi");
    expect(sql).toContain("WHERE mc.id IN (?)");
  });
  it("an open, linked, ready campaign has no blockers", async () => { expect(await run({})).toEqual([]); });
  it("names a closed requisition with the outreach path's own reason", async () => {
    expect(await run({ closed_at: "2026-09-26 10:57:00" })).toEqual([{ code: "requisition_closed", text: "REQ-1: requisition is closed, so outreach refuses its leads" }]);
    expect(await run({ fulfilled_headcount: 20 })).toEqual([{ code: "requisition_closed", text: "REQ-1: all seats in this batch are filled, so outreach refuses its leads" }]);
  });
  it("names a missing requisition, BMI link, form and a campaign that is not active", async () => {
    expect((await run({ requisition_code: null, approval_status: null, active_status: null, requested_headcount: null, fulfilled_headcount: null })).map((b) => b.code)).toEqual(["no_requisition"]);
    expect((await run({ has_bmi: 0 })).map((b) => b.code)).toEqual(["no_bmi_link"]);
    expect((await run({ meta_form_id: "" })).map((b) => b.code)).toEqual(["no_form"]);
    expect((await run({ campaign_status: "paused" })).map((b) => b.code)).toEqual(["campaign_not_active"]);
  });
  it("a row with no campaign has no blockers (nothing to read)", async () => {
    execute.mockResolvedValue([[]]);
    const out = await campaignProgress([{ ...base, campaignId: null }], new Map());
    expect(out[0].blockers).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
  it("a campaign of another branch hidden from a branch-scoped caller shows no blockers", async () => {
    execute.mockResolvedValue([[info({ requisition_id: "rD", closed_at: "2026-09-26 10:57:00" })]]);
    const out = await campaignProgress([base], new Map([["r1", { code: "REQ-1", branch: "Pune" }]]), false);
    expect(out[0].blockers).toEqual([]);
  });
});
