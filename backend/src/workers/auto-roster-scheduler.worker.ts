import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";
import { autoRosterSyncedService } from "../modules/wfm/auto-roster-synced.service.js";
import { logAutoScheduleEvent } from "../modules/wfm/auto-roster-synced.service.js";

let db: any;
try {
  const dbModule = await import("../db/mysql.js");
  db = dbModule.db;
} catch {
  console.error("[AutoRosterScheduler] Database module not found — worker will not run");
  process.exit(1);
}

// ── Configuration ─────────────────────────────────────────────────────────────

const WORKER_NAME = "auto-roster-scheduler";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // poll every 6 hours, gate on day-of-week
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

let intervalRef: ReturnType<typeof setInterval> | undefined;

// ── Date helpers (local arithmetic — IST-safe, never toISOString) ─────────────

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Returns the Monday of next week (relative to today). */
function nextMonday(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // days until next Monday: if today is Mon(1) → 7, otherwise (8 - day) % 7 but clamped
  const day = today.getDay(); // 0=Sun
  const daysUntilMon = day === 1 ? 7 : (8 - day) % 7 || 7;
  today.setDate(today.getDate() + daysUntilMon);
  return localDateStr(today);
}

/** Returns the Sunday following the given Monday string. */
function sundayAfter(mondayStr: string): string {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return localDateStr(d);
}

/** ISO week number for a YYYY-MM-DD string. */
function isoWeekNum(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d.getTime() - startOfWeek1.getTime();
  return Math.floor(diff / (7 * 24 * 3600 * 1000)) + 1;
}

// ── Per-process generation ────────────────────────────────────────────────────

async function runForProcess(processId: string): Promise<void> {
  const from_date = nextMonday();
  const to_date   = sundayAfter(from_date);
  const weekNum   = isoWeekNum(from_date);

  // Idempotency — skip if a plan already exists for this process+week
  const [existing]: any = await db.execute(
    `SELECT COUNT(*) AS cnt FROM wfm_roster_plan
     WHERE process_id = ? AND from_date = ? AND to_date = ?`,
    [processId, from_date, to_date]
  );
  if (Number(existing[0]?.cnt ?? 0) > 0) {
    console.log(`[AutoRosterScheduler] Plan already exists for process ${processId} ${from_date}–${to_date}, skipping`);
    return;
  }

  // Copy-forward slot requirements from last week (a flat 7-day shift, not "the
  // equivalent week last year" as this comment used to claim — prevMonday below is
  // from_date minus 7 days, nothing year-scale)
  // (date-specific rows only — rows with requirement_date IS NULL are DOW templates that already apply)
  const prevMonday = (() => {
    const d = new Date(from_date + "T00:00:00");
    d.setDate(d.getDate() - 7);
    return localDateStr(d);
  })();
  const prevSunday = sundayAfter(prevMonday);

  try {
    // The columns are slot_start and slot_end, and there is no notes column on
     // this table at all, so this statement has never copied a single row - it
     // raised ER_BAD_FIELD_ERROR straight into the warn below.
     //
     // active_status is NOT deliberately carried forward, by decision on
     // 2026-08-12: this stays a strictly name-only fix of the original statement.
     // The column is NOT NULL DEFAULT 1, so a slot requirement that was
     // deactivated last week is copied forward as active again. That is a known
     // consequence, not an oversight.
    await db.execute(
      `INSERT IGNORE INTO wfm_client_slot_requirement
         (id, process_id, branch_id, requirement_date, day_of_week,
          slot_start, slot_end, required_hc, shrinkage_pct, created_at)
       SELECT UUID(), process_id, branch_id,
              DATE_ADD(requirement_date, INTERVAL 7 DAY),
              day_of_week, slot_start, slot_end,
              required_hc, shrinkage_pct, NOW()
       FROM wfm_client_slot_requirement
       WHERE process_id = ?
         AND requirement_date IS NOT NULL
         AND requirement_date BETWEEN ? AND ?`,
      [processId, prevMonday, prevSunday]
    );
  } catch (err: any) {
    // Non-fatal — generation can still run from DOW template rows
    console.warn(`[AutoRosterScheduler] Copy-forward slot requirements failed for ${processId}: ${err.message}`);
  }

  // Fetch process name for the plan label
  let processName = processId.substring(0, 8);
  try {
    // process_master has no `name` column - it is process_name. This threw into
     // the empty catch below, so every generated plan was labelled with the first
     // 8 characters of a UUID instead of the process it belongs to.
    const [pRows]: any = await db.execute(
      `SELECT process_name FROM process_master WHERE id = ? LIMIT 1`,
      [processId]
    );
    if (pRows?.[0]?.process_name) processName = pRows[0].process_name as string;
  } catch { /* non-fatal */ }

  const plan_name = `Auto W${weekNum} ${processName}`;

  const planRaw = await autoRosterSyncedService.createPlan(
    { plan_name, process_id: processId, from_date, to_date, shrinkage_pct: 20 },
    SYSTEM_ACTOR
  ) as Record<string, any>;
  const planId = planRaw.id as string;

  const result = await autoRosterSyncedService.generateDraft(planId, SYSTEM_ACTOR);

  await logAutoScheduleEvent({
    plan_id: planId,
    process_id: processId,
    event_type: "auto_scheduled_generation",
    event_title: "Auto-generated",
    event_message: `Scheduled draft for ${from_date}–${to_date}: ${result.created} assignments, coverage ${result.coverage_score}%`,
    severity: result.open_critical_gaps > 0 ? "high" : "info",
  });

  console.log(
    `[AutoRosterScheduler] ✓ ${processName} | ${from_date}–${to_date} | ` +
    `${result.created} assigned | coverage ${result.coverage_score}% | ` +
    `${result.open_critical_gaps} critical gaps`
  );
}

// ── Check and run ─────────────────────────────────────────────────────────────

async function checkAndRun(): Promise<void> {
  if (!(await isWorkerEnabled(WORKER_NAME))) {
    console.log(`[AutoRosterScheduler] Disabled via worker_config — skipping`);
    return;
  }

  const todayDow = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  let eligibleProcesses: { process_id: string }[];
  try {
    const [rows]: any = await db.execute(
      `SELECT DISTINCT process_id FROM wfm_process_planning_rule
       WHERE is_active = 1
         AND auto_schedule_enabled = 1
         AND auto_schedule_day_of_week = ?`,
      [todayDow]
    );
    eligibleProcesses = rows ?? [];
  } catch (err: any) {
    console.error(`[AutoRosterScheduler] Failed to query eligible processes: ${err.message}`);
    return;
  }

  if (eligibleProcesses.length === 0) {
    console.log(`[AutoRosterScheduler] No processes configured for DOW ${todayDow} — nothing to do`);
    return;
  }

  console.log(`[AutoRosterScheduler] Running for ${eligibleProcesses.length} process(es) on DOW ${todayDow}`);

  for (const { process_id } of eligibleProcesses) {
    try {
      await runForProcess(process_id);
    } catch (err: any) {
      console.error(`[AutoRosterScheduler] Failed for process ${process_id}: ${err.message}`);
      // Continue — one process failure must not block others
    }
  }

  await markWorkerRun(WORKER_NAME);
}

// ── Start / Stop ─────────────────────────────────────────────────────────────

async function startWorker(): Promise<void> {
  console.log("[AutoRosterScheduler] Starting — check interval 6h, gated on auto_schedule_day_of_week");
  await checkAndRun();
  intervalRef = setInterval(async () => {
    await checkAndRun();
  }, CHECK_INTERVAL_MS);
}

function stopWorker(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log("[AutoRosterScheduler] Stopped");
}

export { startWorker as startAutoRosterSchedulerWorker, stopWorker as stopAutoRosterSchedulerWorker };

// Allow standalone execution for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  await startWorker();
}
