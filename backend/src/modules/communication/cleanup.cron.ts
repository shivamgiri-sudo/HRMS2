import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

const RUN_HOUR = 2;
let nextRun: NodeJS.Timeout | undefined;

export async function runCommunicationCleanup(): Promise<{
  routineDeleted: number;
  standardDeleted: number;
}> {
  const [routineResult] = await db.execute<ResultSetHeader>(
    `DELETE FROM dispatch_log
     WHERE is_critical = 0
       AND retention_category = 'routine'
       AND sent_at < NOW() - INTERVAL 30 DAY`
  );
  const routineDeleted = routineResult.affectedRows;

  const [standardResult] = await db.execute<ResultSetHeader>(
    `DELETE FROM dispatch_log
     WHERE is_critical = 0
       AND retention_category = 'standard'
       AND sent_at < NOW() - INTERVAL 90 DAY`
  );
  const standardDeleted = standardResult.affectedRows;

  console.log(
    `[CommunicationCleanup] Deleted ${routineDeleted} routine rows (>30d), ${standardDeleted} standard rows (>90d)`
  );

  return { routineDeleted, standardDeleted };
}

export function millisecondsUntilNextCleanup(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startCommunicationCleanup(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      await runCommunicationCleanup();
    } catch (error) {
      console.error("Failed to run communication cleanup", error);
    } finally {
      nextRun = undefined;
      startCommunicationCleanup();
    }
  }, millisecondsUntilNextCleanup());
  nextRun.unref();
}

export function stopCommunicationCleanup(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
