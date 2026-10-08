import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  req: { id: "R1", branch_name: "NOIDA-2" } as Record<string, unknown> | null,
  match: { id: "M1" } as Record<string, unknown> | null,
  resp: null as Record<string, unknown> | null,
  claimed: 1,
  link: { kind: "invite", token: "b".repeat(32), answerUrl: "x", matchId: null, inviteId: "I1" } as Record<string, unknown>,
  calls: [] as unknown[][],
  audits: [] as unknown[],
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql, p });
      if (sql.includes("FROM job_requisition WHERE id = ?")) return [h.req ? [h.req] : []];
      if (sql.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE l.mobile10 = ? AND m.requisition_id = ?")) return [h.match ? [h.match] : []];
      if (sql.includes("SELECT mobile10 FROM he_lead WHERE id = ?")) return [[{ mobile10: "9876543210" }]];
      if (sql.includes("SELECT parsed_phone FROM meta_lead_raw WHERE id = ?")) return [[{ parsed_phone: "+919876543211" }]];
      if (sql.includes("FROM candidate_response cr")) return [h.resp ? [h.resp] : []];
      if (sql.startsWith("UPDATE candidate_response SET handled_by")) return [{ affectedRows: h.claimed }];
      if (sql.includes("SELECT * FROM walkin_invite WHERE id = ?")) return [[{ id: "I1", mobile10: "9876543210", requisition_id: "R1", match_id: null }]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../he-ingest.service.js", () => ({
  recordInviteAnswer: vi.fn(async (...a: unknown[]) => { h.calls.push(["recordInviteAnswer", ...a]); return { state: a[1] === "yes" ? "confirmed" : a[1] === "no" ? "declined" : "slot_released", responseId: 41 }; }),
}));
vi.mock("../walkin-invite.service.js", () => ({
  inviteLinkFor: vi.fn(async (...a: unknown[]) => { h.calls.push(["inviteLinkFor", ...a]); return h.link; }),
  resolveAnswerToken: vi.fn(async () => ({ kind: "invite", invite: { id: "I1", mobile10: "9876543210", requisition_id: "R1" } })),
}));
vi.mock("../walkin-invite-answer.service.js", () => ({
  answerInviteToken: vi.fn(async (...a: unknown[]) => { h.calls.push(["answerInviteToken", ...a]); return { state: "confirmed", matchToken: "c".repeat(32), booked: true, responseId: 42 }; }),
  bookAndAnswerMatch: vi.fn(async (...a: unknown[]) => { h.calls.push(["bookAndAnswerMatch", ...a]); return { state: "confirmed", booked: true, responseId: 43, matchId: "M1" }; }),
}));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn(async (e: unknown) => { h.audits.push(e); }) }));

import { classifyResponse, ignoreResponse, manualResponse, ResponseActionError } from "../response-actions.service.js";

const all = { all: true, branchName: null };
const noida = { all: false, branchName: "NOIDA-2" };
const pune = { all: false, branchName: "PUNE" };
const manual = { actor: "U1", mobile10: "9876543210", requisitionId: "R1", answer: "confirm" as const, note: "called, will come", via: "phone_call" as const };

beforeEach(() => {
  h.sqls = []; h.calls = []; h.audits = []; h.claimed = 1;
  h.req = { id: "R1", branch_name: "NOIDA-2" }; h.match = { id: "M1", lead_id: "L1", slot_at: "2026-10-09 10:30:00", state: "invited" };
  h.resp = { id: 7, status: "needs_review", handled_at: null, match_id: "M1", invite_id: null, mobile10: "9876543210", requisition_id: "R1", branch_name: "NOIDA-2", answer: "question", suggested_answer: "confirm" };
});

describe("manualResponse", () => {
  it("confirm on a match without a slot (only suggested) books it first, then answers", async () => {
    h.match = { id: "M1", lead_id: "L1", slot_at: null, state: "suggested" };
    const r = await manualResponse(manual, noida);
    expect(r).toEqual({ responseId: 43, matchId: "M1", state: "confirmed" });
    expect(h.calls[0]).toEqual(["bookAndAnswerMatch", expect.objectContaining({ leadId: "L1", requisitionId: "R1", answer: "yes", actor: "U1", note: "phone_call: called, will come" })]);
    expect(h.calls.some((c) => c[0] === "recordInviteAnswer")).toBe(false);
  });
  it("cannot come on a match without a slot books nothing", async () => {
    h.match = { id: "M1", lead_id: "L1", slot_at: null, state: "suggested" };
    await manualResponse({ ...manual, answer: "decline" }, noida);
    expect(h.calls[0]).toEqual(["recordInviteAnswer", "M1", "no", { channel: "hr", actor: "U1", note: "phone_call: called, will come" }]);
  });
  it("confirm on an existing match → recordInviteAnswer as hr with the actor and note", async () => {
    const r = await manualResponse(manual, noida);
    expect(r).toEqual({ responseId: 41, matchId: "M1", state: "confirmed" });
    expect(h.calls[0]).toEqual(["recordInviteAnswer", "M1", "yes", { channel: "hr", actor: "U1", note: "phone_call: called, will come" }]);
  });
  it("confirm with no match → invite (manual) + answerInviteToken as hr", async () => {
    h.match = null;
    const r = await manualResponse(manual, all);
    expect(h.calls.map((c) => c[0])).toEqual(["inviteLinkFor", "answerInviteToken"]);
    expect(h.calls[0][1]).toMatchObject({ mobile10: "9876543210", requisitionId: "R1", sourcePath: "manual" });
    expect(h.calls[1][2]).toBe("yes");
    expect(h.calls[1][3]).toMatchObject({ channel: "hr", actor: "U1" });
    expect(r).toMatchObject({ responseId: 42, state: "confirmed" });
  });
  it("mobile from the lead or the Meta row", async () => {
    await manualResponse({ ...manual, mobile10: undefined, metaLeadId: "ML1" }, all);
    expect(h.sqls.find((s) => s.sql.includes("WHERE l.mobile10 = ?"))!.p[0]).toBe("9876543211");
  });
  it("out of scope → not_found; note length and answer validated", async () => {
    await expect(manualResponse(manual, pune)).rejects.toMatchObject({ status: 404 });
    await expect(manualResponse({ ...manual, note: "x" }, all)).rejects.toMatchObject({ status: 400 });
    await expect(manualResponse({ ...manual, note: "y".repeat(301) }, all)).rejects.toMatchObject({ status: 400 });
    await expect(manualResponse({ ...manual, answer: "maybe" as never }, all)).rejects.toBeInstanceOf(ResponseActionError);
    await expect(manualResponse({ ...manual, mobile10: "123" }, all)).rejects.toMatchObject({ status: 400 });
  });
});

describe("classifyResponse", () => {
  it("needs_review WhatsApp 'ok sir' classified as confirm and applied", async () => {
    const r = await classifyResponse({ actor: "U2", responseId: 7, answer: "confirm", apply: true }, noida);
    expect(r).toEqual({ status: "applied", state: "confirmed" });
    expect(h.calls[0]).toEqual(["recordInviteAnswer", "M1", "yes", { channel: "hr", actor: "U2", note: "classified response 7" }]);
    const claim = h.sqls.find((s) => s.sql.startsWith("UPDATE candidate_response SET handled_by"))!;
    expect(claim.sql).toContain("handled_at IS NULL AND status = 'needs_review'");
    expect(h.sqls.find((s) => s.sql.startsWith("UPDATE candidate_response SET status"))!.p).toEqual(["applied", "confirm", 7]);
  });
  it("question → recorded, nothing applied", async () => {
    expect(await classifyResponse({ actor: "U2", responseId: 7, answer: "question", apply: true }, noida)).toEqual({ status: "recorded" });
    expect(h.calls).toHaveLength(0);
  });
  it("classify twice → 409 (already handled)", async () => {
    h.claimed = 0;
    await expect(classifyResponse({ actor: "U2", responseId: 7, answer: "confirm", apply: true }, noida)).rejects.toMatchObject({ status: 409 });
    h.resp = { ...h.resp!, status: "applied", handled_at: "2026-10-08 10:00:00" };
    await expect(classifyResponse({ actor: "U2", responseId: 7, answer: "confirm", apply: true }, noida)).rejects.toMatchObject({ status: 409 });
  });
  it("hr from another branch → 404; missing → 404", async () => {
    await expect(classifyResponse({ actor: "U2", responseId: 7, answer: "confirm", apply: true }, pune)).rejects.toMatchObject({ status: 404 });
    h.resp = null;
    await expect(classifyResponse({ actor: "U2", responseId: 8, answer: "confirm", apply: true }, all)).rejects.toMatchObject({ status: 404 });
  });
  it("no match but an invite → answerInviteToken", async () => {
    h.resp = { ...h.resp!, match_id: null, invite_id: "I1" };
    await classifyResponse({ actor: "U2", responseId: 7, answer: "decline", apply: true }, noida);
    expect(h.calls[0][0]).toBe("answerInviteToken");
    expect(h.calls[0][2]).toBe("no");
  });
});

describe("ignoreResponse", () => {
  it("marks ignored with an audit entry carrying the reason", async () => {
    await ignoreResponse({ actor: "U3", responseId: 7, reason: "spam message" }, noida);
    expect(h.sqls.find((s) => s.sql.startsWith("UPDATE candidate_response SET handled_by"))!.p).toEqual(["U3", "ignored", 7]);
    expect(h.audits[0]).toMatchObject({ actor_user_id: "U3", action_type: "he_response_ignored", entity_id: "7", reason: "spam message" });
  });
  it("reason required", async () => {
    await expect(ignoreResponse({ actor: "U3", responseId: 7, reason: "" }, noida)).rejects.toMatchObject({ status: 400 });
  });
});
