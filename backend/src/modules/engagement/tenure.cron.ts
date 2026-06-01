import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { checkAutoAwards } from "./badge.service.js";

const RUN_HOUR = 2;
let nextRun: NodeJS.Timeout | undefined;

export async function runTenureBadgeSweep(): Promise<{ checked: number; failed: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id
     FROM employees
     WHERE active_status = 1 AND date_of_joining IS NOT NULL`
  );
  let failed = 0;

  for (const row of rows) {
    try {
      await checkAutoAwards(row.id as string, "tenure");
    } catch (error) {
      failed += 1;
      console.error(`Failed to evaluate tenure badges for ${String(row.id)}`, error);
    }
  }

  return { checked: rows.length, failed };
}

export function millisecondsUntilNextTenureSweep(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startTenureBadgeScheduler(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      await runTenureBadgeSweep();
    } catch (error) {
      console.error("Failed to run tenure badge sweep", error);
    } finally {
      nextRun = undefined;
      startTenureBadgeScheduler();
    }
  }, millisecondsUntilNextTenureSweep());
  nextRun.unref();
}

export function stopTenureBadgeScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
