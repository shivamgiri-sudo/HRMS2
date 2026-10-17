import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "./mysql.js";
import { peekLockConflicts } from "./lock-telemetry.js";
import { loadWatchdogConfig, readBlockersWithSource } from "./lock-watchdog.js";

/**
 * GET /api/admin/db/locks?hours=24
 * One place to see lock trouble: who is blocking whom right now, which statements lost deadlocks / lock waits in the
 * window (the ranking that was missing on 2026-10-17), and what the watchdog killed or alerted on.
 */
export const dbLocksRouter = Router();

dbLocksRouter.get("/", async (req, res, next) => {
  try {
    const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 24));
    const cfg = loadWatchdogConfig();

    let live: unknown[] = [];
    let liveError: string | null = null;
    let liveSource: string | null = null;
    let liveNote: string | null = null;
    try {
      const r = await readBlockersWithSource(db as never);
      live = r.rows.map((b) => ({ ...b, blockerQuery: b.blockerQuery?.slice(0, 200) ?? null }));
      liveSource = r.source;
      liveNote = r.note ?? null;
    } catch (err) {
      liveError = err instanceof Error ? err.message : String(err);
    }

    const [topStatements] = await db.execute<RowDataPacket[]>(
      `SELECT kind, statement_shape, SUM(occurrences) AS occurrences, MAX(detected_at) AS last_seen
         FROM db_lock_incident
        WHERE kind IN ('deadlock','lock_wait_timeout') AND detected_at >= NOW() - INTERVAL ? HOUR
        GROUP BY kind, statement_shape ORDER BY occurrences DESC LIMIT 25`,
      [hours],
    );
    const [byHour] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(detected_at, '%Y-%m-%d %H:00') AS hour, kind, SUM(occurrences) AS occurrences
         FROM db_lock_incident
        WHERE kind IN ('deadlock','lock_wait_timeout') AND detected_at >= NOW() - INTERVAL ? HOUR
        GROUP BY hour, kind ORDER BY hour DESC LIMIT 200`,
      [hours],
    );
    const [watchdogActions] = await db.execute<RowDataPacket[]>(
      `SELECT detected_at, action, blocker_thread, blocker_user, blocker_age_s, waiters, max_wait_s, reason,
              LEFT(blocker_query, 200) AS blocker_query
         FROM db_lock_incident WHERE kind = 'blocker' AND detected_at >= NOW() - INTERVAL ? HOUR
        ORDER BY detected_at DESC LIMIT 50`,
      [hours],
    );

    res.json({
      success: true,
      data: {
        windowHours: hours,
        watchdog: {
          mode: cfg.mode, idleBlockerS: cfg.idleBlockerS, killActive: cfg.killActive,
          maxKillsPerSweep: cfg.maxKillsPerSweep, maxKillsPerHour: cfg.maxKillsPerHour,
        },
        live, liveSource, liveNote, liveError,
        topStatements, byHour, watchdogActions,
        unflushedInThisProcess: peekLockConflicts().slice(0, 25),
      },
    });
  } catch (err) {
    next(err);
  }
});
