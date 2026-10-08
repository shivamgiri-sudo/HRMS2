import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";

/**
 * finance_period is keyed by period_code alone (no branch_id) — a lock is company-wide for
 * that month, matching how canonical-pnl.service.ts's own lock checks already read it
 * (e.g. recalculate()'s "Locked period cannot be recalculated" guard). This is the same
 * check, exported for reuse outside process-pnl — GRN needs it too, since a GRN backdated
 * into a locked period was silently changing that period's live-recomputed P&L with no
 * guard at all.
 *
 * Pass `conn` to run the check inside an open transaction (P0-3). Without a connection the
 * check runs on the pool and is only an API-level guard; inside a transaction it is checked
 * immediately before the financial mutation so a concurrent lock cannot slip through.
 */
export async function isPeriodLocked(
  periodCode: string | undefined | null,
  conn?: PoolConnection
): Promise<boolean> {
  if (!periodCode) return false;
  const executor = conn ?? db;
  const [rows] = await executor.execute<RowDataPacket[]>(
    "SELECT status FROM finance_period WHERE period_code = ? LIMIT 1",
    [periodCode]
  );
  return String((rows as RowDataPacket[])[0]?.status ?? "") === "locked";
}
