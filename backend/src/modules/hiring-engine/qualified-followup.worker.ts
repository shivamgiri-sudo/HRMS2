/**
 * Follow-up pipeline worker: one 5-minute tick that stops finished rows, then runs the email, WhatsApp and call steps.
 * Does nothing (not even a query) while QUAL_FOLLOWUP_MODE is off. A MySQL advisory lock keeps two processes from ticking together.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emptyCounts, type CallFileResult, type StepCounts } from "./qualified-followup.context.js";
import { readSwitches, rowTag, type FollowupSwitches, type RowTag } from "./qualified-followup.policy.js";
import { CALL_FILE_SLOTS, DAILY_REPORT_SLOTS, dueSlot, waDailyBudget, type PinbotQuality } from "./qualified-followup.rules.js";
import { expireStaleClaims, runStopChecks, syncWaReceipts } from "./qualified-followup.stops.js";
import { runEmailStep } from "./qualified-followup.email.js";
import { pipelineWaSentToday, runWhatsappStep } from "./qualified-followup.whatsapp.js";
import { runCallStep } from "./qualified-followup.call.js";
import { runCallFileBatch } from "./qualified-followup.callfile.js";
import { getPinbotQuality } from "./he-pinbot-quality.service.js";
import { runDailyReport } from "./qualified-followup.report.js";
import type { FollowupMode } from "./qualified-followup.types.js";

export const LOCK_NAME = "qualified_followup_tick";
const INTERVAL_MS = 5 * 60 * 1000;

export interface TickReport {
  mode: FollowupMode;
  skipped?: "off" | "running" | "locked" | "test_misconfigured";
  stops: number;
  email: StepCounts;
  whatsapp: StepCounts;
  call: StepCounts;
  callFile: CallFileResult | null;
  report: boolean;
}

export interface TickDeps {
  runCallFileBatch: (s: FollowupSwitches, tag: RowTag, now: Date) => Promise<CallFileResult>;
  runDailyReport: (s: FollowupSwitches, tag: RowTag, now: Date) => Promise<boolean>;
  getPinbotQuality: () => Promise<PinbotQuality | null>;
}

const defaultDeps: TickDeps = {
  runCallFileBatch,
  runDailyReport,
  getPinbotQuality,
};

// Slot keys are kept in memory: a restart inside the grace window can repeat one calling file or report.
const doneCallSlots = new Set<string>();
const doneReportSlots = new Set<string>();
// A failed batch retries on the next tick, at most this many times per slot, so an outage cannot create a batch row every 5 minutes.
const MAX_FILE_ATTEMPTS = 3;
const fileAttempts = new Map<string, number>();
const reportAttempts = new Map<string, number>();

// Last few daily-report outcomes (counts and slot keys only), kept in memory like the slots: empty after a restart.
const reportOutcomes = new Map<string, { slot: string; ok: boolean; tries: number }>();
const REPORT_KEEP = 5;
function noteReport(slot: string, ok: boolean, tries: number): void {
  reportOutcomes.set(slot, { slot, ok, tries });
  while (reportOutcomes.size > REPORT_KEEP) reportOutcomes.delete([...reportOutcomes.keys()].sort()[0]);
}
/** Read-only view for the status route: the last 5 report slots this process ran, newest first. */
export function followupWorkerStatus(): { running: boolean; reports: Array<{ slot: string; ok: boolean; tries: number }> } {
  return { running: timer !== undefined, reports: [...reportOutcomes.values()].sort((a, b) => (a.slot < b.slot ? 1 : -1)).map((r) => ({ ...r })) };
}

let running = false;
let timer: NodeJS.Timeout | undefined;

async function guarded<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.error({ step: name, err: (err as Error).message }, "[qualified-followup] step failed");
    return fallback;
  }
}

function blank(mode: FollowupMode, skipped?: TickReport["skipped"]): TickReport {
  return { mode, skipped, stops: 0, email: emptyCounts(), whatsapp: emptyCounts(), call: emptyCounts(), callFile: null, report: false };
}

export async function runQualifiedFollowupTick(o: { env?: NodeJS.ProcessEnv; now?: Date; deps?: Partial<TickDeps> } = {}): Promise<TickReport> {
  const s = readSwitches(o.env ?? process.env);
  if (s.mode === "off") return blank("off", "off");
  if (running) return blank(s.mode, "running");
  running = true;
  let conn: PoolConnection | undefined;
  let locked = false;
  let lockStuck = false;
  try {
    conn = await db.getConnection();
    const [lr] = await conn.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [LOCK_NAME]);
    if (Number(lr[0]?.got) !== 1) return blank(s.mode, "locked");
    locked = true;
    const tag = rowTag(s);
    if (!tag) return blank("off", "off");
    if (s.testMisconfigured) {
      logger.error("[qualified-followup] test mode needs QUAL_FOLLOWUP_TEST_TO_PHONE and QUAL_FOLLOWUP_TEST_TO_EMAIL; tick skipped");
      return blank(s.mode, "test_misconfigured");
    }
    return await runSteps(s, tag, o.now ?? new Date(), { ...defaultDeps, ...o.deps });
  } finally {
    try {
      if (conn && locked) await conn.execute("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    } catch (err) {
      lockStuck = true;
      logger.warn({ err: (err as Error).message }, "[qualified-followup] release lock failed");
    }
    // A connection that may still hold the advisory lock must not go back to the pool.
    if (lockStuck) conn?.destroy(); else conn?.release();
    running = false;
  }
}

async function runSteps(s: FollowupSwitches, tag: RowTag, now: Date, deps: TickDeps): Promise<TickReport> {
  const r = blank(s.mode);
  await guarded("expire", () => expireStaleClaims(tag, now), 0);
  await guarded("receipts", () => syncWaReceipts(tag), 0);
  const stopped = await guarded("stops", () => runStopChecks(tag), null);
  r.stops = stopped ? Object.values(stopped.stopped).reduce<number>((a, n) => a + (n ?? 0), 0) : 0;

  if (!s.sendsPaused) {
    r.email = await guarded("email", () => runEmailStep(s, tag, now), emptyCounts());
    r.whatsapp = await guarded("whatsapp", async () => {
      const budget = waDailyBudget(await deps.getPinbotQuality(), s.waDailyMax) - (await pipelineWaSentToday(tag, now));
      return runWhatsappStep(s, tag, now, Math.max(0, budget));
    }, emptyCounts());
    r.call = await guarded("call", () => runCallStep(s, tag, now), emptyCounts());
  }

  // Both only email the owner, so they run while sends are paused.
  const fileSlot = dueSlot(now, CALL_FILE_SLOTS, doneCallSlots);
  if (fileSlot) {
    r.callFile = await guarded("call-file", async () => {
      const tries = (fileAttempts.get(fileSlot) ?? 0) + 1;
      fileAttempts.set(fileSlot, tries);
      const res = await deps.runCallFileBatch(s, tag, now);
      if (res.status !== "failed" || tries >= MAX_FILE_ATTEMPTS) doneCallSlots.add(fileSlot);
      return res;
    }, null);
  }
  const reportSlot = dueSlot(now, DAILY_REPORT_SLOTS, doneReportSlots);
  if (reportSlot) {
    const tries = (reportAttempts.get(reportSlot) ?? 0) + 1;
    reportAttempts.set(reportSlot, tries);
    // A failed report leaves the slot open for the next tick, capped like the calling file.
    r.report = await guarded("report", () => deps.runDailyReport(s, tag, now), false);
    if (r.report || tries >= MAX_FILE_ATTEMPTS) doneReportSlots.add(reportSlot);
    noteReport(reportSlot, r.report, tries);
  }
  logger.info({ mode: s.mode, tag, stops: r.stops, email: r.email, whatsapp: r.whatsapp, call: r.call }, "[qualified-followup] tick");
  return r;
}

export function startQualifiedFollowupWorker(): void {
  if (timer) return;
  if (readSwitches().mode === "off") return;
  timer = setInterval(() => {
    runQualifiedFollowupTick().catch((err) => logger.error({ err: (err as Error).message }, "[qualified-followup] tick failed"));
  }, INTERVAL_MS);
  timer.unref();
}

export function stopQualifiedFollowupWorker(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
