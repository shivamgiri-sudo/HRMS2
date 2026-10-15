import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export interface DbPerformanceSummary {
  live: {
    threads_running: number;
    threads_connected: number;
    slow_queries: number;
    questions_per_sec: number;
    lock_waits: number;
    lock_wait_avg_ms: number;
    uptime_h: number;
  };
  top_tables: Array<{ table_name: string; size_mb: number; rows: number; data_mb: number; index_mb: number }>;
  upload_batch: {
    total_rows: number;
    total_batches: number;
    purged_batches: number;
    due_for_purge: number;
    next_purge_at: string;
  };
  pool: {
    circuit_breaker: string;
  };
}

export async function getDbPerformanceSummary(): Promise<DbPerformanceSummary> {
  const [statusRows] = await db.query<RowDataPacket[]>(
    `SHOW GLOBAL STATUS WHERE Variable_name IN (
      'Threads_running','Threads_connected','Slow_queries','Questions',
      'Uptime','Innodb_row_lock_waits','Innodb_row_lock_time_avg'
    )`,
  );
  const s: Record<string, number> = {};
  for (const r of statusRows) s[r.Variable_name] = Number(r.Value);

  const [tables] = await db.query<RowDataPacket[]>(
    `SELECT
       TABLE_NAME AS table_name,
       ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576, 1) AS size_mb,
       TABLE_ROWS AS rows,
       ROUND(DATA_LENGTH / 1048576, 1) AS data_mb,
       ROUND(INDEX_LENGTH / 1048576, 1) AS index_mb
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY DATA_LENGTH + INDEX_LENGTH DESC
     LIMIT 10`,
  );

  const [[ubRows], [ubBatches], [ubPurged], [ubDue]] = await Promise.all([
    db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM upload_batch_row`),
    db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM upload_batch`),
    db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM upload_batch_snapshot WHERE rows_purged_at IS NOT NULL`),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM upload_batch ub
       LEFT JOIN upload_batch_snapshot s ON s.id = ub.id
       WHERE ub.batch_status IN ('imported','completed','failed','rejected','validation_failed','imported_with_errors')
         AND (s.id IS NULL OR s.rows_purged_at IS NULL)
         AND TIMESTAMPDIFF(DAY, COALESCE(ub.imported_at, ub.updated_at, ub.created_at), NOW()) >= 7`,
    ),
  ]);

  const uptimeS = s.Uptime ?? 0;
  const qps = uptimeS > 0 ? Math.round((s.Questions ?? 0) / uptimeS) : 0;

  return {
    live: {
      threads_running: s.Threads_running ?? 0,
      threads_connected: s.Threads_connected ?? 0,
      slow_queries: s.Slow_queries ?? 0,
      questions_per_sec: qps,
      lock_waits: s.Innodb_row_lock_waits ?? 0,
      lock_wait_avg_ms: Math.round(s.Innodb_row_lock_time_avg ?? 0),
      uptime_h: Math.round(uptimeS / 3600),
    },
    top_tables: tables.map((t) => ({
      table_name: String(t.table_name),
      size_mb: Number(t.size_mb),
      rows: Number(t.rows),
      data_mb: Number(t.data_mb),
      index_mb: Number(t.index_mb),
    })),
    upload_batch: {
      total_rows: Number(ubRows[0]?.n ?? 0),
      total_batches: Number(ubBatches[0]?.n ?? 0),
      purged_batches: Number(ubPurged[0]?.n ?? 0),
      due_for_purge: Number(ubDue[0]?.n ?? 0),
      next_purge_at: "02:00 IST daily",
    },
    pool: {
      circuit_breaker: "closed",
    },
  };
}
