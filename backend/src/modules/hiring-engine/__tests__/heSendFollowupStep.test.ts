import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const hasConsent = vi.hoisted(() => vi.fn());
const addEvent = vi.hoisted(() => vi.fn());
const setLeadStatus = vi.hoisted(() => vi.fn());
const axiosPost = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-lead.service.js", () => ({ hasConsent, addEvent, setLeadStatus }));
vi.mock("../he-campaign-config.service.js", () => ({ channelAllowed: vi.fn().mockResolvedValue(true) }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn().mockResolvedValue(true) }));
vi.mock("axios", () => ({ default: { post: axiosPost } }));

import { PinbotWhatsAppProvider } from "../../communication/providers/whatsapp/pinbot.provider.js";
import { sendTemplateToLead } from "../he-send.service.js";

const extra = {
  role: "Telecaller", drive_date: "Thu 8 Oct 2026", slot_time: "11:00 AM", branch_address: "Plot 5, Sector 62",
  maps_link: "https://maps.google.com/?q=x", assessment_link: "https://bmi.example/a",
};
let world: { status: string; today: number; lastAt: string | null; revoked: boolean; req: Record<string, unknown> | null };
const inserts = () => execute.mock.calls.filter(([sql]) => /INSERT INTO he_message/.test(String(sql)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T11:00:00+05:30"));
  delete process.env.HE_SENDS_PAUSED;
  world = { status: "contacted", today: 0, lastAt: null, revoked: false, req: { approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 1 } };
  hasConsent.mockReset().mockResolvedValue(false);
  addEvent.mockReset(); setLeadStatus.mockReset(); axiosPost.mockReset();
  execute.mockReset().mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM he_lead l")) return [[{ id: "l1", mobile10: "9876543210", full_name: "Asha Rao", status: world.status, meta_lead_id: null, language_pref: "en" }]];
    if (q.includes("FROM job_requisition WHERE id")) return [world.req ? [world.req] : []];
    if (q.includes("COUNT(*) AS today")) return [[{ today: world.today, last_at: world.lastAt }]];
    if (q.includes("MAX(created_at) AS last_at")) return [[{ last_at: world.lastAt }]];
    if (q.includes("FROM he_consent")) return [world.revoked ? [{ 1: 1 }] : []];
    if (q.includes("FROM he_template")) return [[{ template_key: "he_walkin_invite:en", pinbot_name: "t1_he_walkin_invitation", language: "en", approval_state: "approved" }]];
    if (q.includes("SELECT UUID()")) return [[{ id: "msg-1" }]];
    return [{ affectedRows: 1 }];
  });
  vi.spyOn(PinbotWhatsAppProvider.prototype, "isConfigured").mockReturnValue(true);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.PINBOT_API_KEY; delete process.env.PINBOT_PHONE_NUMBER_ID; });

const send = (o: Record<string, unknown> = {}) => sendTemplateToLead({ leadId: "l1", key: "he_walkin_invite", extra, ...o });
const spy = () => vi.spyOn(PinbotWhatsAppProvider.prototype, "sendTemplate").mockResolvedValue({ success: true, message_id: "wamid.1" });

describe("followupStep", () => {
  it("skips daily cap and min gap: 2 sent today, last 10 minutes ago", async () => {
    world.today = 2; world.lastAt = "2026-10-07 10:50:00";
    const p = spy();
    const r = await send({ followupStep: true });
    expect(r.status).toBe("sent");
    expect(p).toHaveBeenCalledTimes(1);
  });
  it("quiet hours still block at 20:00 IST", async () => {
    vi.setSystemTime(new Date("2026-10-07T20:00:00+05:30"));
    const p = spy();
    expect(await send({ followupStep: true })).toEqual({ status: "blocked", reason: "quiet_hours" });
    expect(p).not.toHaveBeenCalled();
  });
  it("opted_out lead, revoked consent and the pause switch still block", async () => {
    const p = spy();
    world.status = "opted_out";
    expect(await send({ followupStep: true })).toEqual({ status: "blocked", reason: "opted_out" });
    world.status = "contacted"; world.revoked = true;
    expect(await send({ followupStep: true })).toEqual({ status: "blocked", reason: "no_consent" });
    world.revoked = false; process.env.HE_SENDS_PAUSED = "true";
    expect(await send({ followupStep: true })).toEqual({ status: "blocked", reason: "paused" });
    expect(p).not.toHaveBeenCalled();
  });
  it("treats consent as given when none was ever recorded, even with the opt-in policy on", async () => {
    spy();
    expect((await send({ followupStep: true })).status).toBe("sent");
  });
});

describe("requisitionId without a match", () => {
  it("a full requisition blocks as requisition_closed", async () => {
    world.req = { approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 5 };
    const p = spy();
    expect(await send({ followupStep: true, requisitionId: "req-1" })).toEqual({ status: "blocked", reason: "requisition_closed" });
    expect(p).not.toHaveBeenCalled();
  });
  it("an open requisition is recorded on the he_message row", async () => {
    spy();
    await send({ followupStep: true, requisitionId: "req-1" });
    const [sql, params] = inserts()[0];
    expect(String(sql)).toContain("requisition_id");
    expect((params as unknown[])[10]).toBe("req-1");
  });
});

describe("redirectTo", () => {
  it("sends to the test number and records nothing", async () => {
    const p = spy();
    const r = await send({ followupStep: true, redirectTo: "9000000001" });
    expect(r).toEqual({ status: "sent", messageId: "", providerMessageId: "wamid.1" });
    expect(p.mock.calls[0][0]).toBe("9000000001");
    expect(inserts()).toHaveLength(0);
    expect(addEvent).not.toHaveBeenCalled();
    expect(setLeadStatus).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([s]) => /UPDATE he_lead/.test(String(s)))).toBe(false);
  });
  it("a malformed redirect number is refused before any send", async () => {
    const p = spy();
    expect(await send({ followupStep: true, redirectTo: "12345" })).toEqual({ status: "blocked", reason: "invalid_redirect" });
    expect(p).not.toHaveBeenCalled();
  });
  it("an empty or null redirect fails closed and never reaches the real candidate", async () => {
    const p = spy();
    for (const v of ["", null]) expect(await send({ followupStep: true, redirectTo: v })).toEqual({ status: "blocked", reason: "invalid_redirect" });
    expect(p).not.toHaveBeenCalled();
  });
});

describe("branch address sanitising on the wire", () => {
  it("posts the multi-line address as one line", async () => {
    process.env.PINBOT_API_KEY = "k"; process.env.PINBOT_PHONE_NUMBER_ID = "p";
    vi.restoreAllMocks();
    vi.spyOn(PinbotWhatsAppProvider.prototype, "isConfigured").mockReturnValue(true);
    axiosPost.mockResolvedValue({ status: 200, data: { messages: [{ id: "wamid.2" }] } });
    const r = await send({ followupStep: true, redirectTo: "9000000001", extra: { ...extra, branch_address: "Plot 5,\nSector 62" } });
    expect(r.status).toBe("sent");
    const payload = axiosPost.mock.calls[0][1];
    const texts = payload.template.components[0].parameters.map((x: { text: string }) => x.text);
    expect(texts).toContain("Plot 5, Sector 62");
    expect(texts.some((t: string) => t.includes("\n"))).toBe(false);
  });
});

describe("existing callers (none of the new options) behave as before", () => {
  it("still blocks with daily_cap at 2 sent today", async () => {
    hasConsent.mockResolvedValue(true);
    world.today = 2; world.lastAt = "2026-10-07 05:00:00";
    const p = spy();
    expect(await send()).toEqual({ status: "blocked", reason: "daily_cap" });
    expect(p).not.toHaveBeenCalled();
  });
  it("still blocks with min_gap inside 120 minutes", async () => {
    hasConsent.mockResolvedValue(true);
    world.today = 1; world.lastAt = "2026-10-07 10:00:00";
    expect(await send()).toEqual({ status: "blocked", reason: "min_gap" });
  });
  it("still needs consent when the opt-in policy is on, and never reads job_requisition without a match", async () => {
    spy();
    expect(await send()).toEqual({ status: "blocked", reason: "no_consent" });
    expect(execute.mock.calls.some(([s]) => /FROM job_requisition WHERE id/.test(String(s)))).toBe(false);
  });
  it("a normal send sends to the lead, inserts he_message with a null requisition, logs the event and stamps last_contact_at", async () => {
    hasConsent.mockResolvedValue(true);
    const p = spy();
    const r = await send();
    expect(r).toEqual({ status: "sent", messageId: "msg-1", providerMessageId: "wamid.1" });
    expect(p.mock.calls[0][0]).toBe("9876543210");
    expect((inserts()[0][1] as unknown[])[10]).toBeNull();
    expect(addEvent).toHaveBeenCalledTimes(1);
    expect(setLeadStatus).toHaveBeenCalledWith("l1", "invited");
    expect(execute.mock.calls.some(([s]) => /UPDATE he_lead SET last_contact_at/.test(String(s)))).toBe(true);
  });
  it("transactional still skips caps and gap", async () => {
    hasConsent.mockResolvedValue(true);
    world.today = 3; world.lastAt = "2026-10-07 10:59:00";
    spy();
    expect((await send({ transactional: true })).status).toBe("sent");
  });
});
