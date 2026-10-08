import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  links: [] as Array<Record<string, unknown>>,
  critRows: [] as Array<Record<string, unknown>>,
  lead: null as Record<string, unknown> | null,
  contacted: false,
  rescreen: vi.fn(async () => null),
}));
vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    h.sqls.push({ sql: s, p });
    if (s.includes("FROM job_requisition jr LEFT JOIN branch_master")) return [h.critRows.filter((r) => p.includes(r.id)), []];
    if (s.startsWith("SELECT id, campaign_id, requisition_id, parsed_phone, routed_by FROM meta_lead_raw")) return [h.lead ? [h.lead] : [], []];
    if (s.startsWith("SELECT TABLE_NAME AS t")) return [[{ t: "qualified_followup" }], []];
    if (s.includes(" AS c FROM meta_lead_raw r")) return [[{ c: h.contacted ? 1 : 0 }], []];
    if (s.startsWith("SELECT COALESCE(routed_by, 'legacy') AS k")) return [[{ k: "legacy", n: 4 }, { k: "hold", n: 1 }], []];
    if (s.startsWith("SELECT id, parsed_name, parsed_phone")) return [[{ id: "l9", parsed_name: "Rig Person Two", parsed_phone: "+91 99999 00333", requisition_id: "night", created_at: "2026-10-09 10:00:00" }], []];
    return [{ affectedRows: 1 }, []];
  };
  return { db: { execute: exec } };
});
vi.mock("../campaign-requisition.service.js", () => ({ listCampaignRequisitions: vi.fn(async () => h.links), linkedRequisitionIds: vi.fn(async () => h.links.map((l) => l.requisitionId)) }));

import { campaignRoutingSummary, multiReqRoutingOn, overrideLeadRequisition, routeLeadRequisition } from "../lead-routing.service.js";
import { resetOptionalTables } from "../lead-contact-lock.js";

const NOW = new Date("2026-10-09T06:00:00Z");
const link = (requisitionId: string, o: Record<string, unknown> = {}) => ({ campaignId: "c1", requisitionId, code: requisitionId, branch: "NOIDA-2", isPrimary: false, sortOrder: 0,
  openReason: null, endDate: "2026-12-31", endDatePassed: false, endedReason: null, seatsLeft: 10, bmiLinkPresent: true, criteria: null, ...o });
const crit = (id: string, o: Record<string, unknown> = {}) => ({ id, requisition_code: id, branch_name: "NOIDA-2", process_name: "Onfido", designation_name: "CSA", education_requirement: null,
  skills_required: null, experience_min_years: null, experience_max_years: null, meta_target_age_min: null, meta_target_age_max: null, meta_target_locations: null, meta_target_radius_km: null,
  shift_requirement: null, night_shift_required: 0, rotational_shift: 0, salary_min: null, salary_max: null, preferred_sources: null, meta_screening_config: null, selection_rules: null,
  approval_status: "approved", bcity: "Noida", bstate: "Uttar Pradesh", blat: null, blng: null, ...o });
const NIGHT = JSON.stringify({ custom_field_rules: [{ field: "are_you_ok_with_night_shift", op: "is_yes", value: "", label: "Night shift" }] });
const lead = (night: string | null) => ({ rawPayload: { field_data: [{ name: "full_name", values: ["Rig P"] }, { name: "phone_number", values: ["9999900222"] },
  ...(night ? [{ name: "are_you_ok_with_night_shift?", values: [night] }] : [])] }, education: null, location: "Noida", experienceYears: null, phone: "9999900222" });

beforeEach(() => {
  h.sqls = []; resetOptionalTables(); h.contacted = false; h.rescreen.mockClear();
  h.links = [link("night", { isPrimary: true }), link("day")];
  h.critRows = [crit("night", { meta_screening_config: NIGHT, night_shift_required: 1 }), crit("day")];
});

describe("multi-requisition routing switch (env; off = no added statement)", () => {
  it("is off unless META_MULTI_REQ_ROUTING names the campaign or says all", () => {
    expect(multiReqRoutingOn("c1", {})).toBe(false);
    expect(multiReqRoutingOn("c1", { META_MULTI_REQ_ROUTING: "off" })).toBe(false);
    expect(multiReqRoutingOn("c1", { META_MULTI_REQ_ROUTING: "all" })).toBe(true);
    expect(multiReqRoutingOn("c1", { META_MULTI_REQ_ROUTING: "c9, c1" })).toBe(true);
    expect(multiReqRoutingOn("c2", { META_MULTI_REQ_ROUTING: "c9,c1" })).toBe(false);
  });
});

describe("routeLeadRequisition (B1: best fit by the engine)", () => {
  it("a lead who said no to night shift goes to the day requisition (best_fit)", async () => {
    const r = await routeLeadRequisition({ campaignId: "c1", primaryRequisitionId: "night", lead: lead("No"), now: NOW });
    expect(r.requisitionId).toBe("day");
    expect(r.routedBy).toBe("best_fit");
    expect(r.candidates.find((c) => c.requisitionId === "night")!.verdict).toBe("fail");
  });

  it("a yes stays on the primary when both pass (input order breaks the tie)", async () => {
    const r = await routeLeadRequisition({ campaignId: "c1", primaryRequisitionId: "night", lead: lead("Yes"), now: NOW });
    expect(r.requisitionId).toBe("night");
    expect(r.routedBy).toBe("best_fit");
  });

  it("nothing fits: held for HR on the primary", async () => {
    h.critRows = [crit("night", { meta_screening_config: NIGHT }), crit("day", { meta_screening_config: NIGHT })];
    const r = await routeLeadRequisition({ campaignId: "c1", primaryRequisitionId: "night", lead: lead("No"), now: NOW });
    expect(r).toMatchObject({ requisitionId: "night", routedBy: "hold" });
  });

  it("fewer than two open links: the primary, no evaluation (closed and ended links do not count)", async () => {
    h.links = [link("night", { isPrimary: true }), link("day", { openReason: "requisition is closed" }), link("old", { endedReason: "requisition end date passed (2026-10-01)" })];
    const r = await routeLeadRequisition({ campaignId: "c1", primaryRequisitionId: "night", lead: lead("No"), now: NOW });
    expect(r).toEqual({ requisitionId: "night", routedBy: "form", candidates: [] });
    expect(h.sqls.some((x) => x.sql.includes("FROM job_requisition jr"))).toBe(false);
  });
});

describe("overrideLeadRequisition (HR)", () => {
  it("moves an uncontacted lead to a linked requisition, routed_by hr, then re-screens", async () => {
    h.lead = { id: "l1", campaign_id: "c1", requisition_id: "night", parsed_phone: "9999900222" };
    await overrideLeadRequisition({ metaLeadId: "l1", requisitionId: "day", actor: "u1", rescreen: h.rescreen });
    const upd = h.sqls.find((x) => x.sql.startsWith("UPDATE meta_lead_raw SET requisition_id = ?, routed_by = 'hr'"))!;
    expect(upd.p).toEqual(["day", "l1"]);
    expect(h.rescreen).toHaveBeenCalledWith("l1");
  });

  it("placed by HR, the lead is enrolled through the one Live Meta arrival path (after the re-screen)", async () => {
    h.lead = { id: "l1", campaign_id: "c1", requisition_id: "night", parsed_phone: "9999900222" };
    const order: string[] = [];
    h.rescreen.mockImplementationOnce(async () => { order.push("rescreen"); return null; });
    const enrol = vi.fn(async () => { order.push("enrol"); });
    await overrideLeadRequisition({ metaLeadId: "l1", requisitionId: "day", actor: "u1", rescreen: h.rescreen, enrol });
    expect(enrol).toHaveBeenCalledWith("l1");
    expect(order).toEqual(["rescreen", "enrol"]);
  });

  it("a held lead placed on the requisition it already sits on stops being held (routed_by hr) and is enrolled", async () => {
    h.lead = { id: "l1", campaign_id: "c1", requisition_id: "night", parsed_phone: "9999900222", routed_by: "hold" };
    const enrol = vi.fn(async () => undefined);
    await overrideLeadRequisition({ metaLeadId: "l1", requisitionId: "night", actor: "u1", rescreen: h.rescreen, enrol });
    const upd = h.sqls.find((x) => x.sql.startsWith("UPDATE meta_lead_raw SET routed_by = 'hr'"))!;
    expect(upd.p).toEqual(["l1"]);
    expect(h.rescreen).not.toHaveBeenCalled();
    expect(enrol).toHaveBeenCalledWith("l1");
  });

  it("refuses a contacted lead (409), a requisition not linked to the campaign (409) and an unknown lead (404)", async () => {
    h.lead = { id: "l1", campaign_id: "c1", requisition_id: "night", parsed_phone: "9999900222" };
    h.contacted = true;
    await expect(overrideLeadRequisition({ metaLeadId: "l1", requisitionId: "day", actor: "u1", rescreen: h.rescreen })).rejects.toMatchObject({ statusCode: 409 });
    h.contacted = false;
    await expect(overrideLeadRequisition({ metaLeadId: "l1", requisitionId: "zzz", actor: "u1", rescreen: h.rescreen })).rejects.toMatchObject({ statusCode: 409 });
    h.lead = null;
    await expect(overrideLeadRequisition({ metaLeadId: "l1", requisitionId: "day", actor: "u1", rescreen: h.rescreen })).rejects.toMatchObject({ statusCode: 404 });
    expect(h.sqls.some((x) => x.sql.startsWith("UPDATE"))).toBe(false);
  });
});

describe("campaignRoutingSummary", () => {
  it("counts by how leads were routed and lists the held ones masked with first names only", async () => {
    const r = await campaignRoutingSummary("c1");
    expect(r.counts).toEqual({ legacy: 4, hold: 1 });
    expect(r.held).toEqual([{ id: "l9", name: "Rig", maskedMobile: "99xxxxxx33", requisitionId: "night", at: "2026-10-09 10:00:00" }]);
  });
});
