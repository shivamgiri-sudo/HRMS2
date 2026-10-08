import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";

/**
 * Operations Command performance indexes, created IN THE BACKGROUND rather than by a startup migration.
 *
 * Why not a migration: on 2026-09-30 an ALTER TABLE in a startup migration queued behind a 76-second report query on
 * `employees`. A pending ALTER holds a metadata-lock request that blocks EVERY later query on that table, the migration
 * hit "Lock wait timeout exceeded", and — because production refuses to start with a failed migration — the whole site
 * went down (502). These indexes are an optimisation only; nothing may depend on them or block startup for them.
 *
 * Rules enforced here:
 *  - never throws, never blocks boot (first run is delayed, everything is wrapped);
 *  - skips a table while a long query is running on it, so the ALTER never queues behind one;
 *  - 3-second lock wait for the ALTER itself, so a queued request cannot pile up other queries for long;
 *  - ALGORITHM=INPLACE, LOCK=NONE (fails fast instead of silently copying the table);
 *  - retries every 15 minutes until every index exists, then stops.
 */
export interface OpsIndexSpec {
  table: string;
  name: string;
  columns: string;
}

/** Only indexes the current queries actually use (employees are loaded once and joined in memory — no employees indexes). */
export const OPS_INDEXES: OpsIndexSpec[] = [
  // adrRows(): the whole window is read from the index alone instead of one wide-row lookup per attendance day.
  { table: "attendance_daily_record", name: "idx_ops_adr_cover", columns: "record_date, employee_id, attendance_status, late_mark, raw_minutes, biometric_minutes, dialler_minutes, mismatch_flag, mismatch_resolved_at" },
  // agentKpis(): per-agent daily KPI scan grouped by employee + metric.
  { table: "kpi_daily_actual", name: "idx_ops_kda_cover", columns: "score_date, employee_id, metric_id, actual_value, numerator_value, denominator_value" },
];

/**
 * WFM Capacity Dashboard (/api/workforce-mandate/capacity-summary). Kept apart from OPS_INDEXES, which a test pins.
 * The long-leave count reads leave_request by status + to_date + total_days; without a covering index it fetches ~15k
 * wide rows to find none (measured 3.6s on a 30k-row table). Deliberately no `employees` index — see above.
 */
export const CAPACITY_INDEXES: OpsIndexSpec[] = [
  { table: "leave_request", name: "idx_lr_capacity_cover", columns: "status, to_date, total_days, employee_id" },
];

const BUSY_QUERY_SECONDS = 15;
const ALTER_LOCK_WAIT_SECONDS = 3;

const IDENT = /^[a-z0-9_]+$/i;

export interface EnsureResult {
  created: string[];
  present: string[];
  skippedBusy: string[];
  failed: Array<{ name: string; reason: string }>;
}

async function indexPresent(spec: OpsIndexSpec): Promise<"present" | "missing" | "no_table"> {
  const [t] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [spec.table],
  );
  if (!Number(t[0]?.n)) return "no_table";
  const [r] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [spec.table, spec.name],
  );
  return Number(r[0]?.n) ? "present" : "missing";
}

/** True when some other session has been running a query that mentions the table for a while. */
async function tableBusy(table: string): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE COMMAND = 'Query' AND TIME > ? AND ID <> CONNECTION_ID() AND INFO LIKE ?",
      [BUSY_QUERY_SECONDS, `%${table}%`],
    );
    return Number(rows[0]?.n) > 0;
  } catch {
    // If we cannot tell, assume busy — creating an index is never urgent.
    return true;
  }
}

export async function ensureOpsIndexes(specs: OpsIndexSpec[] = OPS_INDEXES): Promise<EnsureResult> {
  const out: EnsureResult = { created: [], present: [], skippedBusy: [], failed: [] };
  for (const spec of specs) {
    try {
      if (!IDENT.test(spec.table) || !IDENT.test(spec.name)) throw new Error("invalid identifier");
      const state = await indexPresent(spec);
      if (state === "no_table") {
        out.failed.push({ name: spec.name, reason: "table missing" });
        continue;
      }
      if (state === "present") {
        out.present.push(spec.name);
        continue;
      }
      if (await tableBusy(spec.table)) {
        out.skippedBusy.push(spec.name);
        continue;
      }

      const conn = await db.getConnection();
      try {
        await conn.execute(`SET SESSION lock_wait_timeout = ${ALTER_LOCK_WAIT_SECONDS}`);
        await conn.execute(`SET SESSION innodb_lock_wait_timeout = ${ALTER_LOCK_WAIT_SECONDS}`);
        await conn.execute(`ALTER TABLE \`${spec.table}\` ADD INDEX \`${spec.name}\` (${spec.columns}), ALGORITHM=INPLACE, LOCK=NONE`);
        out.created.push(spec.name);
      } finally {
        try {
          await conn.execute("SET SESSION lock_wait_timeout = DEFAULT");
          await conn.execute("SET SESSION innodb_lock_wait_timeout = DEFAULT");
        } catch {
          /* the connection is released either way */
        }
        conn.release();
      }
    } catch (err) {
      out.failed.push({ name: spec.name, reason: (err as Error).message.slice(0, 160) });
    }
  }
  return out;
}

let timer: NodeJS.Timeout | null = null;

/** Starts the background retry loop. Safe to call more than once; disable with OPS_INDEXES=false. */
export function scheduleOpsIndexes(): void {
  if (timer || process.env.OPS_INDEXES === "false" || process.env.NODE_ENV === "test") return;
  const tick = async () => {
    try {
      const r = await ensureOpsIndexes([...OPS_INDEXES, ...CAPACITY_INDEXES]);
      if (r.created.length) logger.info(`[ops-command] indexes created: ${r.created.join(", ")}`);
      if (r.failed.length) logger.warn(`[ops-command] index creation deferred: ${r.failed.map((f) => `${f.name} (${f.reason})`).join("; ")}`);
      if (!r.skippedBusy.length && !r.failed.length && timer) {
        clearInterval(timer);
        timer = null; // everything exists — stop retrying
      }
    } catch (err) {
      logger.warn(`[ops-command] index job error: ${(err as Error).message}`);
    }
  };
  setTimeout(() => void tick(), 120_000).unref();
  timer = setInterval(() => void tick(), 15 * 60 * 1000);
  timer.unref();
}
