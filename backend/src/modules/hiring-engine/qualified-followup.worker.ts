/**
 * Follow-up pipeline worker: one 5-minute tick that stops finished rows, then runs the email, WhatsApp and call steps.
 * Does nothing (not even a query) while QUAL_FOLLOWUP_MODE is off. A MySQL advisory lock keeps two processes from ticking together.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emptyCounts, type CallFileResult, type StepCounts } from "./qualified-followup.context.js";
import { loadFollowupSwitches, readSwitches, tickPlan, type FollowupSwitches, type RowTag } from "./qualified-followup.policy.js";
import { DAILY_REPORT_SLOTS, dueSlot, waDailyBudget, type PinbotQuality } from "./qualified-followup.rules.js";
import { expireStaleClaims, runStopChecks, syncWaReceipts } from "./qualified-followup.stops.js";
import { runEmailStep } from "./qualified-followup.email.js";
import { EMAIL_BUTTONS_OFF, loadEmailButtonSwitches } from "./email-buttons.policy.js";
import { runWhatsappStep } from "./qualified-followup.whatsapp.js";
import { sharedWaSentToday } from "./followup-guards.service.js";
import { newBudget, type StepScope } from "./qualified-followup.stagea.js";
import { runStageB } from "./qualified-followup.stageb.js";
import { runCallStep } from "./qualified-followup.call.js";
import { loadCallFileConfig, runCallFileBatch } from "./qualified-followup.callfile.js";
import type { CallFileConfig } from "./qualified-followup.callfile-plan.js";
import { getPinbotQuality } from "./he-pinbot-quality.service.js";
import { runDailyReport } from "./qualified-followup.report.js";
import { pullPortalResults } from "./superbot-portal.sync.js";
import type { FollowupMode, SourceType } from "./qualified-followup.types.js";

export const LOCK_NAME = "qualified_followup_tick";
const INTERVAL_MS = 5 * 60 * 1000;
const FIRST_TICK_MS = 30 * 1000;
/** The portal call list is read at most once an hour (calls are made around the clock inside the bot's own 9-9 window). */
const PORTAL_PULL_MS = 60 * 60 * 1000;
let lastPortalPullAt = 0;

export interface TickReport {
  mode: FollowupMode;
  skipped?: "off" | "running" | "locked" | "test_misconfigured" | "no_sources";
  stops: number;
  email: StepCounts;
  whatsapp: StepCounts;
  call: StepCounts;
  callFile: CallFileResult | null;
  report: boolean;
  /** Per row tag run this tick (the step totals above are their sums). */
  byTag: Partial<Record<RowTag, { sources: SourceType[]; email: StepCounts; whatsapp: StepCounts; call: StepCounts }>>;
}

export interface TickDeps {
  loadSwitches: (env: NodeJS.ProcessEnv) => Promise<FollowupSwitches>;
  sharedWaSentToday: (now: Date) => Promise<number>;
  /** Stage B (Task 11) runs before stage A in each tag pass, on the same budget. */
  runStageB: (s: FollowupSwitches, tag: RowTag, now: Date, o: StepScope) => Promise<unknown>;
  runCallFileBatch: (s: FollowupSwitches, tag: RowTag, now: Date, o: { slotKey: string; config: CallFileConfig }) => Promise<CallFileResult>;
  callFileConfig: () => Promise<CallFileConfig>;
  runDailyReport: (s: FollowupSwitches, tag: RowTag, now: Date, quality: PinbotQuality | null) => Promise<boolean>;
  getPinbotQuality: () => Promise<PinbotQuality | null>;
}

const defaultDeps: TickDeps = {
  loadSwitches: (env) => loadFollowupSwitches(env),
  sharedWaSentToday,
  runStageB: (s, tag, now, o) => runStageB(s, tag, now, o),
  runCallFileBatch,
  callFileConfig: () => loadCallFileConfig(),
  runDailyReport,
  getPinbotQuality,
};

// Slot keys are kept in memory; the calling file also claims its slot in the database (uq_qfcb_slot), so a restart or a second process
// cannot send a second file for the same slot. The daily report has only the in-memory guard.
const doneCallSlots = new Map<string, Set<string>>(); // per row tag
const doneSlotsFor = (tag: RowTag) => { let d = doneCallSlots.get(tag); if (!d) doneCallSlots.set(tag, (d = new Set())); return d; };
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
  return { mode, skipped, stops: 0, email: emptyCounts(), whatsapp: emptyCounts(), call: emptyCounts(), callFile: null, report: false, byTag: {} };
}

export async function runQualifiedFollowupTick(o: { env?: NodeJS.ProcessEnv; now?: Date; deps?: Partial<TickDeps> } = {}): Promise<TickReport> {
  const env = o.env ?? process.env;
  const ceiling = readSwitches(env);
  if (ceiling.mode === "off") return blank("off", "off");
  if (running) return blank(ceiling.mode, "running");
  running = true;
  let conn: PoolConnection | undefined;
  let locked = false;
  let lockStuck = false;
  try {
    conn = await db.getConnection();
    const [lr] = await conn.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [LOCK_NAME]);
    if (Number(lr[0]?.got) !== 1) return blank(ceiling.mode, "locked");
    locked = true;
    const deps = { ...defaultDeps, ...o.deps };
    const s = await deps.loadSwitches(env);
    let plan = tickPlan(s);
    if (s.testMisconfigured && plan.some((p) => p.tag === "test")) {
      logger.error("[qualified-followup] test mode needs QUAL_FOLLOWUP_TEST_TO_PHONE and QUAL_FOLLOWUP_TEST_TO_EMAIL; test rows skipped");
      plan = plan.filter((p) => p.tag !== "test");
      if (!plan.length) return blank(s.mode, "test_misconfigured");
    }
    // Every source off on the screen: rows are frozen (nothing selected, sent or stopped) until a source is switched on.
    if (!plan.length) return blank(s.mode, "no_sources");
    return await runSteps(s, plan, o.now ?? new Date(), deps);
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

const add = (a: StepCounts, b: StepCounts): StepCounts =>
  ({ processed: a.processed + b.processed, sent: a.sent + b.sent, failed: a.failed + b.failed, blocked: a.blocked + b.blocked, held: a.held + b.held, dryRun: a.dryRun + b.dryRun });

async function runSteps(s: FollowupSwitches, plan: Array<{ tag: RowTag; sources: SourceType[] }>, now: Date, deps: TickDeps): Promise<TickReport> {
  const r = blank(s.mode);
  // One shared WhatsApp budget for the Pinbot number: every unprompted send today by any mechanism counts (D10).
  const budget = newBudget(await guarded("budget", async () => waDailyBudget(await deps.getPinbotQuality(), s.waDailyMax) - (await deps.sharedWaSentToday(now)), 0));
  for (const { tag, sources } of plan) {
    await guarded("expire", () => expireStaleClaims(tag, now), 0);
    await guarded("receipts", () => syncWaReceipts(tag), 0);
    const stopped = await guarded("stops", () => runStopChecks(tag), null);
    r.stops += stopped ? Object.values(stopped.stopped).reduce<number>((a, n) => a + (n ?? 0), 0) : 0;
    const scope: StepScope = { sources, budget };
    const t = { sources, email: emptyCounts(), whatsapp: emptyCounts(), call: emptyCounts() };
    // The kill switch stops sends only; stops and receipts above still run. dry_run never sends, so it keeps its shadow.
    if (!(s.killSwitch || s.sendsPaused) || tag === "dry_run") {
      await guarded("stage-b", () => deps.runStageB(s, tag, now, scope), null);
      // Answer-button switches are read once per tag pass (not per row), and not at all for dry_run rows (no email is sent).
      t.email = await guarded("email", async () => runEmailStep(s, tag, now, scope, tag === "dry_run" ? EMAIL_BUTTONS_OFF : await loadEmailButtonSwitches()), emptyCounts());
      t.whatsapp = await guarded("whatsapp", () => runWhatsappStep(s, tag, now, scope), emptyCounts());
      t.call = await guarded("call", () => runCallStep(s, tag, now, scope), emptyCounts());
    }
    r.byTag[tag] = t;
    r.email = add(r.email, t.email); r.whatsapp = add(r.whatsapp, t.whatsapp); r.call = add(r.call, t.call);
  }

  // Both only email the owner, so they run while sends are paused. One calling file per tag and slot; one report (the first tag).
  const config = await guarded("call-file-config", () => deps.callFileConfig(), null);
  for (const { tag } of plan) {
    const fileSlot = config ? dueSlot(now, config.slots, doneSlotsFor(tag)) : null;
    if (fileSlot && config) {
      const key = `${tag}|${fileSlot}`;
      r.callFile = await guarded("call-file", async () => {
        const tries = (fileAttempts.get(key) ?? 0) + 1;
        fileAttempts.set(key, tries);
        const res = await deps.runCallFileBatch(s, tag, now, { slotKey: fileSlot, config });
        if (res.status !== "failed" || tries >= MAX_FILE_ATTEMPTS) doneSlotsFor(tag).add(fileSlot);
        return res;
      }, null);
    }
  }
  const reportSlot = dueSlot(now, DAILY_REPORT_SLOTS, doneReportSlots);
  if (reportSlot) {
    const tries = (reportAttempts.get(reportSlot) ?? 0) + 1;
    reportAttempts.set(reportSlot, tries);
    // A failed report leaves the slot open for the next tick, capped like the calling file.
    // One report for every tag: the pipeline-row table is the first tag's, the unified sections cover all tags.
    r.report = await guarded("report", async () => deps.runDailyReport(s, plan[0].tag, now, await deps.getPinbotQuality().catch(() => null)), false);
    if (r.report || tries >= MAX_FILE_ATTEMPTS) doneReportSlots.add(reportSlot);
    noteReport(reportSlot, r.report, tries);
  }
  logger.info({ mode: s.mode, plan: plan.map((p) => `${p.tag}:${p.sources.join("+")}`), stops: r.stops, email: r.email, whatsapp: r.whatsapp, call: r.call, callFile: r.callFile }, "[qualified-followup] tick");
  return r;
}

export function startQualifiedFollowupWorker(): void {
  if (timer) return;
  if (readSwitches().mode === "off") return;
  const pull = () => { if (Date.now() - lastPortalPullAt < PORTAL_PULL_MS) return; lastPortalPullAt = Date.now(); pullPortalResults().catch((err) => logger.warn({ err: (err as Error).message }, "[superbot] results pull failed")); };
  const tick = () => { pull(); return runQualifiedFollowupTick().catch((err) => logger.error({ err: (err as Error).message }, "[qualified-followup] tick failed")); };
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  // A restart (a deploy or an env change) must not starve the pipeline for a whole interval: first tick shortly after start.
  const first = setTimeout(tick, FIRST_TICK_MS);
  first.unref();
}

export function stopQualifiedFollowupWorker(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
