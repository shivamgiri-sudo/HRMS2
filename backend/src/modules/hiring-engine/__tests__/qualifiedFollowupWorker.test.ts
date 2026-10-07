import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const conn = { execute: vi.fn(), release: vi.fn(), destroy: vi.fn() };
  return {
    calls, conn,
    getConnection: vi.fn(), execute: vi.fn(),
    expire: vi.fn(), sync: vi.fn(), stops: vi.fn(), email: vi.fn(), wa: vi.fn(), call: vi.fn(), waSent: vi.fn(),
    send: vi.fn(), sendTemplate: vi.fn(), voice: vi.fn(), emailSend: vi.fn(),
  };
});
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection: h.getConnection, execute: h.execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../qualified-followup.stops.js", () => ({ expireStaleClaims: h.expire, syncWaReceipts: h.sync, runStopChecks: h.stops }));
vi.mock("../qualified-followup.email.js", () => ({ runEmailStep: h.email }));
vi.mock("../qualified-followup.whatsapp.js", () => ({ runWhatsappStep: h.wa, pipelineWaSentToday: h.waSent }));
vi.mock("../qualified-followup.call.js", () => ({ runCallStep: h.call }));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: h.sendTemplate, dateLabel: (d: string) => d, timeLabel: (t: string) => t }));
vi.mock("../he-voice.service.js", () => ({ placeVoiceCall: h.voice }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send: h.emailSend } }));

import { runQualifiedFollowupTick, startQualifiedFollowupWorker, stopQualifiedFollowupWorker, LOCK_NAME } from "../qualified-followup.worker.js";
import { emptyCounts } from "../qualified-followup.context.js";

const live = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const at = (hhmm: string, day = "2026-10-07") => new Date(`${day}T${hhmm}:00+05:30`);
const tick = (env: NodeJS.ProcessEnv, now: Date, deps: Record<string, unknown> = {}) => runQualifiedFollowupTick({ env, now, deps: deps as never });

function lockOk(got = 1) {
  h.conn.execute.mockImplementation(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ got }]] : [[{ r: 1 }]]));
}
const named = (name: string, fn: ReturnType<typeof vi.fn>, ret: unknown) => fn.mockImplementation(async () => { h.calls.push(name); return ret; });

beforeEach(() => {
  vi.clearAllMocks();
  h.calls.length = 0;
  h.getConnection.mockResolvedValue(h.conn);
  lockOk();
  named("expire", h.expire, 0); named("sync", h.sync, 0); named("stops", h.stops, { checked: 0, stopped: {} });
  named("email", h.email, emptyCounts()); named("wa", h.wa, emptyCounts()); named("call", h.call, emptyCounts());
  h.waSent.mockResolvedValue(0);
});
afterEach(() => { stopQualifiedFollowupWorker(); vi.restoreAllMocks(); });

describe("tick gates", () => {
  it("mode unset: skipped off, no database call, no step", async () => {
    const r = await tick({} as NodeJS.ProcessEnv, at("11:00"));
    expect(r.skipped).toBe("off");
    expect(h.getConnection).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });
  it("lock not acquired: skipped locked, no step, connection released", async () => {
    lockOk(0);
    const r = await tick(live, at("11:00"));
    expect(r.skipped).toBe("locked");
    expect(h.calls).toEqual([]);
    expect(h.conn.release).toHaveBeenCalledTimes(1);
  });
  it("overlapping tick in the same process is skipped running", async () => {
    let unblock!: () => void;
    h.expire.mockImplementation(() => new Promise((res) => { unblock = () => res(0); }));
    const first = tick(live, at("11:00"));
    await vi.waitFor(() => expect(h.expire).toHaveBeenCalled());
    expect((await tick(live, at("11:00"))).skipped).toBe("running");
    unblock();
    await first;
  });
  it("test mode without the test phone: skipped test_misconfigured, no step, lock released", async () => {
    const r = await tick({ ...live, QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_EMAIL: "o@x.in" } as NodeJS.ProcessEnv, at("11:00"));
    expect(r.skipped).toBe("test_misconfigured");
    expect(h.calls).toEqual([]);
    expect(h.conn.execute.mock.calls.some((c) => String(c[0]).includes("RELEASE_LOCK"))).toBe(true);
  });
});

describe("live tick", () => {
  it("runs steps in order with tag live and releases the lock", async () => {
    await tick(live, at("11:00"));
    expect(h.calls).toEqual(["expire", "sync", "stops", "email", "wa", "call"]);
    expect(h.expire.mock.calls[0][0]).toBe("live");
    expect(h.sync.mock.calls[0][0]).toBe("live");
    expect(h.stops.mock.calls[0][0]).toBe("live");
    for (const m of [h.email, h.wa, h.call]) expect(m.mock.calls[0][1]).toBe("live");
    expect(h.conn.execute.mock.calls.some((c) => String(c[0]).includes("GET_LOCK") && c[1][0] === LOCK_NAME)).toBe(true);
    expect(h.conn.execute.mock.calls.some((c) => String(c[0]).includes("RELEASE_LOCK"))).toBe(true);
    expect(h.conn.release).toHaveBeenCalledTimes(1);
  });
  it("test mode uses tag test", async () => {
    const env = { ...live, QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_PHONE: "9123456789", QUAL_FOLLOWUP_TEST_TO_EMAIL: "o@x.in" } as NodeJS.ProcessEnv;
    await tick(env, at("11:00"));
    expect(h.calls).toEqual(["expire", "sync", "stops", "email", "wa", "call"]);
    for (const m of [h.expire, h.stops]) expect(m.mock.calls[0][0]).toBe("test");
    for (const m of [h.email, h.wa, h.call]) expect(m.mock.calls[0][1]).toBe("test");
  });
  it("HE_SENDS_PAUSED: stop checks run, no email, WhatsApp or call step, no provider call", async () => {
    await tick({ ...live, HE_SENDS_PAUSED: "true" } as NodeJS.ProcessEnv, at("11:00"));
    expect(h.calls).toEqual(["expire", "sync", "stops"]);
    expect(h.emailSend).not.toHaveBeenCalled();
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(h.voice).not.toHaveBeenCalled();
  });
  it("Pinbot RED gives WhatsApp budget 0", async () => {
    await tick(live, at("11:00"), { getPinbotQuality: async () => "RED" });
    expect(h.wa.mock.calls[0][3]).toBe(0);
  });
  it("YELLOW with max 100 and 30 sent today gives budget 20", async () => {
    h.waSent.mockResolvedValue(30);
    await tick({ ...live, QUAL_FOLLOWUP_WA_DAILY_MAX: "100" } as NodeJS.ProcessEnv, at("11:00"), { getPinbotQuality: async () => "YELLOW" });
    expect(h.wa.mock.calls[0][3]).toBe(20);
  });
  it("budget never goes below 0", async () => {
    h.waSent.mockResolvedValue(900);
    await tick(live, at("11:00"), { getPinbotQuality: async () => "GREEN" });
    expect(h.wa.mock.calls[0][3]).toBe(0);
  });
  it("a throwing step does not stop the next ones", async () => {
    h.email.mockRejectedValue(new Error("smtp down"));
    await tick(live, at("11:00"));
    expect(h.wa).toHaveBeenCalled();
    expect(h.call).toHaveBeenCalled();
    expect(h.conn.release).toHaveBeenCalledTimes(1);
  });
});

describe("slots", () => {
  it("calling file runs once per slot, not outside the grace window", async () => {
    const runCallFileBatch = vi.fn(async () => ({ status: "empty" as const, rows: 0, files: 0 }));
    await tick(live, at("10:02", "2026-11-02"), { runCallFileBatch });
    await tick(live, at("10:07", "2026-11-02"), { runCallFileBatch });
    expect(runCallFileBatch).toHaveBeenCalledTimes(1);
    const late = vi.fn(async () => ({ status: "empty" as const, rows: 0, files: 0 }));
    await tick(live, at("21:00", "2026-11-03"), { runCallFileBatch: late });
    expect(late).not.toHaveBeenCalled();
  });
  it("a failed batch leaves the slot open, capped at 3 attempts", async () => {
    const runCallFileBatch = vi.fn(async () => ({ status: "failed" as const, rows: 0, files: 0, error: "smtp" }));
    for (const m of ["10:02", "10:07", "10:12", "10:17", "10:22"]) await tick(live, at(m, "2026-11-10"), { runCallFileBatch });
    expect(runCallFileBatch).toHaveBeenCalledTimes(3);
  });
  it("a failed daily report leaves the 08:30 slot open, capped at 3 attempts a day", async () => {
    const runDailyReport = vi.fn(async () => false);
    for (const m of ["08:32", "08:37", "08:42", "08:47"]) await tick(live, at(m, "2026-11-12"), { runDailyReport });
    expect(runDailyReport).toHaveBeenCalledTimes(3);
    const ok = vi.fn(async () => true);
    for (const m of ["08:32", "08:37"]) await tick(live, at(m, "2026-11-13"), { runDailyReport: ok });
    expect(ok).toHaveBeenCalledTimes(1);
  });
  it("a lock that cannot be released destroys the connection instead of pooling it", async () => {
    h.conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("RELEASE_LOCK")) throw new Error("gone");
      return String(sql).includes("GET_LOCK") ? [[{ got: 1 }]] : [[{ r: 1 }]];
    });
    await tick(live, at("11:00", "2026-11-11"));
    expect(h.conn.destroy).toHaveBeenCalledTimes(1);
    expect(h.conn.release).not.toHaveBeenCalled();
  });
  it("calling file and daily report still run while sends are paused", async () => {
    const runCallFileBatch = vi.fn(async () => ({ status: "empty" as const, rows: 0, files: 0 }));
    const runDailyReport = vi.fn(async () => true);
    const r = await tick({ ...live, HE_SENDS_PAUSED: "true" } as NodeJS.ProcessEnv, at("10:02", "2026-11-04"), { runCallFileBatch });
    expect(runCallFileBatch).toHaveBeenCalledTimes(1);
    const r2 = await tick({ ...live, HE_SENDS_PAUSED: "true" } as NodeJS.ProcessEnv, at("08:31", "2026-11-05"), { runDailyReport });
    expect(runDailyReport).toHaveBeenCalledTimes(1);
    expect(r.callFile?.status).toBe("empty");
    expect(r2.report).toBe(true);
  });
});

describe("quiet hours through the real WhatsApp step", () => {
  it("21:00 with 3 due rows: no send, no wa_status update", async () => {
    const actual = await vi.importActual<typeof import("../qualified-followup.whatsapp.js")>("../qualified-followup.whatsapp.js");
    h.wa.mockImplementation(actual.runWhatsappStep);
    const rows = [1, 2, 3].map((i) => ({ id: `id-${i}`, source_type: "he", mobile10: "9876543210", requisition_id: "r", wa_due_at: "2026-10-07 20:00:00", qualified_at: "2026-10-07 09:00:00" }));
    h.execute.mockImplementation(async (sql: string) => (String(sql).includes("FROM qualified_followup") ? [rows] : [{ affectedRows: 1 }]));
    await tick(live, at("21:00"), { getPinbotQuality: async () => "GREEN" });
    expect(h.wa).toHaveBeenCalled();
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(h.execute.mock.calls.filter((c) => /UPDATE[\s\S]*wa_status/.test(String(c[0])))).toHaveLength(0);
  });
});

describe("start and stop", () => {
  it("off: schedules nothing", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const prev = process.env.QUAL_FOLLOWUP_MODE;
    delete process.env.QUAL_FOLLOWUP_MODE;
    startQualifiedFollowupWorker();
    expect(spy).not.toHaveBeenCalled();
    if (prev !== undefined) process.env.QUAL_FOLLOWUP_MODE = prev;
  });
  it("is idempotent: two starts create one interval", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    process.env.QUAL_FOLLOWUP_MODE = "dry_run";
    try {
      startQualifiedFollowupWorker();
      startQualifiedFollowupWorker();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toBe(5 * 60 * 1000);
    } finally { delete process.env.QUAL_FOLLOWUP_MODE; }
  });
  it("a tick error never escapes the timer callback and later ticks still fire", async () => {
    vi.useFakeTimers();
    try {
      process.env.QUAL_FOLLOWUP_MODE = "live";
      h.getConnection.mockRejectedValue(new Error("db down"));
      startQualifiedFollowupWorker();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(h.getConnection).toHaveBeenCalledTimes(2);
    } finally { delete process.env.QUAL_FOLLOWUP_MODE; vi.useRealTimers(); }
  });
});
