import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: [] as string[],
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  lockResults: [] as number[],
  book: { status: "booked", matchId: "M1", driveId: "D1", slotAt: "2026-10-09 11:00:00", token: "c".repeat(32), created: true } as Record<string, unknown>,
  switches: { capture: true, bookOnYes: true, autoApplyConfidence: 0 },
  lead: { id: "L1", status: "new", meta_lead_id: "ML1" } as Record<string, unknown> | null,
  responses: [] as Array<Record<string, unknown>>,
  events: [] as unknown[][],
  bookArgs: null as unknown,
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql, p });
      if (sql.startsWith("UPDATE")) h.log.push(sql.slice(0, 40));
      if (sql.includes("FROM job_requisition")) return [[{ branch_name: "NOIDA-2" }]];
      return [[]];
    }),
    getConnection: vi.fn(async () => ({
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("GET_LOCK('he_engine_tick'")) { const ok = h.lockResults.length ? h.lockResults.shift()! : 1; h.log.push(`GET_LOCK=${ok}`); return [[{ ok }]]; }
        if (sql.includes("RELEASE_LOCK('he_engine_tick')")) { h.log.push("RELEASE_LOCK"); return [[{ ok: 1 }]]; }
        return [[]];
      }),
      release: vi.fn(() => { h.log.push("conn.release"); }),
    })),
  },
}));
vi.mock("../walkin-booking.service.js", () => ({ bookLeadOnDrive: vi.fn(async (a: unknown) => { h.log.push("book"); h.bookArgs = a; return h.book; }) }));
vi.mock("../he-ingest.service.js", () => ({
  recordInviteAnswer: vi.fn(async (id: string, a: string, o?: { channel?: string }) => { h.log.push(`recordInviteAnswer:${id}:${a}:${o?.channel ?? ""}`); return { state: a === "yes" ? "confirmed" : "slot_released" }; }),
}));
vi.mock("../he-lead.service.js", () => ({
  addEvent: vi.fn(async (...a: unknown[]) => { h.events.push(a); }),
  findLeadByMobile: vi.fn(async () => h.lead),
  upsertLead: vi.fn(async () => { h.log.push("upsertLead"); h.lead = { id: "L9", status: "new", meta_lead_id: null }; return { id: "L9", created: true }; }),
  setLeadStatus: vi.fn(async (_id: string, s: string) => { h.log.push(`setLeadStatus:${s}`); }),
  revokeConsent: vi.fn(async (_id: string, k: string) => { h.log.push(`revokeConsent:${k}`); }),
}));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: vi.fn(async () => { h.log.push("bridge"); }) }));
vi.mock("../responses.policy.js", () => ({ loadResponseSwitches: vi.fn(async () => h.switches) }));
vi.mock("../candidate-response.service.js", () => ({ recordResponseSafe: vi.fn(async (r: Record<string, unknown>) => { h.responses.push(r); return { id: 1, created: true, dedupeOf: null, conflict: false }; }) }));

import { answerInviteToken } from "../walkin-invite-answer.service.js";
import type { WalkinInviteRow } from "../walkin-invite.service.js";

const now = new Date("2026-10-08T05:00:00Z");
const invite = (o: Partial<WalkinInviteRow> = {}): WalkinInviteRow => ({
  id: "I1", token: "b".repeat(32), mobile10: "9876543210", requisition_id: "R1", lead_id: null, meta_lead_id: "ML1", followup_id: null, campaign_id: "C1",
  drive_type: "meta_live", branch_name: "NOIDA-2", slot_at: "2026-10-09 11:00:00", source_path: "legacy_meta", state: "sent", match_id: null, send_count: 1, ...o,
});

beforeEach(() => {
  h.log = []; h.sqls = []; h.lockResults = []; h.responses = []; h.events = [];
  h.book = { status: "booked", matchId: "M1", driveId: "D1", slotAt: "2026-10-09 11:00:00", token: "c".repeat(32), created: true };
  h.switches = { capture: true, bookOnYes: true, autoApplyConfidence: 0 };
  h.lead = { id: "L1", status: "new", meta_lead_id: "ML1" };
});

describe("answerInviteToken", () => {
  it("Yes books invited then confirms under the engine lock", async () => {
    const r = await answerInviteToken(invite(), "yes", { now, channel: "web" });
    expect(r).toEqual({ state: "confirmed", matchToken: "c".repeat(32), booked: true });
    const order = ["GET_LOCK=1", "book", "recordInviteAnswer:M1:yes:web", "RELEASE_LOCK"].map((x) => h.log.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h.bookArgs).toMatchObject({ leadId: "L1", requisitionId: "R1", branchName: "NOIDA-2", preferredSlotAt: "2026-10-09 11:00:00", state: "invited" });
    const upd = h.sqls.find((s) => s.sql.startsWith("UPDATE walkin_invite"))!;
    expect(upd.p).toEqual(["answered_yes", "M1", "I1"]);
  });

  it("the lead is bridged from the Meta row when the invite has none, else created from the mobile", async () => {
    h.lead = null;
    await answerInviteToken(invite({ meta_lead_id: null }), "yes", { now, channel: "web" });
    expect(h.log).toContain("upsertLead");
    h.log = []; h.lead = { id: "L1", status: "new", meta_lead_id: "ML1" };
    await answerInviteToken(invite(), "yes", { now, channel: "web" });
    expect(h.log[0]).toBe("bridge");
  });

  it("lock timeout twice → response recorded, needs_human_followup, nothing booked", async () => {
    h.lockResults = [0, 0];
    const r = await answerInviteToken(invite(), "yes", { now, channel: "web" });
    expect(r).toMatchObject({ booked: false, reason: "busy" });
    expect(h.log).not.toContain("book");
    expect(h.responses).toHaveLength(1);
    expect(h.responses[0]).toMatchObject({ answer: "confirm", channel: "web", mode: "button", applied: false, inviteId: "I1" });
    expect(h.events.some((e) => e[1] === "needs_human_followup")).toBe(true);
  });

  it("lock busy once then free → booked", async () => {
    h.lockResults = [0, 1];
    expect((await answerInviteToken(invite(), "yes", { now, channel: "web" })).booked).toBe(true);
  });

  it("later books then releases → slot_released (the engine's replacementSlots picks it)", async () => {
    const r = await answerInviteToken(invite(), "later", { now, channel: "web" });
    expect(r).toMatchObject({ state: "slot_released", booked: true });
    expect(h.log).toContain("recordInviteAnswer:M1:later:web");
    expect(h.sqls.find((s) => s.sql.startsWith("UPDATE walkin_invite"))!.p[0]).toBe("answered_later");
  });

  it("the booked slot is mirrored to the Meta row when it moved", async () => {
    h.book = { ...h.book, slotAt: "2026-10-10 12:00:00" };
    await answerInviteToken(invite(), "yes", { now, channel: "web" });
    const m = h.sqls.find((s) => s.sql.includes("UPDATE meta_lead_raw SET interview_date"))!;
    expect(m.p).toEqual(["2026-10-10 12:00:00", "2026-10-10 12:00:00", "ML1"]);
  });

  it("no books nothing and mirrors walkin_declined", async () => {
    const r = await answerInviteToken(invite(), "no", { now, channel: "web" });
    expect(r).toEqual({ state: "declined", booked: false });
    expect(h.log).not.toContain("book");
    expect(h.sqls.some((s) => s.sql.includes("walkin_declined = 1"))).toBe(true);
    expect(h.sqls.find((s) => s.sql.startsWith("UPDATE walkin_invite"))!.p).toEqual(["declined", null, "I1"]);
    expect(h.responses[0]).toMatchObject({ answer: "decline", applied: true });
  });

  it("stop opts out without any he_match", async () => {
    const r = await answerInviteToken(invite(), "stop", { now, channel: "web" });
    expect(r).toEqual({ state: "stopped", booked: false });
    expect(h.log).toEqual(expect.arrayContaining(["setLeadStatus:opted_out", "revokeConsent:whatsapp_contact"]));
    expect(h.events.some((e) => e[1] === "opted_out")).toBe(true);
    expect(h.sqls.some((s) => s.sql.includes("meta_lead_raw"))).toBe(false);
    expect(h.responses[0]).toMatchObject({ answer: "unsubscribe" });
  });

  it("book_on_yes 0 → record only + needs_human_followup", async () => {
    h.switches.bookOnYes = false;
    const r = await answerInviteToken(invite(), "yes", { now, channel: "web" });
    expect(r).toMatchObject({ booked: false, reason: "booking_off" });
    expect(h.log).not.toContain("book");
    expect(h.events.some((e) => e[1] === "needs_human_followup")).toBe(true);
    expect(h.responses).toHaveLength(1);
  });

  it("requisition closed at answer time → unavailable, HR follow-up event", async () => {
    h.book = { status: "unavailable", reason: "requisition_closed" };
    const r = await answerInviteToken(invite(), "yes", { now, channel: "web" });
    expect(r).toMatchObject({ state: "unavailable", booked: false, reason: "requisition_closed" });
    expect(h.log).not.toContain("recordInviteAnswer:M1:yes:web");
    expect(h.log).toContain("RELEASE_LOCK");
    expect(h.events.find((e) => e[1] === "needs_human_followup")![2]).toMatchObject({ detail: expect.stringContaining("requisition_closed") });
    expect(h.responses[0]).toMatchObject({ answer: "confirm", applied: false });
  });

  it("an HR answer is passed through as channel hr", async () => {
    await answerInviteToken(invite(), "yes", { now, channel: "hr", actor: "U1" });
    expect(h.log).toContain("recordInviteAnswer:M1:yes:hr");
  });
});

describe("engine selection never picks a booked + confirmed match", () => {
  it("inviteForDrive selects suggested only; follow-ups select invited only", () => {
    const src = readFileSync(join(__dirname, "../he-engine.service.ts"), "utf-8");
    const inv = src.slice(src.indexOf("export async function inviteForDrive"), src.indexOf("export async function runFollowUps"));
    expect(inv).toContain("m.state = 'suggested'");
    expect(inv).not.toMatch(/m\.state = 'confirmed'|'invited','confirmed'/);
  });
});
