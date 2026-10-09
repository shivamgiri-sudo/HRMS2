import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  campaign: { id: "c1", requisition_id: "rClosed", meta_form_id: "f1" } as Record<string, unknown> | null,
  reqs: [] as Array<Record<string, unknown>>,
  leads: [] as Array<{ id: string; screening_result: string; contacted: number }>,
  lastPayload: null as unknown,
  contactedNow: new Set<string>(),
}));
vi.mock("../../../db/mysql.js", () => {
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    h.sqls.push({ sql: s, p });
    if (s.startsWith("SELECT TABLE_NAME AS t FROM information_schema.TABLES")) return [[{ t: "walkin_invite" }, { t: "qualified_followup" }], []];
    if (s.startsWith("SELECT id, requisition_id, meta_form_id FROM meta_campaign")) return [h.campaign ? [h.campaign] : [], []];
    if (s.startsWith("SELECT id, requisition_code, branch_name")) return [h.reqs.filter((r) => p.includes(r.id)), []];
    if (s.startsWith("SELECT r.id, r.screening_result")) return [h.leads, []];
    if (s.startsWith("SELECT raw_payload FROM meta_lead_raw")) return [h.lastPayload ? [{ raw_payload: h.lastPayload }] : [], []];
    // the move re-checks "contacted" per lead inside the transaction: a lead contacted since the preview is not moved
    if (s.startsWith("UPDATE meta_lead_raw r SET r.requisition_id = ?")) { const ids = (p as string[]).slice(2); return [{ affectedRows: ids.filter((id) => !h.contactedNow.has(id)).length }, []]; }
    return [{ affectedRows: 1 }, []];
  };
  const conn = { execute: exec, beginTransaction: async () => { h.sqls.push({ sql: "BEGIN", p: [] }); }, commit: async () => { h.sqls.push({ sql: "COMMIT", p: [] }); },
    rollback: async () => { h.sqls.push({ sql: "ROLLBACK", p: [] }); }, release: () => undefined };
  return { db: { execute: exec, getConnection: async () => conn } };
});
vi.mock("../../selection/criteria.service.js", () => ({ applyTemplateToRequisition: vi.fn() }));

import { applyRelink, previewRelink } from "../campaign-relink.service.js";
import { resetOptionalTables } from "../lead-contact-lock.js";

const req = (id: string, o: Record<string, unknown> = {}) => ({ id, requisition_code: `REQ-${id.toUpperCase()}`, branch_name: "NOIDA-2", approval_status: "approved", active_status: 1, closed_at: null,
  requested_headcount: 10, fulfilled_headcount: 0, ...o });
const actor = { id: "u1", role: "hr" };
const writes = () => h.sqls.filter((x) => /^(INSERT|UPDATE|DELETE)/.test(x.sql));

beforeEach(() => {
  h.sqls = []; resetOptionalTables();
  h.campaign = { id: "c1", requisition_id: "rclosed", meta_form_id: "f1" };
  h.reqs = [req("rclosed", { approval_status: "closed", active_status: 0, closed_at: "2026-10-01 10:00:00" }), req("ropen"), req("rfull", { fulfilled_headcount: 10 })];
  h.leads = [{ id: "l1", screening_result: "qualified", contacted: 1 }, { id: "l2", screening_result: "qualified", contacted: 0 }, { id: "l3", screening_result: "disqualified", contacted: 0 }];
  h.lastPayload = null; h.contactedNow = new Set();
});

describe("relink a campaign to an open requisition (K7BK)", () => {
  it("preview counts who moves (never contacted) and who stays, and writes nothing", async () => {
    const p = await previewRelink("c1", "ropen");
    expect(p.fromClosedReason).toBe("requisition is inactive");
    expect(p.move).toEqual({ total: 2, qualified: 1, disqualified: 1, pending: 0 });
    expect(p.stay).toBe(1);
    expect(p.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(writes()).toHaveLength(0);
    // the contacted lock covers every contact path
    const leadSql = h.sqls.find((x) => x.sql.startsWith("SELECT r.id, r.screening_result"))!.sql;
    for (const part of ["notification_sent_at IS NOT NULL", "he_match", "walkin_invite", "qualified_followup"]) expect(leadSql).toContain(part);
    // a follow-up row locks only once it sent something or while it runs live (a row stopped before any send, e.g. requisition_closed, does not)
    expect(leadSql).toContain("cq.email_sent_at IS NOT NULL OR cq.wa_sent_at IS NOT NULL OR cq.called_at IS NOT NULL OR (cq.stopped_at IS NULL AND cq.mode_at_enqueue <> 'dry_run')");
  });

  it("refuses a closed or full target", async () => {
    await expect(previewRelink("c1", "rfull")).rejects.toMatchObject({ statusCode: 409 });
    await expect(previewRelink("c1", "rclosed")).rejects.toMatchObject({ statusCode: 409 });
    await expect(previewRelink("c1", "nope")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("warns when the form's hidden routing code points elsewhere", async () => {
    h.lastPayload = JSON.stringify({ field_data: [{ name: "requisition_code", values: ["REQ-RCLOSED"] }] });
    const p = await previewRelink("c1", "ropen");
    expect(p.warnings.join(" ")).toContain("REQ-RCLOSED");
  });

  it("apply needs a reason; a lead contacted since the preview makes it 409 with the fresh preview", async () => {
    const p = await previewRelink("c1", "ropen");
    await expect(applyRelink({ campaignId: "c1", toRequisitionId: "ropen", previewHash: p.previewHash, reason: "", actor })).rejects.toMatchObject({ statusCode: 400 });
    h.leads[1] = { ...h.leads[1], contacted: 1 };
    h.sqls = [];
    const err = await applyRelink({ campaignId: "c1", toRequisitionId: "ropen", previewHash: p.previewHash, reason: "K7BK closed", actor }).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 409 });
    expect(err.preview).toMatchObject({ stay: 2, move: { total: 1 } });
    expect(err.preview.moveIds).toBeUndefined();
    expect(writes()).toHaveLength(0);
  });

  it("E9: on an active campaign a new lead after the preview does not invalidate it (stable hash); the new lead moves too", async () => {
    const p = await previewRelink("c1", "ropen");
    h.leads.push({ id: "l4", screening_result: "pending", contacted: 0 });
    expect((await previewRelink("c1", "ropen")).previewHash).toBe(p.previewHash);
    const r = await applyRelink({ campaignId: "c1", toRequisitionId: "ropen", previewHash: p.previewHash, reason: "K7BK closed", actor });
    expect(r.moved).toBe(3);
  });

  it("E9: 'contacted' is re-checked inside the transaction for every moved lead (a lead contacted meanwhile stays)", async () => {
    const p = await previewRelink("c1", "ropen");
    h.contactedNow.add("l2");
    h.sqls = [];
    const r = await applyRelink({ campaignId: "c1", toRequisitionId: "ropen", previewHash: p.previewHash, reason: "K7BK closed", actor });
    expect(r).toMatchObject({ moved: 1, kept: 2 });
    const seq = h.sqls.map((x) => x.sql);
    const move = h.sqls.find((x) => x.sql.startsWith("UPDATE meta_lead_raw r SET r.requisition_id = ?"))!;
    expect(seq.indexOf(move.sql)).toBeGreaterThan(seq.indexOf("BEGIN"));
    expect(move.sql).toContain("AND NOT (r.notification_sent_at IS NOT NULL OR");
    expect(seq.some((x) => x.startsWith("SELECT id FROM meta_campaign WHERE id = ? FOR UPDATE"))).toBe(true);
  });

  it("apply moves only the uncontacted leads, flips the primary and audits, in one transaction", async () => {
    const p = await previewRelink("c1", "ropen");
    h.sqls = [];
    const r = await applyRelink({ campaignId: "c1", toRequisitionId: "ropen", previewHash: p.previewHash, reason: "K7BK closed; batch 17 open", actor });
    expect(r).toMatchObject({ moved: 2, kept: 1 });
    const seq = h.sqls.map((x) => x.sql);
    const b = seq.indexOf("BEGIN"), e = seq.indexOf("COMMIT");
    const inTx = h.sqls.slice(b, e);
    const move = inTx.find((x) => x.sql.startsWith("UPDATE meta_lead_raw r SET r.requisition_id = ?, r.routed_by = 'hr'"))!;
    expect(move.p).toEqual(["ropen", "c1", "l2", "l3"]);
    expect(inTx.some((x) => x.sql.startsWith("UPDATE meta_campaign SET requisition_id = ?") && x.p[0] === "ropen")).toBe(true);
    const audit = inTx.find((x) => x.sql.startsWith("INSERT INTO meta_campaign_relink"))!;
    expect(audit.p).toEqual(expect.arrayContaining(["c1", "rclosed", "ropen", 2, 1, p.previewHash, "u1", "hr", "K7BK closed; batch 17 open"]));
  });
});
