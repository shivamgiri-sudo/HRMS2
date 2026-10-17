/**
 * Lock watchdog: finds the transaction that is making others wait, and ends it when that is safe.
 *
 * Two different problems share the word "deadlock":
 *   1. A true deadlock (A waits for B, B waits for A). InnoDB detects this in milliseconds and kills one side itself.
 *      Nothing here can or should do that; the fix is that the application retries (see shared/deadlockRetry.ts)
 *      and lock-telemetry.ts names the statements so they can be fixed at the source.
 *   2. A stuck lock holder: a transaction that took row locks and then went quiet (a request that died between
 *      BEGIN and COMMIT, an await that never returned). Every writer on those rows queues behind it until the 30 s
 *      lock-wait timeout, then fails with "unexpected server error". InnoDB will never resolve this on its own.
 *      This is what the watchdog kills.
 *
 * Policy (conservative on purpose, because KILL rolls the victim back):
 *   - Only connections owned by our own DB user in our own schema are ever killed.
 *   - An IDLE blocker (connection is Sleep, i.e. nobody is executing anything) that has kept a waiter waiting for
 *     DB_LOCK_IDLE_BLOCKER_S (default 15) is killed. Nothing is running on it, so nothing useful is lost.
 *   - An ACTIVE blocker (a query is running) is only alerted on, unless DB_LOCK_KILL_ACTIVE=true and it has been open
 *     for DB_LOCK_ACTIVE_AGE_S (default 180) with a waiter at DB_LOCK_ACTIVE_WAIT_S (default 25). A payroll run or a
 *     bulk import must not be shot because it is slow.
 *   - DDL (ALTER/CREATE/DROP/...) is never killed.
 *   - At most DB_LOCK_MAX_KILLS_PER_SWEEP (3) per sweep and DB_LOCK_MAX_KILLS_PER_HOUR (30) overall.
 * DB_LOCK_WATCHDOG_MODE: "kill" (default) | "observe" (record and log only) | "off".
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export type WatchdogMode = "kill" | "observe" | "off";
export type WatchdogAction = "killed" | "alerted" | "skipped";

export interface WatchdogConfig {
  mode: WatchdogMode;
  ownUser: string;
  ownSchema: string;
  idleBlockerS: number;
  killActive: boolean;
  activeAgeS: number;
  activeWaitS: number;
  maxKillsPerSweep: number;
  maxKillsPerHour: number;
}

export interface BlockerRow {
  blockerThread: number;
  blockerUser: string | null;
  blockerDb: string | null;
  blockerCommand: string | null; // processlist COMMAND: 'Sleep' means nothing is executing
  blockerAgeS: number;
  blockerState: string | null;
  blockerQuery: string | null;
  waiterThread: number;
  waitedS: number;
}

export interface PlannedAction {
  thread: number;
  action: WatchdogAction;
  reason: string;
  user: string | null;
  ageS: number;
  state: string | null;
  query: string | null;
  waiters: number;
  maxWaitS: number;
}

const DDL = /^\s*(alter|create|drop|truncate|optimize|analyze|rename|repair)\b/i;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadWatchdogConfig(env: NodeJS.ProcessEnv = process.env): WatchdogConfig {
  const raw = String(env.DB_LOCK_WATCHDOG_MODE ?? "kill").toLowerCase();
  return {
    mode: raw === "off" || raw === "observe" ? raw : "kill",
    ownUser: env.DB_USER ?? "",
    ownSchema: env.DB_NAME ?? "",
    idleBlockerS: num(env.DB_LOCK_IDLE_BLOCKER_S, 15),
    killActive: String(env.DB_LOCK_KILL_ACTIVE ?? "false").toLowerCase() === "true",
    activeAgeS: num(env.DB_LOCK_ACTIVE_AGE_S, 180),
    activeWaitS: num(env.DB_LOCK_ACTIVE_WAIT_S, 25),
    maxKillsPerSweep: num(env.DB_LOCK_MAX_KILLS_PER_SWEEP, 3),
    maxKillsPerHour: num(env.DB_LOCK_MAX_KILLS_PER_HOUR, 30),
  };
}

/** Pure decision step. `killsThisHour` is how many connections this process already killed in the last hour. */
export function planActions(
  rows: BlockerRow[],
  cfg: WatchdogConfig,
  opts: { ownThread?: number; killsThisHour?: number } = {},
): PlannedAction[] {
  if (cfg.mode === "off") return [];
  const byBlocker = new Map<number, BlockerRow[]>();
  for (const r of rows) {
    const list = byBlocker.get(r.blockerThread);
    if (list) list.push(r); else byBlocker.set(r.blockerThread, [r]);
  }

  const plan: PlannedAction[] = [];
  let sweepKills = 0;
  let hourKills = opts.killsThisHour ?? 0;
  // Longest-waiting first, so the cap spends its kills where users are hurting most.
  const groups = [...byBlocker.values()].sort(
    (a, b) => Math.max(...b.map((r) => r.waitedS)) - Math.max(...a.map((r) => r.waitedS)),
  );

  for (const group of groups) {
    const head = group[0];
    const maxWaitS = Math.max(...group.map((r) => r.waitedS));
    const base = {
      thread: head.blockerThread, user: head.blockerUser, ageS: head.blockerAgeS, state: head.blockerState,
      query: head.blockerQuery, waiters: new Set(group.map((r) => r.waiterThread)).size, maxWaitS,
    };
    const idle = (head.blockerCommand ?? "").toLowerCase() === "sleep";

    if (head.blockerThread === opts.ownThread) { plan.push({ ...base, action: "skipped", reason: "own connection" }); continue; }
    if (head.blockerUser !== cfg.ownUser || head.blockerDb !== cfg.ownSchema) {
      plan.push({ ...base, action: "skipped", reason: "not our user/schema; alert only" });
      continue;
    }
    if (head.blockerQuery && DDL.test(head.blockerQuery)) {
      plan.push({ ...base, action: "alerted", reason: "DDL is never killed" });
      continue;
    }

    let wantKill = false;
    let reason = "";
    if (idle && maxWaitS >= cfg.idleBlockerS) {
      wantKill = true;
      reason = `idle in transaction, holding locks that blocked ${base.waiters} waiter(s) for ${maxWaitS}s`;
    } else if (!idle && cfg.killActive && head.blockerAgeS >= cfg.activeAgeS && maxWaitS >= cfg.activeWaitS) {
      wantKill = true;
      reason = `active for ${head.blockerAgeS}s, blocking ${base.waiters} waiter(s) for ${maxWaitS}s (DB_LOCK_KILL_ACTIVE)`;
    } else if (maxWaitS >= cfg.idleBlockerS) {
      plan.push({ ...base, action: "alerted", reason: idle ? "below kill threshold" : "active query; not killed (DB_LOCK_KILL_ACTIVE off or too young)" });
      continue;
    } else {
      continue; // short wait: normal contention, not worth a record
    }

    if (cfg.mode === "observe") { plan.push({ ...base, action: "alerted", reason: `observe mode, would kill: ${reason}` }); continue; }
    if (sweepKills >= cfg.maxKillsPerSweep || hourKills >= cfg.maxKillsPerHour) {
      plan.push({ ...base, action: "alerted", reason: `kill limit reached, would kill: ${reason}` });
      continue;
    }
    sweepKills += 1; hourKills += 1;
    plan.push({ ...base, action: "killed", reason });
  }
  return plan;
}

interface RawRow extends RowDataPacket {
  blocker_thread: number; blocker_user: string | null; blocker_db: string | null; blocker_command: string | null;
  blocker_age_s: number; blocker_state: string | null; blocker_query: string | null; waiter_thread: number; waited_s: number;
}

const BLOCKERS_SQL = `
  SELECT b.trx_mysql_thread_id AS blocker_thread, pl.USER AS blocker_user, pl.DB AS blocker_db,
         pl.COMMAND AS blocker_command, TIMESTAMPDIFF(SECOND, b.trx_started, NOW()) AS blocker_age_s,
         b.trx_state AS blocker_state, LEFT(b.trx_query, 500) AS blocker_query,
         r.trx_mysql_thread_id AS waiter_thread, TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS waited_s
    FROM performance_schema.data_lock_waits w
    JOIN information_schema.innodb_trx r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
    JOIN information_schema.innodb_trx b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID
    LEFT JOIN information_schema.PROCESSLIST pl ON pl.ID = b.trx_mysql_thread_id`;

export type BlockerSource = "performance_schema" | "information_schema";

interface TrxRow extends RowDataPacket {
  thread: number; state: string; age_s: number; waited_s: number | null; rows_locked: number; rows_modified: number;
  query: string | null; user: string | null; db: string | null; command: string | null;
}

const TRX_SQL = `
  SELECT t.trx_mysql_thread_id AS thread, t.trx_state AS state,
         TIMESTAMPDIFF(SECOND, t.trx_started, NOW()) AS age_s,
         TIMESTAMPDIFF(SECOND, t.trx_wait_started, NOW()) AS waited_s,
         t.trx_rows_locked AS rows_locked, t.trx_rows_modified AS rows_modified, LEFT(t.trx_query, 500) AS query,
         pl.USER AS user, pl.DB AS db, pl.COMMAND AS command
    FROM information_schema.innodb_trx t
    LEFT JOIN information_schema.PROCESSLIST pl ON pl.ID = t.trx_mysql_thread_id`;

/**
 * Fallback for servers where the app user cannot read performance_schema.data_lock_waits (production, 2026-10-17:
 * "SELECT command denied ... for table 'data_lock_waits'"). innodb_trx only needs PROCESS, which db-health already uses.
 * It says who WAITS but not who they wait FOR, so the holder is inferred: a transaction that holds row locks, is not
 * itself waiting, and started before the waiter began waiting. planActions still only kills such a holder when it is
 * IDLE (Sleep), so an inference error can at worst end an idle connection that was holding locks for no reason.
 */
export function inferBlockers(trx: Array<{
  thread: number; state: string; ageS: number; waitedS: number; rowsLocked: number; rowsModified: number;
  query: string | null; user: string | null; db: string | null; command: string | null;
}>): BlockerRow[] {
  const waiters = trx.filter((t) => t.state === "LOCK WAIT" && t.waitedS > 0);
  const waiterThreads = new Set(waiters.map((w) => w.thread));
  const holders = trx.filter((t) => t.state !== "LOCK WAIT" && !waiterThreads.has(t.thread) && (t.rowsLocked > 0 || t.rowsModified > 0));
  const out: BlockerRow[] = [];
  for (const w of waiters) {
    for (const h of holders) {
      if (h.ageS < w.waitedS) continue; // holder began after the waiter started waiting: cannot be what it waits for
      out.push({
        blockerThread: h.thread, blockerUser: h.user, blockerDb: h.db, blockerCommand: h.command, blockerAgeS: h.ageS,
        blockerState: h.state, blockerQuery: h.query, waiterThread: w.thread, waitedS: w.waitedS,
      });
    }
  }
  return out;
}

async function readBlockersInferred(pool: Pool): Promise<BlockerRow[]> {
  const [rows] = await pool.query<TrxRow[]>(TRX_SQL);
  return inferBlockers(rows.map((r) => ({
    thread: Number(r.thread), state: String(r.state), ageS: Number(r.age_s ?? 0), waitedS: Number(r.waited_s ?? 0),
    rowsLocked: Number(r.rows_locked ?? 0), rowsModified: Number(r.rows_modified ?? 0),
    query: r.query, user: r.user, db: r.db, command: r.command,
  })));
}

async function readBlockersPrecise(pool: Pool): Promise<BlockerRow[]> {
  const [rows] = await pool.query<RawRow[]>(BLOCKERS_SQL);
  return rows.map((r) => ({
    blockerThread: Number(r.blocker_thread), blockerUser: r.blocker_user, blockerDb: r.blocker_db,
    blockerCommand: r.blocker_command, blockerAgeS: Number(r.blocker_age_s ?? 0), blockerState: r.blocker_state,
    blockerQuery: r.blocker_query, waiterThread: Number(r.waiter_thread), waitedS: Math.max(0, Number(r.waited_s ?? 0)),
  }));
}

/** Exact answer from performance_schema when allowed, otherwise the inferred one from information_schema. */
export async function readBlockers(pool: Pool): Promise<BlockerRow[]> {
  return (await readBlockersWithSource(pool)).rows;
}

export async function readBlockersWithSource(pool: Pool): Promise<{ rows: BlockerRow[]; source: BlockerSource; note?: string }> {
  try {
    return { rows: await readBlockersPrecise(pool), source: "performance_schema" };
  } catch (preciseErr) {
    const note = preciseErr instanceof Error ? preciseErr.message : String(preciseErr);
    return { rows: await readBlockersInferred(pool), source: "information_schema", note };
  }
}

// ── runtime state ────────────────────────────────────────────────────────────
const killLog: number[] = [];           // epoch ms of recent kills, for the hourly cap
const alertedAt = new Map<number, number>(); // thread -> last alert, so one stuck query is not recorded every 15 s
const ALERT_REPEAT_MS = 5 * 60_000;

export interface SweepResult { actions: PlannedAction[]; error?: string; source?: BlockerSource }

export async function sweepOnce(pool: Pool, cfg: WatchdogConfig = loadWatchdogConfig(), now = Date.now()): Promise<SweepResult> {
  if (cfg.mode === "off") return { actions: [] };
  while (killLog.length && now - killLog[0] > 3_600_000) killLog.shift();
  let rows: BlockerRow[];
  let source: BlockerSource = "performance_schema";
  try {
    ({ rows, source } = await readBlockersWithSource(pool));
  } catch (err) {
    // No access to performance_schema / information_schema on this server: report once per sweep, do nothing.
    return { actions: [], error: err instanceof Error ? err.message : String(err) };
  }
  if (rows.length === 0) return { actions: [] };

  const conn = await pool.getConnection();
  try {
    const ownThread = (conn as unknown as { threadId?: number }).threadId;
    const plan = planActions(rows, cfg, { ownThread, killsThisHour: killLog.length });
    if (source === "information_schema") for (const a of plan) a.reason = `${a.reason} [inferred holder]`;
    const done: PlannedAction[] = [];
    for (const a of plan) {
      if (a.action === "alerted" && now - (alertedAt.get(a.thread) ?? 0) < ALERT_REPEAT_MS) continue;
      if (a.action === "skipped") continue; // not ours: nothing to record or act on
      if (a.action === "killed") {
        try {
          if (!Number.isInteger(a.thread) || a.thread <= 0) throw new Error("bad thread id");
          await conn.query(`KILL CONNECTION ${a.thread}`);
          killLog.push(now);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("Unknown thread id")) { a.action = "alerted"; a.reason = `kill failed: ${msg}`.slice(0, 120); }
        }
      }
      if (a.action === "alerted") alertedAt.set(a.thread, now);
      done.push(a);
      try {
        await conn.execute(
          `INSERT INTO db_lock_incident (kind, action, blocker_thread, blocker_user, blocker_age_s, blocker_state,
                                         blocker_query, waiters, max_wait_s, reason)
           VALUES ('blocker', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.action, a.thread, a.user, a.ageS, a.state, a.query, a.waiters, a.maxWaitS, a.reason.slice(0, 120)],
        );
      } catch { /* table not migrated yet: the kill still happened and is logged by the caller */ }
    }
    return { actions: done, source };
  } finally {
    conn.release();
  }
}

/** Daily housekeeping: keep 30 days. Bounded delete so it never holds locks for long. */
export async function pruneIncidents(pool: Pool): Promise<number> {
  try {
    const [res] = await pool.execute(`DELETE FROM db_lock_incident WHERE detected_at < NOW() - INTERVAL 30 DAY LIMIT 5000`);
    return Number((res as { affectedRows?: number }).affectedRows ?? 0);
  } catch { return 0; }
}

export function resetWatchdogStateForTests(): void { killLog.length = 0; alertedAt.clear(); }
