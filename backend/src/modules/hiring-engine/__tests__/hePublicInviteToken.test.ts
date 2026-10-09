import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  match: null as Record<string, unknown> | null,
  invite: null as Record<string, unknown> | null,
  inviteCtx: null as Record<string, unknown> | null,
  noInviteTable: false,
  recordInviteAnswer: vi.fn(async (..._a: unknown[]) => ({ state: "confirmed" })),
  recordInviteStop: vi.fn(async (..._a: unknown[]) => ({ state: "stopped" })),
  answerInviteToken: vi.fn(async (..._a: unknown[]) => ({ state: "confirmed", matchToken: "c".repeat(32), booked: true })),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql, p });
      if (h.noInviteTable && sql.includes("walkin_invite")) throw Object.assign(new Error("Table 'mas_hrms.walkin_invite' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
      if (sql.includes("WHERE m.token = ?")) return [h.match ? [h.match] : []];
      if (sql.includes("SELECT id FROM he_match WHERE token = ?")) return [[]];
      if (sql.includes("SELECT * FROM walkin_invite WHERE token = ?")) return [h.invite ? [h.invite] : []];
      if (sql.includes("FROM walkin_invite wi")) return [h.inviteCtx ? [h.inviteCtx] : []];
      return [[]];
    }),
  },
}));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), grantConsent: vi.fn(), hasConsent: vi.fn(async () => false), revokeConsent: vi.fn() }));
vi.mock("../he-ingest.service.js", () => ({ recordInviteAnswer: h.recordInviteAnswer, recordInviteStop: h.recordInviteStop }));
vi.mock("../walkin-invite-answer.service.js", () => ({ answerInviteToken: h.answerInviteToken }));

import { answerInvite, getInviteContext } from "../he-location.service.js";
import { hePublicRouter } from "../he-public.routes.js";

const MATCH_T = "a".repeat(32), INV_T = "b".repeat(32);
const inviteRow = { id: "I1", token: INV_T, mobile10: "9876543210", requisition_id: "R1", lead_id: null, meta_lead_id: "ML1", state: "sent", match_id: null, slot_at: "2026-10-09 11:00:00", branch_name: "NOIDA-2" };
const ctxRow = (o: Record<string, unknown> = {}) => ({
  ...inviteRow, before_slot: 1, designation_name: "Customer Success Executive", jr_branch: "NOIDA-2", approval_status: "approved", active_status: 1, closed_at: null,
  requested_headcount: 5, fulfilled_headcount: 1, address: "C-27 Sector 62", latitude: 28.6, longitude: 77.3, full_name: "Asha Rao", lead_status: null, ...o,
});
const matchRow = { id: "M1", lead_id: "L1", state: "invited", slot_at: "2026-10-09 11:00:00", full_name: "Asha Rao", branch_name: "NOIDA-2", designation_name: "CSE", rsvp_open: 0, address: "x", latitude: null, longitude: null, is_open: 0, optin_open: 1, lead_status: "new" };

let base = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use("/api/he-public", hePublicRouter);
  server = app.listen(0); await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/he-public`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  h.sqls = []; h.noInviteTable = false; h.match = null; h.invite = { ...inviteRow }; h.inviteCtx = ctxRow();
  h.recordInviteAnswer.mockClear(); h.recordInviteStop.mockClear(); h.answerInviteToken.mockClear();
});

describe("invite token context", () => {
  it("shows first name, slot and branch, never mobile or email", async () => {
    h.inviteCtx = ctxRow({ email: "asha@x.in", parsed_email: "asha@x.in" });
    const c = await getInviteContext(INV_T);
    expect(c).toMatchObject({ kind: "invite", firstName: "Asha", role: "Customer Success Executive", branchName: "NOIDA-2", slotAt: "2026-10-09 11:00:00", rsvpOpen: true, open: false, optInOpen: false, state: "invited", closedReason: null });
    expect(JSON.stringify(c)).not.toMatch(/\d{10}|@/);
  });
  it("closed requisition → rsvpOpen false with reason", async () => {
    h.inviteCtx = ctxRow({ fulfilled_headcount: 5 });
    expect(await getInviteContext(INV_T)).toMatchObject({ rsvpOpen: false, closedReason: "This opening is closed" });
    h.inviteCtx = ctxRow({ approval_status: "pending" });
    expect((await getInviteContext(INV_T))?.rsvpOpen).toBe(false);
  });
  it("after the slot, declined or stopped → no answer buttons", async () => {
    h.inviteCtx = ctxRow({ before_slot: 0 });
    expect((await getInviteContext(INV_T))?.rsvpOpen).toBe(false);
    h.inviteCtx = ctxRow({ state: "declined" });
    expect(await getInviteContext(INV_T)).toMatchObject({ rsvpOpen: false, state: "declined" });
    h.inviteCtx = ctxRow({ lead_status: "opted_out" });
    expect((await getInviteContext(INV_T))?.rsvpOpen).toBe(false);
  });
});

describe("routes", () => {
  it("GET with ?a=yes records nothing", async () => {
    const r = await fetch(`${base}/loc/${INV_T}?a=yes`);
    expect(r.status).toBe(200);
    const j = await r.json() as { data: Record<string, unknown> };
    expect(j.data.kind).toBe("invite");
    expect(h.sqls.some((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql))).toBe(false);
    expect(h.answerInviteToken).not.toHaveBeenCalled();
  });
  it("POST yes on an invite token calls answerInviteToken and returns the new match token", async () => {
    const r = await fetch(`${base}/loc/${INV_T}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "yes" }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, data: { state: "confirmed", matchToken: "c".repeat(32) } });
    expect(h.answerInviteToken.mock.calls[0][0]).toMatchObject({ id: "I1" });
    expect(h.answerInviteToken.mock.calls[0][1]).toBe("yes");
    expect(h.answerInviteToken.mock.calls[0][2]).toMatchObject({ channel: "web" });
  });
  it("POST on a closed invite → 403 closed; stop is still accepted", async () => {
    h.inviteCtx = ctxRow({ before_slot: 0 });
    const r = await fetch(`${base}/loc/${INV_T}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "yes" }) });
    expect(r.status).toBe(403);
    h.answerInviteToken.mockResolvedValueOnce({ state: "stopped", booked: false } as never);
    const s = await fetch(`${base}/loc/${INV_T}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "stop" }) });
    expect(s.status).toBe(200);
  });
  it("POST stop on a match token opts the lead out (even after the slot)", async () => {
    h.match = { ...matchRow };
    const r = await fetch(`${base}/loc/${MATCH_T}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "stop" }) });
    expect(await r.json()).toEqual({ success: true, data: { state: "stopped" } });
    expect(h.recordInviteStop).toHaveBeenCalledWith("M1");
    expect(h.recordInviteAnswer).not.toHaveBeenCalled();
  });
  // Intended (reviewed 2026-10-09): STOP is an opt-out, not an RSVP. It is honoured on ANY existing token at ANY time (after the slot,
  // after a decline, on a closed requisition, after arrival or a no-show), because a person must always be able to stop messages from
  // any link they were ever sent. Every other answer needs the RSVP window. An unknown token stops nothing (404).
  it.each(["confirmed", "arrived", "no_show", "declined", "slot_released"])("STOP is always honoured on a match token in state %s, after the slot, RSVP closed", async (state) => {
    h.match = { ...matchRow, state, rsvp_open: 0, is_open: 0, optin_open: 0 };
    const r = await fetch(`${base}/loc/${MATCH_T}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "stop" }) });
    expect(r.status).toBe(200);
    expect(h.recordInviteStop).toHaveBeenCalledWith("M1");
    const y = await fetch(`${base}/loc/${MATCH_T}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "yes" }) });
    expect(y.status).toBe(403);
    expect(h.recordInviteAnswer).not.toHaveBeenCalled();
  });
  it("STOP on an unknown token changes nothing (404)", async () => {
    h.invite = null; h.inviteCtx = null;
    const r = await fetch(`${base}/loc/${"e".repeat(32)}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "stop" }) });
    expect(r.status).toBe(404);
    expect(h.recordInviteStop).not.toHaveBeenCalled();
    expect(h.answerInviteToken).not.toHaveBeenCalled();
  });
  it("before migration 2140 (no walkin_invite table) an unknown token is 404, never 500", async () => {
    h.noInviteTable = true;
    const g = await fetch(`${base}/loc/${"e".repeat(32)}`);
    expect(g.status).toBe(404);
    const a = await fetch(`${base}/loc/${"e".repeat(32)}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "yes" }) });
    expect(a.status).toBe(404);
  });
  it("unknown answer → 400 bad_answer (unchanged)", async () => {
    const r = await fetch(`${base}/loc/${INV_T}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "maybe" }) });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ reason: "bad_answer" });
  });
  it("unknown token → 404", async () => {
    h.invite = null; h.inviteCtx = null;
    expect((await fetch(`${base}/loc/${"f".repeat(32)}`)).status).toBe(404);
    expect(await answerInvite("f".repeat(32), "yes")).toEqual({ ok: false, reason: "invalid" });
  });
  it("demo token accepts stop without writing", async () => {
    expect(await answerInvite("0".repeat(32), "stop")).toEqual({ ok: true, state: "stopped" });
    expect(h.sqls).toHaveLength(0);
  });
});
