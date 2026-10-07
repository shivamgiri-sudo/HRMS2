import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const sendTpl = vi.hoisted(() => vi.fn());
const bridge = vi.hoisted(() => vi.fn());
const assign = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: bridge }));
vi.mock("../../meta-campaign/interview-slot.service.js", () => ({ assignInterviewSlot: assign }));
vi.mock("../he-send.service.js", async (orig) => ({ ...(await orig<typeof import("../he-send.service.js")>()), sendTemplateToLead: sendTpl }));

import { readSwitches } from "../qualified-followup.policy.js";
import { runWhatsappStep, pipelineWaSentToday } from "../qualified-followup.whatsapp.js";

const liveEnv = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const testEnv = { QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_PHONE: "+91 98765 43210", QUAL_FOLLOWUP_TEST_TO_EMAIL: "qa@x.in" } as NodeJS.ProcessEnv;
const dryEnv = { QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv;
const now = new Date("2026-10-07T11:00:00+05:30");

interface World { row?: Record<string, unknown>; rows?: number; bmi?: string | null; address?: string | null; claim?: number; leadStatus?: string }
function world(w: World = {}) {
  const base = { id: "0f1e2d3c-aaaa-bbbb-cccc-000000000000", source_type: "meta_live", meta_lead_id: "m1", he_lead_id: "lead-1", ats_candidate_id: null, requisition_id: "req-1", drive_id: null,
    mobile10: "9876543210", email: "c@x.com", full_name: "asha rao", branch_name: "Noida", role_name: "Customer Support", qualified_at: "2026-10-07 09:00:00",
    email_due_at: "2026-10-07 10:00:00", email_status: "sent", email_attempts: 0, wa_due_at: "2026-10-07 11:00:00", wa_status: null, wa_attempts: 0, call_due_at: null, call_state: "pending", call_attempts: 0, ...w.row };
  const rows = Array.from({ length: w.rows ?? 1 }, (_, i) => ({ ...base, id: `${base.id.slice(0, -1)}${i}` }));
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM qualified_followup qf")) return [rows];
    if (q.includes("SET wa_status = 'sending'")) return [{ affectedRows: w.claim ?? 1 }];
    if (q.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    if (q.includes("SELECT status FROM he_lead")) return [[{ status: w.leadStatus ?? "new" }]];
    if (q.includes("FROM he_lead WHERE mobile10")) return [[{ id: "lead-1" }]];
    if (q.includes("FROM branch_master")) return [w.address === null ? [] : [{ address: w.address ?? "Sector 62, Noida", latitude: null, longitude: null }]];
    if (q.includes("FROM job_requisition")) return [[{ bmi_assessment_url: w.bmi === undefined ? "https://bmi.example/x" : w.bmi }]];
    if (q.includes("FROM meta_lead_raw")) return [[{ interview_date: "2026-10-08", interview_time: "10:30:00" }]];
    return [[]];
  });
}
const calls = (re: RegExp) => execute.mock.calls.filter(([sql]) => re.test(String(sql)));
const finalUpdate = () => calls(/UPDATE qualified_followup SET wa_status/).filter(([sql]) => !String(sql).includes("'sending'")).at(-1)!;

beforeEach(() => {
  execute.mockReset(); sendTpl.mockReset(); bridge.mockReset(); assign.mockReset();
  sendTpl.mockResolvedValue({ status: "sent", messageId: "msg-1", providerMessageId: "p1" });
});

describe("runWhatsappStep", () => {
  it.each(["2026-10-07T20:00:00+05:30", "2026-10-07T08:59:00+05:30"])("holds outside 09:00-20:00 IST (%s): no query, no send", async (t) => {
    world();
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", new Date(t), 100);
    expect(execute).not.toHaveBeenCalled(); expect(sendTpl).not.toHaveBeenCalled();
    expect(c).toEqual({ processed: 0, sent: 0, failed: 0, blocked: 0, held: 0, dryRun: 0 });
  });

  it("is inert when the mode does not own the tag, when paused or when mode is off", async () => {
    world();
    await runWhatsappStep(readSwitches({}), "live", now, 100);
    await runWhatsappStep(readSwitches(dryEnv), "live", now, 100);
    await runWhatsappStep(readSwitches(liveEnv), "dry_run", now, 100);
    await runWhatsappStep(readSwitches(liveEnv), "test", now, 100);
    await runWhatsappStep(readSwitches({ ...liveEnv, HE_SENDS_PAUSED: "true" }), "live", now, 100);
    expect(execute).not.toHaveBeenCalled();
  });

  it("meta_live with slot, address and BMI sends T1 and sets call due one hour later", async () => {
    world();
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    expect(sendTpl).toHaveBeenCalledTimes(1);
    const o = sendTpl.mock.calls[0][0];
    expect(o).toMatchObject({ leadId: "lead-1", key: "he_walkin_invite", followupStep: true, requisitionId: "req-1", redirectTo: undefined });
    expect(o.extra.drive_date).toBe("Thu 8 Oct 2026");
    expect(o.extra.slot_time).toBe("10:30 AM");
    const [sql, p] = finalUpdate();
    expect(String(sql)).toContain("wa_sent_at = NOW()");
    expect(p[0]).toBe("sent");
    expect(p).toContain("he_walkin_invite");
    expect(p).toContain("msg-1");
    expect(p).toContainEqual(new Date("2026-10-07T12:00:00+05:30"));
    expect(c.sent).toBe(1);
  });

  it("selects only rows never sent: wa_status NULL and wa_sent_at NULL, email step finished", async () => {
    world();
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    const q = String(calls(/FROM qualified_followup qf/)[0][0]);
    expect(q).toContain("qf.wa_status IS NULL");
    expect(q).toContain("qf.wa_sent_at IS NULL");
    expect(q).toContain("email_due_at IS NULL OR qf.email_status IS NOT NULL");
    expect(String(calls(/SET wa_status = 'sending'/)[0][0])).toContain("wa_sent_at IS NULL");
  });

  it("meta_old without a BMI link sends T8 with the next working day and records missing_details", async () => {
    world({ row: { source_type: "meta_old" }, bmi: null });
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    const o = sendTpl.mock.calls[0][0];
    expect(o.key).toBe("he_winback");
    expect(o.extra.drive_date).toBe("Thu 8 Oct 2026");
    expect(finalUpdate()[1]).toContain("bmi_link");
  });

  it("opted_out from the sender blocks with the reason", async () => {
    world();
    sendTpl.mockResolvedValue({ status: "blocked", reason: "opted_out" });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    expect(finalUpdate()[1].slice(0, 2)).toEqual(["blocked", "opted_out"]);
    expect(c.blocked).toBe(1);
  });

  it("opted-out lead at send time never reaches the sender", async () => {
    world({ leadStatus: "opted_out" });
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    expect(sendTpl).not.toHaveBeenCalled();
    expect(finalUpdate()[1].slice(0, 2)).toEqual(["blocked", "opted_out"]);
  });

  it("quiet_hours releases the claim and sets no call due", async () => {
    world();
    sendTpl.mockResolvedValue({ status: "blocked", reason: "quiet_hours" });
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    const last = execute.mock.calls.at(-1)!;
    expect(String(last[0])).toContain("wa_status = NULL");
    expect(String(last[0])).not.toContain("call_due_at");
    expect(calls(/^\s*UPDATE.*call_due_at/s)).toHaveLength(0);
  });

  it("a non-transient failure marks failed with the text and one attempt", async () => {
    world();
    sendTpl.mockResolvedValue({ status: "failed", error: "(#132018) issue with the parameters" });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    const [sql, p] = finalUpdate();
    expect(String(sql)).toContain("wa_status = 'failed'");
    expect(p.slice(0, 2)).toEqual([1, "(#132018) issue with the parameters"]);
    expect(c.failed).toBe(1);
  });

  it("a transient failure is retried later, not finalised", async () => {
    world();
    sendTpl.mockResolvedValue({ status: "failed", error: "ETIMEDOUT" });
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    const [sql, p] = finalUpdate();
    expect(String(sql)).toContain("wa_status = NULL");
    expect(String(sql)).not.toContain("call_due_at");
    expect(p[0]).toEqual(new Date("2026-10-07T11:15:00+05:30"));
  });

  it("budget 0 sends nothing; budget 1 with 3 due rows sends one", async () => {
    world({ rows: 3 });
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 0);
    expect(execute).not.toHaveBeenCalled();
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 1);
    expect(String(calls(/FROM qualified_followup qf/)[0][0])).toContain("LIMIT 1");
  });

  it("a lost claim sends nothing", async () => {
    world({ claim: 0 });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    expect(sendTpl).not.toHaveBeenCalled();
    expect(c.held).toBe(1);
  });

  it("test mode redirects to the normalised phone and marks test_sent", async () => {
    world({ row: { he_lead_id: null } });
    await runWhatsappStep(readSwitches(testEnv), "test", now, 100);
    expect(sendTpl.mock.calls[0][0].redirectTo).toBe("9876543210");
    expect(finalUpdate()[1][0]).toBe("test_sent");
    expect(bridge).not.toHaveBeenCalled();
  });

  it("no he_lead after bridging is blocked as no_he_lead", async () => {
    world({ row: { he_lead_id: null } });
    const impl = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, p: unknown) => (String(sql).includes("FROM he_lead WHERE mobile10") ? [[]] : impl(sql, p)));
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 100);
    expect(sendTpl).not.toHaveBeenCalled();
    expect(finalUpdate()[1].slice(0, 2)).toEqual(["blocked", "no_he_lead"]);
  });

  it("dry_run: no send, one UPDATE with dry_run", async () => {
    world();
    const c = await runWhatsappStep(readSwitches(dryEnv), "dry_run", now, 0);
    expect(sendTpl).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
    const ups = calls(/^\s*UPDATE/);
    expect(ups).toHaveLength(1);
    expect(String(ups[0][0])).toContain("wa_status = 'dry_run'");
    expect(ups[0][1][0]).toBeNull();
    expect(c.dryRun).toBe(1);
  });

  it("dry_run with a missing detail records the message and stays dry_run", async () => {
    world({ row: { branch_name: null }, address: null });
    await runWhatsappStep(readSwitches(dryEnv), "dry_run", now, 100);
    const [sql, p] = calls(/^\s*UPDATE/)[0];
    expect(String(sql)).toContain("wa_status = 'dry_run'");
    expect(String(p[0])).toContain("missing");
  });

  it("sent at 19:10 puts the call due at 09:00 next day", async () => {
    world({ row: { wa_due_at: "2026-10-07 19:10:00" } });
    await runWhatsappStep(readSwitches(liveEnv), "live", new Date("2026-10-07T19:10:00+05:30"), 100);
    expect(finalUpdate()[1]).toContainEqual(new Date("2026-10-08T09:00:00+05:30"));
  });
});

describe("pipelineWaSentToday", () => {
  it("counts sent and test_sent rows since IST midnight", async () => {
    execute.mockResolvedValue([[{ n: 7 }]]);
    expect(await pipelineWaSentToday("live", new Date("2026-10-07T01:00:00+05:30"))).toBe(7);
    expect(execute.mock.calls[0][1]).toEqual(["live", "2026-10-07 00:00:00"]);
    expect(String(execute.mock.calls[0][0])).toContain("'sent','test_sent'");
  });
});
