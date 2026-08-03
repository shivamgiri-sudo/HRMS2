import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * finance_period is keyed by period_code alone (no branch_id) — a lock is company-wide for
 * that month, matching how canonical-pnl.service.ts's own lock checks already read it
 * (e.g. recalculate()'s "Locked period cannot be recalculated" guard). This is the same
 * check, exported for reuse outside process-pnl — GRN needs it too, since a GRN backdated
 * into a locked period was silently changing that period's live-recomputed P&L with no
 * guard at all.
 */
export async function isPeriodLocked(periodCode: string | undefined | null): Promise<boolean> {
  if (!periodCode) return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT status FROM finance_period WHERE period_code = ? LIMIT 1",
    [periodCode]
  );
  return String(rows[0]?.status ?? "") === "locked";
}
