import { beforeEach, describe, expect, it, vi } from "vitest";

type Link = { campaign_id: string; requisition_id: string; is_primary: number; sort_order: number; removed_at: string | null };
const h = vi.hoisted(() => ({
  sqls: [] as string[],
  links: [] as Array<{ campaign_id: string; requisition_id: string; is_primary: number; sort_order: number; removed_at: string | null }>,
  campaign: { id: "c1", requisition_id: "r1", screening_config: null as string | null } as { id: string; requisition_id: string; screening_config: string | null } | null,
  reqs: {} as Record<string, Record<string, unknown>>,
  template: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    h.sqls.push(s);
    if (s.startsWith("SELECT id, requisition_id, screening_config FROM meta_campaign")) return [h.campaign && h.campaign.id === p[0] ? [h.campaign] : [], []];
    if (s.startsWith("SELECT id, requisition_code, branch_name, approval_status")) return [h.reqs[String(p[0])] ? [h.reqs[String(p[0])]] : [], []];
    if (s.startsWith("SELECT campaign_id, requisition_id, is_primary, sort_order, removed_at FROM meta_campaign_requisition")) return [h.links.filter((l) => l.campaign_id === p[0]), []];
    if (s.startsWith("INSERT INTO meta_campaign_requisition")) {
      const [cid, rid, prim, ord] = p as [string, string, number, number];
      const ex = h.links.find((l) => l.campaign_id === cid && l.requisition_id === rid);
      if (ex) { ex.removed_at = null; ex.is_primary = prim; } else h.links.push({ campaign_id: cid, requisition_id: rid, is_primary: prim, sort_order: ord, removed_at: null });
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("UPDATE meta_campaign_requisition SET is_primary = (requisition_id = ?)")) {
      for (const l of h.links) if (l.campaign_id === p[1] && !l.removed_at) l.is_primary = l.requisition_id === p[0] ? 1 : 0;
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("UPDATE meta_campaign_requisition SET removed_at")) {
      const l = h.links.find((x) => x.campaign_id === p[1] && x.requisition_id === p[2]);
      if (l) { l.removed_at = "now"; l.is_primary = 0; }
      return [{ affectedRows: l ? 1 : 0 }, []];
    }
    if (s.startsWith("UPDATE meta_campaign SET requisition_id = ?")) { if (h.campaign) h.campaign.requisition_id = String(p[0]); return [{ affectedRows: 1 }, []]; }
    return [[], []];
  };
  const conn = { execute: exec, beginTransaction: async () => { h.sqls.push("BEGIN"); }, commit: async () => { h.sqls.push("COMMIT"); }, rollback: async () => { h.sqls.push("ROLLBACK"); }, release: () => undefined };
  return { db: { execute: exec, getConnection: async () => conn } };
});
vi.mock("../../selection/criteria.service.js", () => ({ applyTemplateToRequisition: h.template }));

import { addCampaignRequisition, removeCampaignRequisition, setPrimaryRequisition } from "../campaign-requisition.service.js";

const openReq = (id: string, o: Record<string, unknown> = {}) => ({ id, requisition_code: id.toUpperCase(), branch_name: "NOIDA-2", approval_status: "approved", active_status: 1, closed_at: null,
  requested_headcount: 10, fulfilled_headcount: 0, requisition_validity: "2026-12-31", ...o });
const actor = { id: "u1", role: "hr" };
const active = () => h.links.filter((l) => !l.removed_at);

beforeEach(() => {
  h.sqls = []; h.links = []; vi.clearAllMocks();
  h.campaign = { id: "c1", requisition_id: "", screening_config: null };
  h.reqs = { r1: openReq("r1"), r2: openReq("r2"), r3: openReq("r3", { closed_at: "2026-10-01 10:00:00", active_status: 0, approval_status: "closed" }) };
});

describe("campaign requisitions: links and the primary mirror (A2)", () => {
  it("the first link becomes primary and is mirrored into meta_campaign.requisition_id in one transaction", async () => {
    const r = await addCampaignRequisition({ campaignId: "c1", requisitionId: "r1", actor });
    expect(r.isPrimary).toBe(true);
    expect(h.campaign!.requisition_id).toBe("r1");
    const b = h.sqls.indexOf("BEGIN"), c = h.sqls.indexOf("COMMIT");
    expect(b).toBeGreaterThan(-1);
    expect(h.sqls.slice(b, c).some((s) => s.startsWith("UPDATE meta_campaign SET requisition_id = ?"))).toBe(true);
  });

  it("a second link is not primary and leaves the mirror alone", async () => {
    await addCampaignRequisition({ campaignId: "c1", requisitionId: "r1", actor });
    h.sqls = [];
    const r = await addCampaignRequisition({ campaignId: "c1", requisitionId: "r2", actor });
    expect(r.isPrimary).toBe(false);
    expect(h.campaign!.requisition_id).toBe("r1");
    expect(h.sqls.some((s) => s.startsWith("UPDATE meta_campaign SET"))).toBe(false);
  });

  it("set primary flips both link rows and the mirror inside BEGIN...COMMIT", async () => {
    await addCampaignRequisition({ campaignId: "c1", requisitionId: "r1", actor });
    await addCampaignRequisition({ campaignId: "c1", requisitionId: "r2", actor });
    h.sqls = [];
    await setPrimaryRequisition({ campaignId: "c1", requisitionId: "r2", actor });
    expect(active().find((l) => l.requisition_id === "r2")!.is_primary).toBe(1);
    expect(active().find((l) => l.requisition_id === "r1")!.is_primary).toBe(0);
    expect(h.campaign!.requisition_id).toBe("r2");
    expect(h.sqls[0]).toBe("BEGIN");
    expect(h.sqls.at(-1)).toBe("COMMIT");
  });

  it("set primary on a requisition that is not linked is refused", async () => {
    await addCampaignRequisition({ campaignId: "c1", requisitionId: "r1", actor });
    await expect(setPrimaryRequisition({ campaignId: "c1", requisitionId: "r2", actor })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("removing the primary promotes the next link; removing the last sets the JR-pending marker", async () => {
    await addCampaignRequisition({ campaignId: "c1", requisitionId: "r1", actor });
    await addCampaignRequisition({ campaignId: "c1", requisitionId: "r2", actor });
    h.sqls = [];
    await removeCampaignRequisition({ campaignId: "c1", requisitionId: "r1", actor });
    expect(h.campaign!.requisition_id).toBe("r2");
    expect(active().map((l) => [l.requisition_id, l.is_primary])).toEqual([["r2", 1]]);
    await removeCampaignRequisition({ campaignId: "c1", requisitionId: "r2", actor });
    expect(h.campaign!.requisition_id).toBe("");
    expect(active()).toHaveLength(0);
  });

  it("a closed requisition can be linked, with a warning", async () => {
    const r = await addCampaignRequisition({ campaignId: "c1", requisitionId: "r3", actor });
    expect(r.warnings).toContain("requisition is inactive");
  });

  it("unknown requisition is 400, unknown campaign is 404", async () => {
    await expect(addCampaignRequisition({ campaignId: "c1", requisitionId: "nope", actor })).rejects.toMatchObject({ statusCode: 400 });
    await expect(addCampaignRequisition({ campaignId: "zz", requisitionId: "r1", actor })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("a campaign template is copied into the new requisition's empty criteria only (S-O9)", async () => {
    await addCampaignRequisition({ campaignId: "c1", requisitionId: "r1", actor, templateId: "night_shift_bpo" });
    expect(h.template).toHaveBeenCalledWith(expect.objectContaining({ requisitionId: "r1", templateId: "night_shift_bpo", replaceFilled: false, dryRun: false }));
  });

  it("a JR-pending campaign with its own screening rules offers to copy them", async () => {
    h.campaign = { id: "c1", requisition_id: "", screening_config: JSON.stringify({ min_age: 18 }) };
    const r = await addCampaignRequisition({ campaignId: "c1", requisitionId: "r1", actor });
    expect(r.offerCopy).toBe(true);
  });
});
