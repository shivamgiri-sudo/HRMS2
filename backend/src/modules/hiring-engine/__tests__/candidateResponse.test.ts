import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  sqls: [] as string[],
  params: [] as unknown[][],
  rows: [] as Row[],
  matches: new Map<string, Row>(),
  invites: new Map<string, Row>(),
  lead: null as Row | null,
  activeMatchId: null as string | null,
  metaRow: null as Row | null,
  capture: null as number | null,
  raceWinner: null as number | null,
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push(sql); h.params.push(p);
      if (sql.includes("FROM he_model_param") && sql.includes("policy.responses")) return [h.capture == null ? [] : [{ param_key: "policy.responses.capture", value: h.capture }]];
      if (sql.includes("FROM he_model_param")) return [[]];
      if (sql.startsWith("SELECT m.id, m.lead_id") && sql.includes("WHERE m.id = ?")) { const m = h.matches.get(String(p[0])); return [m ? [m] : []]; }
      if (sql.includes("FROM walkin_invite WHERE id = ?")) { const w = h.invites.get(String(p[0])); return [w ? [w] : []]; }
      if (sql.includes("FROM he_lead WHERE id = ?") || sql.includes("FROM he_lead WHERE mobile10 = ?")) return [h.lead ? [h.lead] : []];
      if (sql.includes("FROM he_match WHERE lead_id = ? AND state IN")) return [h.activeMatchId ? [{ id: h.activeMatchId }] : []];
      if (sql.includes("FROM meta_lead_raw r WHERE r.id = ?")) return [h.metaRow ? [h.metaRow] : []];
      if (sql.startsWith("INSERT INTO candidate_response")) {
        const ref = `${p[17]}|${p[18]}`;
        if (h.rows.some((r) => `${r.source_kind}|${r.source_ref}` === ref)) throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY", errno: 1062 });
        const id = h.rows.length + 1;
        h.rows.push({ id, channel: p[1], mode: p[2], answer: p[3], status: p[6], match_id: p[10], requisition_id: p[13], campaign_id: p[14], drive_id: p[15], drive_type: p[16], source_kind: p[17], source_ref: p[18], raw_text: p[19], dedupe_of: p[22], conflict: p[23] });
        return [{ insertId: id, affectedRows: 1 }];
      }
      if (sql.includes("FROM candidate_response WHERE source_kind = ? AND source_ref = ?")) {
        const r = h.rows.find((x) => x.source_kind === p[0] && x.source_ref === p[1]);
        return [r ? [r] : []];
      }
      if (sql.startsWith("UPDATE he_match SET confirmed_at = COALESCE")) {
        const m = h.matches.get(String(p[3]))!;
        if (h.raceWinner != null && m.confirmed_response_id == null) { m.confirmed_response_id = h.raceWinner; m.confirmed_via = "whatsapp"; }
        if (m.confirmed_response_id == null) { m.confirmed_response_id = p[2]; m.confirmed_via = p[1]; m.confirmed_at = p[0]; }
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("SELECT confirmed_at, confirmed_via, confirmed_response_id FROM he_match")) { const m = h.matches.get(String(p[0])); return [m ? [m] : []]; }
      if (sql.startsWith("UPDATE candidate_response SET dedupe_of")) { const r = h.rows.find((x) => x.id === p[1])!; r.dedupe_of = p[0]; return [{ affectedRows: 1 }]; }
      return [[]];
    }),
  },
}));

import { confirmationOf, recordResponse, type ResponseInput } from "../candidate-response.service.js";

const at = new Date("2026-10-08T06:00:00Z");
const base = (o: Partial<ResponseInput> = {}): ResponseInput => ({
  occurredAt: at, channel: "web", mode: "button", answer: "confirm", mobile10: "9876543210", matchId: "M1",
  sourceKind: "public_answer", sourceRef: "msg-1", applied: true, ...o,
});
const match = (o: Row = {}): Row => ({ id: "M1", lead_id: "L1", requisition_id: "R1", drive_id: "D1", slot_at: "2026-10-09 11:00:00", branch_name: "NOIDA-2", meta_lead_id: "ML1", campaign_id: "C1", drive_type: "meta_live", state: "invited", confirmed_response_id: null, ...o });

beforeEach(() => {
  h.sqls = []; h.params = []; h.rows = []; h.matches = new Map([["M1", match()]]); h.invites = new Map(); h.lead = null; h.activeMatchId = null; h.metaRow = null; h.capture = null; h.raceWinner = null;
});

describe("recordResponse", () => {
  it("stores the resolved context once (match → requisition, drive, slot, branch, campaign, drive type)", async () => {
    const r = await recordResponse(base());
    expect(r).toEqual({ id: 1, created: true, dedupeOf: null, conflict: false });
    expect(h.rows[0]).toMatchObject({ channel: "web", mode: "button", answer: "confirm", status: "applied", match_id: "M1", requisition_id: "R1", drive_id: "D1", campaign_id: "C1", drive_type: "meta_live" });
  });

  it("retry of the same source_ref returns created false and writes nothing else", async () => {
    await recordResponse(base());
    const before = h.sqls.length;
    const r = await recordResponse(base());
    expect(r).toMatchObject({ id: 1, created: false });
    const after = h.sqls.slice(before);
    expect(after.filter((s) => /^(INSERT|UPDATE)/.test(s) && !s.startsWith("INSERT INTO candidate_response"))).toEqual([]);
    expect(h.rows).toHaveLength(1);
  });

  it("first confirm stamps he_match; a second confirm on another channel gets dedupe_of and leaves confirmed_via", async () => {
    await recordResponse(base());
    expect(h.matches.get("M1")).toMatchObject({ confirmed_via: "web", confirmed_response_id: 1 });
    const r2 = await recordResponse(base({ channel: "whatsapp", mode: "button", sourceKind: "he_message", sourceRef: "wa-1" }));
    expect(r2).toMatchObject({ id: 2, created: true, dedupeOf: 1 });
    expect(h.rows[1].dedupe_of).toBe(1);
    expect(h.matches.get("M1")).toMatchObject({ confirmed_via: "web", confirmed_response_id: 1 });
  });

  it("a concurrent confirm that lost the stamp race is re-pointed with dedupe_of", async () => {
    // This call read confirmed_response_id = null, but another response (99) stamped the match before our UPDATE.
    h.raceWinner = 99;
    const r = await recordResponse(base());
    expect(r).toMatchObject({ id: 1, dedupeOf: 99 });
    expect(h.rows[0].dedupe_of).toBe(99);
    expect(h.matches.get("M1")!.confirmed_response_id).toBe(99);
  });

  it("decline after a confirm sets conflict", async () => {
    await recordResponse(base());
    const r = await recordResponse(base({ answer: "decline", channel: "whatsapp", mode: "text", sourceKind: "he_message", sourceRef: "wa-2" }));
    expect(r.conflict).toBe(true);
    expect(h.rows[1].conflict).toBe(1);
  });

  it("context from the invite when there is no match", async () => {
    h.invites.set("I1", { id: "I1", requisition_id: "R7", campaign_id: "C7", drive_type: "meta_old", branch_name: "AHMEDABAD", slot_at: "2026-10-10 12:00:00", meta_lead_id: "ML7", lead_id: null, match_id: null, followup_id: null });
    await recordResponse(base({ matchId: null, inviteId: "I1", answer: "decline", sourceRef: "t-9" }));
    expect(h.rows[0]).toMatchObject({ requisition_id: "R7", campaign_id: "C7", drive_type: "meta_old", match_id: null });
  });

  it("an invite sent without a drive type takes it from its Meta form fill", async () => {
    h.invites.set("I2", { id: "I2", requisition_id: "R7", campaign_id: null, drive_type: null, branch_name: "AHMEDABAD", slot_at: null, meta_lead_id: "ML7", lead_id: null, match_id: null, followup_id: null });
    h.metaRow = { id: "ML7", requisition_id: "R7", campaign_id: "C7", drive_type: "meta_old" };
    await recordResponse(base({ matchId: null, inviteId: "I2", answer: "decline", sourceRef: "t-10" }));
    expect(h.rows[0]).toMatchObject({ requisition_id: "R7", drive_type: "meta_old" });
  });

  it("context from activeMatch when an inbound row has no requisition", async () => {
    h.lead = { id: "L1", meta_lead_id: null };
    h.activeMatchId = "M1";
    await recordResponse(base({ matchId: null, channel: "whatsapp", mode: "text", sourceKind: "he_message", sourceRef: "wa-3" }));
    expect(h.rows[0]).toMatchObject({ match_id: "M1", requisition_id: "R1", drive_id: "D1" });
  });

  it("context from the latest qualified Meta fill when there is no match at all", async () => {
    h.metaRow = { id: "ML5", requisition_id: "R5", campaign_id: "C5", drive_type: "meta_live" };
    await recordResponse(base({ matchId: null, metaLeadId: "ML5", channel: "voice_bot", mode: "call", answer: "no_answer", applied: false, sourceKind: "vapi", sourceRef: "v-1" }));
    expect(h.rows[0]).toMatchObject({ requisition_id: "R5", campaign_id: "C5", drive_type: "meta_live", status: "recorded" });
  });

  it("free text question → needs_review", async () => {
    await recordResponse(base({ answer: "question", mode: "text", channel: "whatsapp", applied: false, sourceKind: "he_message", sourceRef: "wa-q" }));
    expect(h.rows[0].status).toBe("needs_review");
  });

  it("capture switch 0 → no INSERT", async () => {
    h.capture = 0;
    expect(await recordResponse(base())).toEqual({ id: 0, created: false, dedupeOf: null, conflict: false });
    expect(h.sqls.some((s) => s.startsWith("INSERT"))).toBe(false);
  });

  it("raw_text truncated to 1000", async () => {
    await recordResponse(base({ rawText: "x".repeat(1500), sourceRef: "long" }));
    expect(String(h.rows[0].raw_text)).toHaveLength(1000);
  });

  it("confirmationOf reads the stamp", async () => {
    h.matches.get("M1")!.confirmed_at = "2026-10-08 11:30:00";
    h.matches.get("M1")!.confirmed_via = "web";
    h.matches.get("M1")!.confirmed_response_id = 4;
    expect(await confirmationOf("M1")).toEqual({ at: "2026-10-08 11:30:00", via: "web", responseId: 4 });
    h.matches.get("M1")!.confirmed_at = null;
    expect(await confirmationOf("M1")).toBeNull();
  });
});
