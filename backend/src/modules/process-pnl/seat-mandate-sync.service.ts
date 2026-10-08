/**
 * Keeps a process's seat/mandate count in step across the five places it is entered:
 *
 *   wfm_mandate   workforce_mandate.mandated_hc            (WFM Capacity Dashboard "Mandate")
 *   revenue_rule  process_revenue_rule.mandated_seats      (P&L Config > Revenue rule)
 *   monthly_plan  process_monthly_plan.contracted_seats    (P&L Config > Plans & periods)
 *   cost_centre   cost_centre_master.mandated_seats(_value) (Cost Centre sheet > Operations)
 *
 * They were independent, so a mandate set in one never reached the others. This pushes a value
 * from the place that was just edited to every other place — but ONLY where the target is
 * unambiguous, because the stores differ in granularity:
 *
 *   - WFM mandates are per process + branch + role group, revenue rules per LOB, cost centres
 *     per cost centre. A process-level number cannot be split across several rows without
 *     inventing a split, so with 0 or >1 candidate rows the target is skipped and reported,
 *     never guessed.
 *   - Only the row that is in force today is touched (WFM / revenue rule: effective today;
 *     revenue rule: approved only; monthly plan: current period, never a locked one).
 *
 * Writes go straight to SQL, never through the save paths that call this, so it cannot loop.
 * Every change is written to the audit log, and a failure here never fails the original save.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";

export type SeatSource = "wfm_mandate" | "revenue_rule" | "monthly_plan" | "cost_centre";

export interface SeatSyncResult {
  updated: { target: SeatSource; id: string; from: number | null; to: number }[];
  skipped: { target: SeatSource; reason: string }[];
}

const ACTIVE_TODAY = "effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())";

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Process-level seat totals as each store currently holds them — used by callers to derive the value to push. */
export async function sumWfmMandate(processId: string): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(mandated_hc) AS s FROM workforce_mandate WHERE process_id = ? AND active_status = 1 AND ${ACTIVE_TODAY}`,
    [processId],
  );
  return num((rows as RowDataPacket[])[0]?.s);
}

export async function sumApprovedRuleSeats(processId: string): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(mandated_seats) AS s FROM process_revenue_rule
      WHERE process_id = ? AND status = 'approved' AND mandated_seats IS NOT NULL AND ${ACTIVE_TODAY}`,
    [processId],
  );
  return num((rows as RowDataPacket[])[0]?.s);
}

/** The process's only active cost centre, or null when it has none or several (then it has no single seat count). */
export async function soleCostCentreSeats(processId: string): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT mandated_seats FROM cost_centre_master WHERE process_id = ? AND active_status = 1 LIMIT 2`,
    [processId],
  );
  return (rows as RowDataPacket[]).length === 1 ? num((rows as RowDataPacket[])[0].mandated_seats) : null;
}

export async function syncProcessSeats(params: {
  processId: string;
  seats: number;
  source: SeatSource;
  actorId: string;
}): Promise<SeatSyncResult> {
  const { processId, source, actorId } = params;
  const result: SeatSyncResult = { updated: [], skipped: [] };
  const seats = Number(params.seats);
  if (!processId || !Number.isFinite(seats) || seats < 0) return result;

  const record = async (target: SeatSource, id: string, from: number | null) => {
    result.updated.push({ target, id, from, to: seats });
    await writeAuditLog({
      actor_user_id: actorId,
      action_type: "SEAT_MANDATE_SYNC",
      module_key: "process_pnl_configuration",
      entity_type: target,
      entity_id: id,
      metadata: { process_id: processId, source, target, from, to: seats },
    });
  };
  const skip = (target: SeatSource, reason: string) => result.skipped.push({ target, reason });

  // WFM mandate: exactly one in-force row (mandated_hc is a whole number).
  if (source !== "wfm_mandate") {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, mandated_hc FROM workforce_mandate WHERE process_id = ? AND active_status = 1 AND ${ACTIVE_TODAY} LIMIT 2`,
      [processId],
    );
    const list = rows as RowDataPacket[];
    if (list.length !== 1) skip("wfm_mandate", list.length ? "several WFM mandate rows (role groups/branches) — cannot split a single number" : "no in-force WFM mandate");
    else if (num(list[0].mandated_hc) !== Math.round(seats)) {
      await db.execute(`UPDATE workforce_mandate SET mandated_hc = ? WHERE id = ?`, [Math.round(seats), list[0].id]);
      await record("wfm_mandate", String(list[0].id), num(list[0].mandated_hc));
    }
  }

  // Revenue rule: exactly one approved rule in force.
  if (source !== "revenue_rule") {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, mandated_seats FROM process_revenue_rule WHERE process_id = ? AND status = 'approved' AND ${ACTIVE_TODAY} LIMIT 2`,
      [processId],
    );
    const list = rows as RowDataPacket[];
    if (list.length !== 1) skip("revenue_rule", list.length ? "several approved revenue rules (per LOB) — cannot split a single number" : "no approved revenue rule in force");
    else if (num(list[0].mandated_seats) !== seats) {
      await db.execute(`UPDATE process_revenue_rule SET mandated_seats = ?, updated_by = ? WHERE id = ?`, [seats, actorId, list[0].id]);
      await record("revenue_rule", String(list[0].id), num(list[0].mandated_seats));
    }
  }

  // Monthly plan: this month's plan if it exists and is not locked. Never created here.
  if (source !== "monthly_plan") {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, contracted_seats FROM process_monthly_plan
        WHERE process_id = ? AND period_code = DATE_FORMAT(CURDATE(), '%Y-%m') AND status <> 'locked' LIMIT 2`,
      [processId],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    const list = rows as RowDataPacket[];
    if (list.length !== 1) skip("monthly_plan", list.length ? "several plans for this month" : "no unlocked plan for the current month");
    else if (num(list[0].contracted_seats) !== seats) {
      await db.execute(`UPDATE process_monthly_plan SET contracted_seats = ?, updated_by = ? WHERE id = ?`, [seats, actorId, list[0].id]);
      await record("monthly_plan", String(list[0].id), num(list[0].contracted_seats));
    }
  }

  // Cost centre: only when the process has a single active cost centre. Both columns are written —
  // the Cost Centre sheet edits mandated_seats_value, P&L and process performance read mandated_seats.
  if (source !== "cost_centre") {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, mandated_seats FROM cost_centre_master WHERE process_id = ? AND active_status = 1 LIMIT 2`,
      [processId],
    );
    const list = rows as RowDataPacket[];
    if (list.length !== 1) skip("cost_centre", list.length ? "process has several cost centres — seats are per cost centre" : "no active cost centre");
    else if (num(list[0].mandated_seats) !== seats) {
      await db.execute(`UPDATE cost_centre_master SET mandated_seats = ?, mandated_seats_value = ? WHERE id = ?`, [String(seats), seats, list[0].id]);
      await record("cost_centre", String(list[0].id), num(list[0].mandated_seats));
    }
  }

  if (result.updated.length) {
    console.log(`[seat-sync] process=${processId} source=${source} seats=${seats} updated=${result.updated.map((u) => u.target).join(",")}`);
    try {
      const { processPnlService } = await import("./process-pnl.service.js");
      processPnlService.invalidateCaches();
    } catch { /* cache is advisory */ }
    try {
      const { clearCapacityCache } = await import("../workforce-mandate/workforce.mandate.routes.js");
      clearCapacityCache();
    } catch { /* cache is advisory */ }
  }
  return result;
}

/** Fire-and-forget wrapper for save paths: logs skips, never throws, never delays the save. */
export function syncProcessSeatsSafe(params: Parameters<typeof syncProcessSeats>[0]): void {
  void syncProcessSeats(params)
    .then((r) => {
      for (const s of r.skipped) console.log(`[seat-sync] process=${params.processId} source=${params.source} skipped ${s.target}: ${s.reason}`);
    })
    .catch((e) => console.error(`[seat-sync] failed process=${params.processId} source=${params.source}:`, e instanceof Error ? e.message : e));
}
