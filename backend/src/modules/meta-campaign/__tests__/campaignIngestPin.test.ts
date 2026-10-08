/**
 * Pin (WS3 A2/B1, snapshot-first) of the live statements a campaign's requisition link touches: campaign create, the routing-code
 * self-heal (drifted re-point and auto-create), Meta ingest of a qualified lead for a single-requisition campaign (stored requisition,
 * screening, follow-up / notify calls) and the retro-route on re-screen. Taken before the many-requisitions model; with its switch off
 * every statement here must stay the same, and the link-table writes are the only additions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  rows: (_sql: string, _p: unknown[]): unknown[] => [],
  notify: vi.fn(async () => ({ sent: true })),
  enqueue: vi.fn(async () => undefined),
  bridge: vi.fn(async () => undefined),
  detail: null as unknown,
  route: vi.fn(async (): Promise<{ requisitionId: string | null; routedBy: string; candidates: unknown[] }> => ({ requisitionId: null, routedBy: "form", candidates: [] })),
  contacted: false,
}));

vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string, params: unknown[] = []) => {
    h.calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    return [h.rows(sql, params), []];
  };
  return { db: {
    execute: exec, query: exec,
    getConnection: async () => ({ execute: exec, query: exec, beginTransaction: async () => { h.calls.push({ sql: "BEGIN", params: [] }); },
      commit: async () => { h.calls.push({ sql: "COMMIT", params: [] }); }, rollback: async () => { h.calls.push({ sql: "ROLLBACK", params: [] }); }, release: () => undefined }),
  } };
});
vi.mock("../meta-api.client.js", () => ({
  fetchLeadDetail: vi.fn(async () => h.detail), fetchCampaignInsights: vi.fn(), fetchFormLeads: vi.fn(), fetchPageLeadForms: vi.fn(),
  isMetaConfigured: () => true, MetaApiError: class extends Error {},
}));
vi.mock("../lead-outreach.service.js", () => ({ notifyQualifiedLead: h.notify }));
vi.mock("../campaign-screening.js", () => ({ loadCampaignScreeningConfig: vi.fn(async () => null) }));
vi.mock("../../hiring-engine/he-campaign-config.service.js", () => ({ heOwnsCampaign: vi.fn(async () => false) }));
vi.mock("../../hiring-engine/he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: h.bridge }));
vi.mock("../../hiring-engine/qualified-followup.service.js", () => ({ enqueueMetaLeadFollowup: h.enqueue }));
// The ingest enrols through the one Live Meta arrival path (final integration); it hands over to the enrolment above.
vi.mock("../../selection/meta-arrival.service.js", () => ({ enrolMetaArrival: (id: string, o: unknown) => h.enqueue(id, o) }));
vi.mock("../../hiring-engine/qualified-followup.schedule.js", () => ({ followupMode: () => "off" }));
vi.mock("../lead-routing.service.js", async (orig) => ({ ...(await orig<typeof import("../lead-routing.service.js")>()), routeLeadRequisition: h.route }));
vi.mock("../lead-contact-lock.js", async (orig) => ({ ...(await orig<typeof import("../lead-contact-lock.js")>()), leadContacted: vi.fn(async () => h.contacted) }));

import { metaCampaignService } from "../meta-campaign.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The many-requisitions model only ADDS link-table statements: they are listed apart, everything else must equal the pin.
const LINK = /meta_campaign_requisition/;
const linkSqls = () => h.calls.filter((c) => LINK.test(c.sql)).map((c) => c.sql);
const shot = () => h.calls.filter((c) => !LINK.test(c.sql)).map((c) => ({ sql: c.sql, params: c.params.map((p) => (typeof p === "string" && UUID.test(p) && !p.startsWith("0000") ? "<uuid>" : p)) }));
const REQ = "00000000-0000-4000-8000-0000000000r1".replace("r1", "a1");
const REQ2 = "00000000-0000-4000-8000-0000000000b2";
const CAMP = "00000000-0000-4000-8000-0000000000c1";
const reqCols = { meta_target_age_min: null, meta_target_age_max: null, education_requirement: null, experience_min_years: null, experience_max_years: null,
  designation_name: "CSA", branch_name: "NOIDA-2", process_name: "Onfido", meta_screening_config: JSON.stringify({ auto_notify: true }) };
const detail = (extra: Array<{ name: string; values: string[] }> = []) => ({
  id: "lead-1", created_time: "2026-10-09T05:00:00+0000",
  field_data: [{ name: "full_name", values: ["Rig Person"] }, { name: "phone_number", values: ["+919999900111"] }, ...extra],
});

beforeEach(() => {
  h.calls = []; vi.clearAllMocks();
  h.rows = () => [];
  h.contacted = false;
  delete process.env.META_MULTI_REQ_ROUTING;
});

describe("campaign link pin (before many requisitions)", () => {
  it("createCampaign", async () => {
    h.rows = (sql) => (/FROM job_requisition WHERE id = \?/.test(sql) ? [{ id: REQ }] : /WHERE mc\.id = \?/.test(sql) ? [{ id: CAMP, requisition_id: REQ, campaign_name: "C" }] : []);
    await metaCampaignService.createCampaign({ requisitionId: REQ, campaignName: "C", metaFormId: "123" } as never, "u1");
    expect(shot()).toMatchSnapshot();
    expect(linkSqls()[0]).toMatch(/^INSERT INTO meta_campaign_requisition/);
  });

  it("routing-code self-heal re-points a drifted campaign", async () => {
    h.rows = (sql) => (/FROM job_requisition WHERE UPPER/.test(sql) ? [{ id: REQ2, requisition_code: "REQ-B2" }]
      : /SELECT id, requisition_id FROM meta_campaign WHERE meta_form_id/.test(sql) ? [{ id: CAMP, requisition_id: REQ }]
        : /FROM meta_campaign mc/.test(sql) ? [{ id: CAMP, requisition_id: REQ2, ...reqCols }] : []);
    await metaCampaignService.resolveCampaignByRoutingCode("form-1", "REQ-B2");
    expect(shot()).toMatchSnapshot();
    expect(linkSqls()).toHaveLength(2); // primary upsert + demote the drifted link
  });

  it("routing-code self-heal auto-creates a campaign for an unknown form", async () => {
    h.rows = (sql) => (/FROM job_requisition WHERE UPPER/.test(sql) ? [{ id: REQ2, requisition_code: "REQ-B2" }]
      : /FROM meta_campaign mc/.test(sql) ? [{ id: CAMP, requisition_id: REQ2, ...reqCols }] : []);
    await metaCampaignService.resolveCampaignByRoutingCode("form-9", "REQ-B2");
    expect(shot()).toMatchSnapshot();
    expect(linkSqls()).toHaveLength(2);
  });

  it("ingest of a qualified lead for a single-requisition campaign", async () => {
    h.detail = detail();
    h.rows = (sql) => (/FROM meta_campaign mc/.test(sql) ? [{ id: CAMP, requisition_id: REQ, ...reqCols }]
      : /SELECT \* FROM meta_lead_raw WHERE id = \?/.test(sql) ? [{ id: "x", requisition_id: REQ, screening_result: "qualified" }] : []);
    vi.spyOn(metaCampaignService, "createCandidateFromLead").mockResolvedValue("cand" as never);
    await metaCampaignService.ingestLead({ formId: "form-1", leadgenId: "lead-1" });
    expect(shot()).toMatchSnapshot();
    expect(linkSqls()).toHaveLength(0);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.route).not.toHaveBeenCalled();
  });

  it("re-screen retro-routes by the routing code", async () => {
    const raw = detail([{ name: "requisition_code", values: ["REQ-B2"] }]);
    h.rows = (sql) => (/SELECT \* FROM meta_lead_raw WHERE id = \?/.test(sql) ? [{ id: "lead-x", meta_form_id: "form-1", requisition_id: REQ, raw_payload: JSON.stringify(raw) }]
      : /FROM job_requisition WHERE UPPER/.test(sql) ? [{ id: REQ2, requisition_code: "REQ-B2" }]
        : /SELECT id, requisition_id FROM meta_campaign WHERE meta_form_id/.test(sql) ? [{ id: CAMP, requisition_id: REQ2 }]
          : /FROM meta_campaign mc/.test(sql) ? [{ id: CAMP, requisition_id: REQ2, ...reqCols }]
            : /FROM job_requisition WHERE id = \?/.test(sql) ? [reqCols] : []);
    await metaCampaignService.rescreenLead("lead-x", { createCandidate: false });
    expect(shot()).toMatchSnapshot();
  });
});

describe("best-fit routing at ingest (B1, META_MULTI_REQ_ROUTING on)", () => {
  const ingestRows = (sql: string) => (/FROM meta_campaign mc/.test(sql) ? [{ id: CAMP, requisition_id: REQ, ...reqCols }]
    : /FROM job_requisition WHERE id = \? LIMIT 1/.test(sql) && /AS requisition_id/.test(sql) ? [{ requisition_id: REQ2, ...reqCols, designation_name: "Day CSA" }]
      : /SELECT \* FROM meta_lead_raw WHERE id = \?/.test(sql) ? [{ id: "x", screening_result: "qualified" }] : []);
  const insertParams = () => h.calls.find((c) => c.sql.startsWith("INSERT INTO meta_lead_raw"))!.params;

  it("routes to the best-fit requisition, screens against it and records how", async () => {
    process.env.META_MULTI_REQ_ROUTING = CAMP;
    h.detail = detail();
    h.rows = ingestRows;
    h.route.mockResolvedValueOnce({ requisitionId: REQ2, routedBy: "best_fit", candidates: [] });
    vi.spyOn(metaCampaignService, "createCandidateFromLead").mockResolvedValue("cand" as never);
    await metaCampaignService.ingestLead({ formId: "form-1", leadgenId: "lead-1" });
    expect(h.route).toHaveBeenCalledWith(expect.objectContaining({ campaignId: CAMP, primaryRequisitionId: REQ }));
    expect(insertParams()[4]).toBe(REQ2);
    const rec = h.calls.find((c) => c.sql.startsWith("UPDATE meta_lead_raw SET routed_by = ?"))!;
    expect(rec.params[0]).toBe("best_fit");
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("nothing fits: stays on the primary, held for HR, no follow-up and no notify", async () => {
    process.env.META_MULTI_REQ_ROUTING = "all";
    h.detail = detail();
    h.rows = ingestRows;
    h.route.mockResolvedValueOnce({ requisitionId: REQ, routedBy: "hold", candidates: [] });
    vi.spyOn(metaCampaignService, "createCandidateFromLead").mockResolvedValue("cand" as never);
    await metaCampaignService.ingestLead({ formId: "form-1", leadgenId: "lead-1" });
    expect(insertParams()[4]).toBe(REQ);
    expect(h.calls.find((c) => c.sql.startsWith("UPDATE meta_lead_raw SET routed_by = ?"))!.params[0]).toBe("hold");
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("a routing code on the form still wins: no best-fit evaluation", async () => {
    process.env.META_MULTI_REQ_ROUTING = "all";
    h.detail = detail([{ name: "requisition_code", values: ["REQ-B2"] }]);
    h.rows = (sql) => (/FROM job_requisition WHERE UPPER/.test(sql) ? [{ id: REQ2, requisition_code: "REQ-B2" }]
      : /SELECT id, requisition_id FROM meta_campaign WHERE meta_form_id/.test(sql) ? [{ id: CAMP, requisition_id: REQ2 }] : ingestRows(sql));
    vi.spyOn(metaCampaignService, "createCandidateFromLead").mockResolvedValue("cand" as never);
    await metaCampaignService.ingestLead({ formId: "form-1", leadgenId: "lead-1" });
    expect(h.route).not.toHaveBeenCalled();
  });

  it("a routing failure never breaks ingest: the lead is stored on the primary", async () => {
    process.env.META_MULTI_REQ_ROUTING = "all";
    h.detail = detail();
    h.rows = ingestRows;
    h.route.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(metaCampaignService, "createCandidateFromLead").mockResolvedValue("cand" as never);
    await metaCampaignService.ingestLead({ formId: "form-1", leadgenId: "lead-1" });
    expect(insertParams()[4]).toBe(REQ);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});

describe("retro-route respects the contacted lock and HR placement (review focus 2)", () => {
  const raw = detail([{ name: "requisition_code", values: ["REQ-B2"] }]);
  const rows = (lead: Record<string, unknown>) => (sql: string) => (/SELECT \* FROM meta_lead_raw WHERE id = \?/.test(sql) ? [{ id: "lead-x", meta_form_id: "form-1", requisition_id: REQ, raw_payload: JSON.stringify(raw), ...lead }]
    : /FROM job_requisition WHERE UPPER/.test(sql) ? [{ id: REQ2, requisition_code: "REQ-B2" }]
      : /SELECT id, requisition_id FROM meta_campaign WHERE meta_form_id/.test(sql) ? [{ id: CAMP, requisition_id: REQ2 }]
        : /FROM meta_campaign mc/.test(sql) ? [{ id: CAMP, requisition_id: REQ2, ...reqCols }]
          : /FROM job_requisition WHERE id = \?/.test(sql) ? [reqCols] : []);
  const moved = () => h.calls.some((c) => c.sql.startsWith("UPDATE meta_lead_raw SET campaign_id = ?, requisition_id = ?"));

  it("a contacted lead is not moved", async () => {
    h.rows = rows({});
    h.contacted = true;
    await metaCampaignService.rescreenLead("lead-x", { createCandidate: false });
    expect(moved()).toBe(false);
  });

  it("a lead HR placed is not moved", async () => {
    h.rows = rows({ routed_by: "hr" });
    await metaCampaignService.rescreenLead("lead-x", { createCandidate: false });
    expect(moved()).toBe(false);
  });
});
