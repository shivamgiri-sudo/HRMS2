import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const sbConfig = vi.hoisted(() => vi.fn());
const queue = vi.hoisted(() => vi.fn());
const voice = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-secrets.service.js", () => ({ superbotConfig: sbConfig }));
vi.mock("../he-superbot.service.js", () => ({ queueSuperbotCall: queue }));
vi.mock("../he-voice.service.js", () => ({ placeVoiceCall: voice }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: vi.fn() }));
vi.mock("../../meta-campaign/interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn() }));

import { readSwitches } from "../qualified-followup.policy.js";
import { runCallStep } from "../qualified-followup.call.js";

const base = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const bot = { ...base, QUAL_FOLLOWUP_BOT_SOURCES: "meta_live,he" } as NodeJS.ProcessEnv;
const testEnv = { ...bot, QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_PHONE: "+91 91234 56789", QUAL_FOLLOWUP_TEST_TO_EMAIL: "qa@x.in" } as NodeJS.ProcessEnv;
const now = new Date("2026-10-07T11:00:00+05:30");

interface World { row?: Record<string, unknown>; address?: string | null; slot?: boolean; claim?: number; match?: boolean }
function world(w: World = {}) {
  const row = { id: "0f1e2d3c-aaaa-bbbb-cccc-000000000000", source_type: "meta_live", meta_lead_id: "m1", he_lead_id: "lead-1", ats_candidate_id: null, requisition_id: "req-1", drive_id: "d1",
    mobile10: "9876543210", email: "c@x.com", full_name: "asha rao", branch_name: "Noida", role_name: "Customer Support", qualified_at: "2026-10-07 09:00:00",
    email_due_at: "2026-10-07 09:30:00", email_status: "sent", email_attempts: 0, wa_due_at: "2026-10-07 10:00:00", wa_status: "sent", wa_attempts: 0,
    call_due_at: "2026-10-07 11:00:00", call_state: "pending", call_attempts: 0, ...w.row };
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM qualified_followup qf")) return [[row]];
    if (q.includes("SET call_state = 'queued', call_error = NULL")) return [{ affectedRows: w.claim ?? 1 }];
    if (q.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    if (q.includes("SELECT status FROM he_lead")) return [[{ status: "new" }]];
    if (q.includes("FROM branch_master")) return [w.address === null ? [] : [{ address: w.address ?? "Sector 62, Noida", latitude: null, longitude: null }]];
    if (q.includes("FROM job_requisition")) return [[{ bmi_assessment_url: "https://bmi.example/x" }]];
    if (q.includes("FROM meta_lead_raw")) return [w.slot === false ? [] : [{ interview_date: "2026-10-08", interview_time: "10:30:00" }]];
    if (q.includes("FROM he_match")) return [w.match === false ? [] : [{ id: "match-1", slot_at: "2026-10-08 10:30:00", token: "tok" }]];
    return [[]];
  });
}
const updates = () => execute.mock.calls.filter(([sql]) => String(sql).startsWith("UPDATE")).map(([sql, p]) => [String(sql), p as unknown[]] as const);
const lastUpdate = () => updates().at(-1)!;

beforeEach(() => {
  execute.mockReset(); sbConfig.mockReset(); queue.mockReset(); voice.mockReset();
  sbConfig.mockResolvedValue({ apiKey: "k" });
  queue.mockResolvedValue({ ok: true, requestId: "r1" });
});

describe("runCallStep", () => {
  it("default switches (no bot sources): row goes to the calling file, no provider or config call", async () => {
    world();
    const c = await runCallStep(readSwitches(base), "live", now);
    expect(lastUpdate()[0]).toContain("call_state = 'in_file'");
    expect(sbConfig).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled(); expect(voice).not.toHaveBeenCalled();
    expect(c.processed).toBe(1);
  });

  it.each(["2026-10-07T20:00:00+05:30", "2026-10-07T08:59:00+05:30"])("outside the window (%s): no query", async (t) => {
    world();
    await runCallStep(readSwitches(bot), "live", new Date(t));
    expect(execute).not.toHaveBeenCalled();
  });

  it("is inert when off, when the tag is not owned, and when paused", async () => {
    world();
    await runCallStep(readSwitches({}), "live", now);
    await runCallStep(readSwitches(base), "dry_run", now);
    await runCallStep(readSwitches({ ...bot, HE_SENDS_PAUSED: "true" }), "live", now);
    expect(execute).not.toHaveBeenCalled();
  });

  it("selects only settled email and WhatsApp rows of the tag with a due call and no stop", async () => {
    world();
    await runCallStep(readSwitches({ ...base, QUAL_FOLLOWUP_PAUSE_SOURCES: "meta_old" }), "live", now);
    const [sql, params] = execute.mock.calls[0]!;
    expect(String(sql)).toContain("call_state = 'pending'");
    expect(String(sql)).toContain("stopped_reason IS NULL");
    expect(String(sql)).toContain("wa_status <> 'sending'");
    expect(String(sql)).toContain("LIMIT 200");
    expect(params).toEqual(["live", now, "meta_old"]);
  });

  it("bot source with config and a slot: queues with QF reference and Superbot date/time, then call_state queued", async () => {
    world();
    const c = await runCallStep(readSwitches(bot), "live", now);
    expect(queue).toHaveBeenCalledWith({
      referenceId: "QF-0F1E2D3C", mobile10: "9876543210",
      params: { name: "Asha", role: "Customer Support", interview_date: "08/10/2026", interview_time: "10:30 AM", branch_address: "Sector 62, Noida" },
    });
    expect(updates().some(([sql]) => sql.includes("call_state = 'queued', call_error = NULL"))).toBe(true);
    expect(updates().some(([sql]) => sql.includes("'in_file'"))).toBe(false);
    expect(c.sent).toBe(1);
  });

  it("bot source but Superbot not configured: in_file, nothing queued", async () => {
    world(); sbConfig.mockResolvedValue(null);
    await runCallStep(readSwitches(bot), "live", now);
    expect(queue).not.toHaveBeenCalled();
    expect(lastUpdate()[0]).toContain("call_state = 'in_file'");
  });

  it.each([[{ slot: false }, "no_slot"], [{ address: null }, "no_branch_address"]])("missing slot or address goes to the file (%j)", async (w, why) => {
    world(w as World);
    await runCallStep(readSwitches(bot), "live", now);
    expect(queue).not.toHaveBeenCalled();
    expect(lastUpdate()[1]).toContain(why);
    expect(lastUpdate()[0]).toContain("in_file");
  });

  it("final bot failure falls back to the file with the reason, attempts counted", async () => {
    world(); queue.mockResolvedValue({ ok: false, reason: "bad_number", error: "invalid number 9876543210" });
    const c = await runCallStep(readSwitches(bot), "live", now);
    const [sql, p] = lastUpdate();
    expect(sql).toContain("call_state = 'in_file'");
    expect(String(p[1])).toContain("bad_number");
    expect(String(p[1])).not.toContain("9876543210");
    expect(p[0]).toBe(1);
    expect(c.failed).toBe(1);
  });

  it("transient bot failure stays pending with a retry time and incremented attempts", async () => {
    world(); queue.mockResolvedValue({ ok: false, reason: "provider_error", error: "ETIMEDOUT" });
    await runCallStep(readSwitches(bot), "live", now);
    const [sql, p] = lastUpdate();
    expect(sql).toContain("call_state = 'pending'");
    expect(p[0]).toEqual(new Date(now.getTime() + 15 * 60_000));
    expect(p[1]).toBe(1);
  });

  it("transient failure on the third attempt falls back to the file, never stays pending", async () => {
    world({ row: { call_attempts: 2 } }); queue.mockResolvedValue({ ok: false, reason: "provider_error", error: "ETIMEDOUT" });
    await runCallStep(readSwitches(bot), "live", now);
    expect(lastUpdate()[0]).toContain("in_file");
    expect(lastUpdate()[1][0]).toBe(3);
  });

  it("a throwing provider is settled like a transient failure, not left claimed", async () => {
    world(); queue.mockRejectedValue(new Error("socket hang up"));
    await runCallStep(readSwitches(bot), "live", now);
    expect(lastUpdate()[0]).toContain("call_state = 'pending'");
  });

  it("test mode sends the bot to the test phone", async () => {
    world();
    await runCallStep(readSwitches(testEnv), "test", now);
    expect(queue.mock.calls[0]![0].mobile10).toBe("9123456789");
  });

  it("test mode never calls a he match through placeVoiceCall (it would ring the real candidate)", async () => {
    world({ row: { source_type: "he" } });
    await runCallStep(readSwitches(testEnv), "test", now);
    expect(voice).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled();
    expect(lastUpdate()[0]).toContain("in_file");
  });

  it("dry_run with bot sources configured: no provider call, in_file", async () => {
    world();
    const c = await runCallStep(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run", QUAL_FOLLOWUP_BOT_SOURCES: "meta_live" } as NodeJS.ProcessEnv), "dry_run", now);
    expect(sbConfig).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled(); expect(voice).not.toHaveBeenCalled();
    expect(lastUpdate()[0]).toContain("in_file");
    expect(c.dryRun).toBe(1);
  });

  it("he row with a match uses placeVoiceCall (live, not dry) and becomes queued", async () => {
    world({ row: { source_type: "he" } }); voice.mockResolvedValue({ status: "placed", callId: "c1" });
    await runCallStep(readSwitches(bot), "live", now);
    expect(voice).toHaveBeenCalledWith("match-1", { dryRun: false });
    expect(queue).not.toHaveBeenCalled();
    expect(updates().some(([sql]) => sql.includes("'in_file'"))).toBe(false);
  });

  it("he row without a match goes to the file", async () => {
    world({ row: { source_type: "he" }, match: false });
    await runCallStep(readSwitches(bot), "live", now);
    expect(voice).not.toHaveBeenCalled();
    expect(lastUpdate()[0]).toContain("in_file");
  });

  it.each([["lead_opted_out", "skipped"], ["requisition_closed", "skipped"], ["missing_branch_address", "in_file"], ["no_active_slot", "in_file"]])(
    "he voice block %s settles as %s", async (reason, state) => {
      world({ row: { source_type: "he" } }); voice.mockResolvedValue({ status: "blocked", reason });
      await runCallStep(readSwitches(bot), "live", now);
      expect(lastUpdate()[0]).toContain(`'${state}'`);
    });

  it("a lost claim (stopped meanwhile) provider call is not made", async () => {
    world({ claim: 0 });
    const c = await runCallStep(readSwitches(bot), "live", now);
    expect(queue).not.toHaveBeenCalled();
    expect(c.held).toBe(1);
  });

  it("a recording failure after a placed call never releases or double-places the row", async () => {
    world();
    const impl = execute.getMockImplementation()!;
    let after = false;
    queue.mockImplementation(async () => { after = true; return { ok: true, requestId: "r1" }; });
    execute.mockImplementation(async (sql: string, p: unknown[]) => { if (after && String(sql).startsWith("UPDATE")) throw new Error("db gone"); return impl(sql, p); });
    await expect(runCallStep(readSwitches(bot), "live", now)).resolves.toBeDefined();
    expect(queue).toHaveBeenCalledTimes(1);
  });
});
