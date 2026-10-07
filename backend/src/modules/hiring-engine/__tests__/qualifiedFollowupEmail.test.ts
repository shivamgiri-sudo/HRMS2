import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const isConfigured = vi.hoisted(() => vi.fn());
const bridge = vi.hoisted(() => vi.fn());
const assign = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send, isConfigured } }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: bridge }));
vi.mock("../../meta-campaign/interview-slot.service.js", () => ({ assignInterviewSlot: assign }));

import { readSwitches } from "../qualified-followup.policy.js";
import { nextStepDue } from "../qualified-followup.rules.js";
import { runEmailStep } from "../qualified-followup.email.js";

const liveEnv = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const testEnv = { QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_PHONE: "9876543210", QUAL_FOLLOWUP_TEST_TO_EMAIL: "qa@x.in" } as NodeJS.ProcessEnv;
const now = new Date("2026-10-07T11:00:00+05:30");

interface World { row?: Record<string, unknown>; slot?: boolean; dup?: boolean; claim?: number; leadStatus?: string }
function world(w: World = {}) {
  const row = { id: "0f1e2d3c-aaaa-bbbb-cccc-000000000000", source_type: "meta_live", meta_lead_id: "m1", he_lead_id: null, ats_candidate_id: null, requisition_id: "req-1", drive_id: null,
    mobile10: "9876543210", email: "Cand@Example.com", full_name: "asha rao", branch_name: "Noida", role_name: "Customer Support", qualified_at: "2026-10-07 09:00:00",
    email_due_at: "2026-10-07 10:00:00", email_status: null, email_attempts: 0, wa_due_at: "2026-10-07 11:00:00", wa_status: null, wa_attempts: 0, call_due_at: null, call_state: "pending", call_attempts: 0, ...w.row };
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM qualified_followup qf")) return [[row]];
    if (q.includes("SET email_status = 'sending'")) return [{ affectedRows: w.claim ?? 1 }];
    if (q.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    if (q.includes("FROM he_lead WHERE mobile10")) return [[{ id: "lead-1" }]];
    if (q.includes("SELECT status FROM he_lead")) return [[{ status: w.leadStatus ?? "new" }]];
    if (q.includes("FROM branch_master")) return [[{ address: "Sector 62, Noida", latitude: null, longitude: null }]];
    if (q.includes("FROM job_requisition")) return [[{ bmi_assessment_url: "https://bmi.example/x" }]];
    if (q.includes("FROM meta_lead_raw")) return [w.slot === false ? [{}] : [{ interview_date: "2026-10-08", interview_time: "10:30:00" }]];
    if (q.includes("FROM he_message")) return [w.dup ? [{ 1: 1 }] : []];
    return [[]];
  });
}
const calls = (re: RegExp) => execute.mock.calls.filter(([sql]) => re.test(String(sql)));
const rowUpdate = () => calls(/UPDATE qualified_followup SET email_status/).filter(([sql]) => !String(sql).includes("'sending'")).at(-1)!;

beforeEach(() => {
  execute.mockReset(); send.mockReset(); isConfigured.mockReset(); bridge.mockReset(); assign.mockReset();
  isConfigured.mockReturnValue(true);
  send.mockResolvedValue({ messageId: "mid-1" });
  vi.unstubAllEnvs();
});

describe("runEmailStep", () => {
  it("dry_run: no bridge, slot, or send; one UPDATE with dry_run and the next WhatsApp due", async () => {
    world();
    const c = await runEmailStep(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv), "dry_run", now);
    expect(send).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
    const ups = calls(/^\s*UPDATE/);
    expect(ups).toHaveLength(1);
    expect(String(ups[0][0])).toContain("email_status = 'dry_run'");
    expect(ups[0][1][0]).toEqual(nextStepDue(now));
    expect(c.dryRun).toBe(1);
  });

  it("live with a slot: bridges, sends once, logs he_message, marks sent", async () => {
    world();
    const c = await runEmailStep(readSwitches(liveEnv), "live", now);
    expect(bridge).toHaveBeenCalledWith("m1");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe("cand@example.com");
    expect(send.mock.calls[0][0].subject).toContain("Walk-in interview");
    expect(calls(/INSERT INTO he_message/)[0][1]).toContain("he_walkin_invite_email");
    const [sql, params] = rowUpdate();
    expect(String(sql)).toContain("email_sent_at = NOW()");
    expect(params[0]).toBe("sent");
    expect(c.sent).toBe(1);
  });

  it("live without a slot and no BMI/address: slotless mail with the exact subject", async () => {
    world({ slot: false });
    vi.stubEnv("HE_COMPANY_NAME", "");
    // no address, so no slot is assigned
    const impl = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, p: unknown) => (String(sql).includes("FROM branch_master") ? [[]] : impl(sql, p)));
    await runEmailStep(readSwitches(liveEnv), "live", now);
    expect(assign).not.toHaveBeenCalled();
    const m = send.mock.calls[0][0];
    expect(m.subject).toBe("Walk-in interview: Customer Support, MAS Callnet");
    expect(m.html).not.toContain("Your slot");
    expect(m.html).not.toContain("?a=yes");
  });

  it("meta row with no slot but address and BMI link gets a slot assigned", async () => {
    world({ slot: false });
    assign.mockResolvedValue({ date: "2026-10-09", time: "11:00:00" });
    await runEmailStep(readSwitches(liveEnv), "live", now);
    expect(assign).toHaveBeenCalledWith("m1", "Noida");
    expect(send.mock.calls[0][0].html).toContain("Your slot");
  });

  it("dedupe hit: nothing sent, skipped with already_emailed", async () => {
    world({ dup: true });
    await runEmailStep(readSwitches(liveEnv), "live", now);
    expect(send).not.toHaveBeenCalled();
    expect(rowUpdate()[1].slice(0, 2)).toEqual(["skipped", "already_emailed"]);
  });

  it("opted-out lead at send time is blocked", async () => {
    world({ leadStatus: "opted_out" });
    const c = await runEmailStep(readSwitches(liveEnv), "live", now);
    expect(send).not.toHaveBeenCalled();
    expect(rowUpdate()[1].slice(0, 2)).toEqual(["blocked", "opted_out"]);
    expect(c.blocked).toBe(1);
  });

  it("test mode: redirected, [TEST] subject, no he_message or he_lead writes, test_sent", async () => {
    world();
    await runEmailStep(readSwitches(testEnv), "test", now);
    expect(send.mock.calls[0][0].to).toBe("qa@x.in");
    expect(send.mock.calls[0][0].subject.startsWith("[TEST] ")).toBe(true);
    expect(calls(/INSERT INTO he_message/)).toHaveLength(0);
    expect(calls(/he_lead/).filter(([s]) => /INSERT|UPDATE/.test(String(s)))).toHaveLength(0);
    expect(bridge).not.toHaveBeenCalled();
    expect(rowUpdate()[1][0]).toBe("test_sent");
  });

  it("ETIMEDOUT on attempt 0: back to NULL, attempts 1, retry in 15 minutes", async () => {
    world(); send.mockRejectedValue(new Error("connect ETIMEDOUT"));
    await runEmailStep(readSwitches(liveEnv), "live", now);
    const [sql, params] = rowUpdate();
    expect(String(sql)).toContain("email_status = NULL");
    expect(params[0]).toEqual(new Date(now.getTime() + 15 * 60_000));
    expect(params[1]).toBe(1);
    expect(calls(/INSERT INTO he_message/)).toHaveLength(0);
  });

  it("550 mailbox unavailable: final failed and WhatsApp moves on", async () => {
    world(); send.mockRejectedValue(new Error("550 mailbox unavailable"));
    const c = await runEmailStep(readSwitches(liveEnv), "live", now);
    const [sql, params] = rowUpdate();
    expect(String(sql)).toContain("email_status = 'failed'");
    expect(params[2]).toEqual(nextStepDue(now));
    expect(c.failed).toBe(1);
  });

  it("sent at 19:30 IST makes the WhatsApp due 09:00 IST next day", async () => {
    world();
    await runEmailStep(readSwitches(liveEnv), "live", new Date("2026-10-07T19:30:00+05:30"));
    const [, params] = rowUpdate();
    expect(params[2]).toEqual(new Date("2026-10-08T09:00:00+05:30"));
  });

  it("claim affecting 0 rows sends nothing", async () => {
    world({ claim: 0 });
    const c = await runEmailStep(readSwitches(liveEnv), "live", now);
    expect(send).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
    expect(c.held).toBe(1);
  });

  it("no email address or email not configured: skipped, WhatsApp due untouched", async () => {
    world({ row: { email: null } });
    await runEmailStep(readSwitches(liveEnv), "live", now);
    let u = calls(/^\s*UPDATE/); expect(u).toHaveLength(1);
    expect(u[0][1][0]).toBe("no_email"); expect(String(u[0][0])).not.toContain("wa_due_at");
    execute.mockReset(); world(); isConfigured.mockReturnValue(false);
    await runEmailStep(readSwitches(liveEnv), "live", now);
    u = calls(/^\s*UPDATE/); expect(u[0][1][0]).toBe("email_not_configured");
    expect(send).not.toHaveBeenCalled();
  });
});
