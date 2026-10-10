import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<{ match: RegExp; rows: unknown[] }>, sqls: [] as string[], params: [] as unknown[][], send: vi.fn(async () => ({ messageId: "m" })) }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string, p: unknown[] = []) => { h.sqls.push(sql); h.params.push(p); const hit = h.rows.find((r) => r.match.test(sql)); return [hit ? hit.rows : [], []]; }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send: h.send } }));

import { AUTO_INTENTS, disposition, ruleIntent, ruleReply, scrub, validateReply, type FactSheet } from "../reply-agent.rules.js";
import { handleInboundReply, resetReplyAgentCaches } from "../reply-agent.service.js";

const FACTS: FactSheet = {
  name: "Asha", role: "EXECUTIVE", branch: "NOIDA-2", address: "Okaya Tower-1, 3rd Floor, Sector 62, Noida", mapsLink: "https://maps.google.com/?q=28.6,77.3",
  slotDate: "Monday, 12 Oct 2026", slotTime: "11:00 AM", documents: "Aadhaar, PAN, 12th marksheet", assessmentLink: "https://assess.example.test/abc",
  hrContact: "Ravi 9811122233", company: "MAS Callnet", jobDescription: "Handle inbound customer queries and resolve them on call.", skills: null,
  education: "12th pass or graduate", experience: "0 to 2 years", salary: null, employmentType: "full time", shift: "day shift",
};

describe("scrub", () => {
  it("removes process names and requisition codes", () => {
    expect(scrub("Join the Onfido process, code NOIDA-Onfido-22 today", ["Onfido"])).toBe("Join the the process process, code today");
  });
  it("ignores very short terms", () => { expect(scrub("It is ok", ["ok"])).toBe("It is ok"); });
});

describe("validateReply", () => {
  const ok = (text: string, f = FACTS, deny: string[] = ["Onfido"]) => validateReply({ text, facts: f, deny });
  it("accepts a plain factual reply", () => { expect(ok("Dear Asha, your slot is Monday at 11:00 AM at Okaya Tower. Regards, HR Team")).toEqual({ ok: true }); });
  it("rejects a process name", () => { expect(ok("This is for the Onfido process")).toMatchObject({ ok: false, reason: "process_name_exposed" }); });
  it("rejects promises of selection or an offer, and fees", () => {
    expect(ok("Congratulations, you are selected")).toMatchObject({ ok: false, reason: "forbidden_promise" });
    expect(ok("Please pay a registration fee")).toMatchObject({ ok: false, reason: "forbidden_promise" });
  });
  it("rejects a phone number that is not the branch contact", () => {
    expect(ok("Call 9999999999 for details")).toMatchObject({ ok: false, reason: "unknown_phone_number" });
    expect(ok("Call 9811122233 for details")).toEqual({ ok: true });
  });
  it("rejects a link that is not ours", () => {
    expect(ok("Open https://evil.example.test/x")).toMatchObject({ ok: false, reason: "unknown_link" });
    expect(ok("Open https://assess.example.test/abc?x=1")).toEqual({ ok: true });
  });
  it("rejects a money figure the requisition does not state", () => {
    expect(ok("The salary is Rs 20000 a month")).toMatchObject({ ok: false, reason: "salary_not_in_requisition" });
    expect(ok("The salary is Rs 15,000 to Rs 20,000 a month", { ...FACTS, salary: "Rs 15,000 to Rs 20,000 a month" })).toEqual({ ok: true });
  });
  it("rejects empty and over-long text", () => {
    expect(ok("  ")).toMatchObject({ ok: false, reason: "empty" });
    expect(ok("x".repeat(1500))).toMatchObject({ ok: false, reason: "too_long" });
  });
});

describe("ruleIntent and ruleReply", () => {
  it("reads the common questions", () => {
    expect(ruleIntent("Sir what is the address?")?.intent).toBe("ask_address");
    expect(ruleIntent("which documents to bring")?.intent).toBe("ask_documents");
    expect(ruleIntent("what is the salary")?.intent).toBe("ask_salary");
    expect(ruleIntent("Yes I will come")?.intent).toBe("confirm");
    expect(ruleIntent("can I come next week")?.intent).toBe("reschedule");
    expect(ruleIntent("please stop messaging me")?.intent).toBe("opt_out");
    expect(ruleIntent("this is a scam")?.intent).toBe("complaint");
    expect(ruleIntent("am I selected?")?.intent).toBe("ask_selection");
  });
  it("answers from the facts and never invents a salary", () => {
    expect(ruleReply("ask_address", FACTS)).toContain("Okaya Tower");
    expect(ruleReply("ask_salary", FACTS)).toBeNull();
    expect(ruleReply("ask_salary", { ...FACTS, salary: "Rs 15,000 to Rs 20,000 a month" })).toContain("Rs 15,000");
    expect(ruleReply("confirm", FACTS)).toContain("Monday, 12 Oct 2026 at 11:00 AM");
  });
});

describe("disposition", () => {
  const d = (o: Partial<{ intent: "confirm"; confidence: number; needsHuman: boolean }> = {}) => ({ intent: "confirm" as const, language: "en" as const, confidence: 0.9, needsHuman: false, reply: "x", reasons: [], ...o });
  const ctx = { inWindow: true, matched: true, optedOut: false };
  it("sends only in automatic mode, inside the window, for a safe confident intent", () => {
    expect(disposition(d(), { ok: true }, 2, ctx)).toEqual({ action: "send", reason: "auto" });
    expect(disposition(d(), { ok: true }, 2, { ...ctx, inWindow: false })).toEqual({ action: "queue", reason: "outside_window" });
    expect(disposition(d(), { ok: true }, 1, ctx)).toMatchObject({ action: "hold", reason: "draft_mode" });
    expect(disposition(d(), { ok: true }, 0, ctx)).toMatchObject({ action: "hold" });
  });
  it("holds everything doubtful", () => {
    expect(disposition(d({ confidence: 0.5 }), { ok: true }, 2, ctx)).toMatchObject({ reason: "low_confidence" });
    expect(disposition(d(), { ok: false }, 2, ctx)).toMatchObject({ reason: "validation_failed" });
    expect(disposition(d({ needsHuman: true }), { ok: true }, 2, ctx)).toMatchObject({ reason: "needs_human" });
    expect(disposition({ ...d(), intent: "complaint" }, { ok: true }, 2, ctx)).toMatchObject({ reason: "needs_human" });
    expect(disposition(d(), { ok: true }, 2, { ...ctx, matched: false })).toMatchObject({ reason: "unknown_sender" });
    expect(disposition(d(), { ok: true }, 2, { ...ctx, optedOut: true })).toMatchObject({ reason: "opted_out" });
  });
  it("selection and opt-out are never automatic", () => { expect(AUTO_INTENTS.has("ask_selection")).toBe(false); expect(AUTO_INTENTS.has("opt_out")).toBe(false); });
});

describe("handleInboundReply", () => {
  const baseRows = () => [
    { match: /FROM he_model_param WHERE param_key = 'policy.reply_agent'/, rows: [{ value: 2 }] },
    { match: /SELECT DISTINCT process_name/, rows: [{ t: "Onfido" }] },
    { match: /SELECT full_name FROM he_lead/, rows: [{ full_name: "asha verma" }] },
    { match: /FROM he_match WHERE id = \?/, rows: [{ requisition_id: "r1", slot_at: "2026-10-12 11:00:00" }] },
    { match: /FROM job_requisition j LEFT JOIN branch_master/, rows: [{ designation_name: "EXECUTIVE", branch_name: "NOIDA-2", job_description: "Handle Onfido customer queries", address: "Okaya Tower-1, Noida", hr_contact: "Ravi 9811122233" }] },
    { match: /SELECT status FROM he_lead/, rows: [{ status: "invited" }] },
  ];
  beforeEach(() => { h.sqls = []; h.params = []; h.send.mockClear(); h.rows = baseRows(); resetReplyAgentCaches(); delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => vi.unstubAllGlobals());
  const msg = (text: string) => ({ inboundRef: "ref1", fromEmail: "asha@example.test", subject: "Walk-in interview", text, messageId: "<m1@x>", references: [], who: { mobile10: "9876543210", leadId: "l1", matchId: "m1" } });

  it("an address question is answered from the requisition, with no process name, and sent in automatic mode", async () => {
    const st = await handleInboundReply(msg("Sir what is the address?"), new Date("2026-10-11T05:00:00Z"));
    expect(st).toBe("sent");
    const sent = h.send.mock.calls[0][0] as { to: string; text: string; inReplyTo: string };
    expect(sent.to).toBe("asha@example.test");
    expect(sent.text).toContain("Okaya Tower-1");
    expect(sent.text).not.toMatch(/onfido/i);
    expect(sent.inReplyTo).toBe("<m1@x>");
  });
  it("draft-only mode never sends", async () => {
    h.rows[0] = { match: /FROM he_model_param WHERE param_key = 'policy.reply_agent'/, rows: [{ value: 1 }] };
    expect(await handleInboundReply(msg("Yes I will come"), new Date("2026-10-11T05:00:00Z"))).toBe("held");
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a salary question with no salary on the requisition is held for a person", async () => {
    expect(await handleInboundReply(msg("What is the salary?"), new Date("2026-10-11T05:00:00Z"))).toBe("held");
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a complaint is held", async () => {
    expect(await handleInboundReply(msg("This is a scam, I will go to police"), new Date("2026-10-11T05:00:00Z"))).toBe("held");
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a safe reply goes out at any hour, including the middle of the night", async () => {
    expect(await handleInboundReply(msg("Yes I will come"), new Date("2026-10-11T18:00:00Z"))).toBe("sent");
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("an unmatched sender is stored for HR and never answered", async () => {
    const st = await handleInboundReply({ ...msg("hello"), who: null }, new Date("2026-10-11T05:00:00Z"));
    expect(st).toBe("held");
    expect(h.send).not.toHaveBeenCalled();
    expect(h.sqls.some((s) => s.includes("INSERT INTO candidate_reply"))).toBe(true);
  });
  it("a person who opted out is never answered", async () => {
    h.rows[5] = { match: /SELECT status FROM he_lead/, rows: [{ status: "opted_out" }] };
    expect(await handleInboundReply(msg("Yes I will come"), new Date("2026-10-11T05:00:00Z"))).toBe("held");
    expect(h.send).not.toHaveBeenCalled();
  });
});
