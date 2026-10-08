/**
 * Worker Utilities - Distributed lock helpers and graceful shutdown support.
 *
 * Provides MySQL advisory locks for worker safety across multiple instances.
 */

import { createHash } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../db/mysql.js";

const LOCK_TIMEOUT_SECONDS = 0; // Non-blocking lock acquisition

/**
 * Generate a deterministic lock name for a worker.
 * Uses SHA-256 hash to ensure lock name stays within MySQL limits.
 */
export function workerLockName(workerName: string): string {
  const digest = createHash("sha256").update(workerName).digest("hex").slice(0, 40);
  return `hrms:worker:${digest}`;
}

/**
 * Acquire a MySQL advisory lock for a worker.
 * Returns true if lock acquired, false if another instance holds the lock.
 */
export async function acquireWorkerLock(
  connection: PoolConnection,
  workerName: string
): Promise<boolean> {
  const lockName = workerLockName(workerName);
  try {
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [lockName, LOCK_TIMEOUT_SECONDS]
    );
    const acquired = Number(rows[0]?.acquired ?? 0) === 1;
    if (acquired) {
      console.log(`[${workerName}] advisory lock acquired`);
    }
    return acquired;
  } catch (error) {
    console.error(`[${workerName}] failed to acquire lock:`, error);
    return false;
  }
}

/**
 * Release a MySQL advisory lock for a worker.
 */
export async function releaseWorkerLock(
  connection: PoolConnection,
  workerName: string
): Promise<void> {
  const lockName = workerLockName(workerName);
  try {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]);
    console.log(`[${workerName}] advisory lock released`);
  } catch (error) {
    console.error(`[${workerName}] failed to release lock:`, error);
  }
}

/**
 * Execute a worker function with distributed lock protection.
 * Ensures only one instance runs the worker at a time.
 *
 * @param workerName - Unique name for this worker
 * @param fn - The worker function to execute
 * @returns true if worker executed, false if lock not acquired
 */
export async function withWorkerLock(
  workerName: string,
  fn: () => Promise<void>
): Promise<boolean> {
  const connection = await db.getConnection();
  try {
    const acquired = await acquireWorkerLock(connection, workerName);
    if (!acquired) {
      console.log(`[${workerName}] skipping - another instance holds the lock`);
      return false;
    }

    try {
      await fn();
      return true;
    } finally {
      await releaseWorkerLock(connection, workerName);
    }
  } finally {
    connection.release();
  }
}

/**
 * Record worker job run in audit table.
 */
export async function recordWorkerRun(
  workerName: string,
  status: "started" | "completed" | "failed",
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO worker_job_run (id, worker_name, status, started_at, completed_at, metadata)
       VALUES (UUID(), ?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         completed_at = VALUES(completed_at),
         metadata = VALUES(metadata)`,
      [
        workerName,
        status,
        status === "started" ? null : new Date(),
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (error) {
    // Non-fatal - don't fail worker if audit logging fails
    console.error(`[${workerName}] failed to record run status:`, error);
  }
}

// Track active timers for graceful shutdown
const activeTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Register a timer for graceful shutdown tracking.
 */
export function registerTimer(name: string, timer: NodeJS.Timeout): void {
  activeTimers.set(name, timer);
}

/**
 * Unregister a timer.
 */
export function unregisterTimer(name: string): void {
  activeTimers.delete(name);
}

/**
 * Clear all registered timers (for graceful shutdown).
 */
export function clearAllTimers(): void {
  for (const [name, timer] of activeTimers) {
    clearInterval(timer);
    clearTimeout(timer);
    console.log(`[shutdown] cleared timer: ${name}`);
  }
  activeTimers.clear();
}

/**
 * Get count of active timers.
 */
export function getActiveTimerCount(): number {
  return activeTimers.size;
}
