/**
 * Report subscription worker — the only new moving part in scheduled reporting.
 *
 * It does exactly one thing: insert report_request rows on a schedule. Everything after
 * that already exists and is proven — report-generation.worker builds the XLSX through
 * buildSecureXlsxBuffer, report-email-delivery.worker attaches and sends it with a
 * [0,5,30,120]-minute retry ladder and a 20MB cap, and report_audit_event records it.
 * Reusing that pipeline rather than emailing directly is why this file is short.
 *
 * Two guards specific to scheduled reports:
 *
 *  - Per-recipient export RBAC is rechecked HERE, at send time. The on-demand flow checks
 *    it when a human clicks the button; a subscription created six months ago can outlive
 *    the recipient's role. A payroll register must not keep arriving after someone leaves
 *    finance.
 *  - Slot-based idempotency. uq_rsr_slot keys on a DERIVED slot ('2026-W31', '2026-07-31',
 *    '2026-07'), not wall-clock time, so a restart, a clock skew or two workers racing
 *    cannot produce the same weekly report twice.
 *
 * Registered in BOTH all-workers.ts and server.ts.
 */
import { randomUUID } from 'crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { db } from '../db/mysql.js';
import { resolveRecipients } from '../shared/recipient-resolver.js';
import { RecipientResolutionError } from '../shared/recipient-resolver.types.js';
import type { RecipientSpec } from '../shared/recipient-resolver.types.js';
import { getReportDefinition, canExportReport } from '../modules/reporting/report-catalog.js';
import { isWorkerEnabled, markWorkerRun } from '../shared/worker-config.js';
import { withWorkerLock, registerTimer, unregisterTimer, recordWorkerRun } from './worker-utils.js';

const WORKER_NAME = 'report-subscription';
const POLL_MS = 10 * 60 * 1000;
const STARTUP_DELAY_MS = 120_000;
const MAX_SUBSCRIPTIONS_PER_RUN = 20;

interface SubscriptionRow extends RowDataPacket {
  id: string;
  subscription_name: string;
  report_code: string;
  filters_json: unknown;
  frequency: 'daily' | 'weekly' | 'monthly';
  day_of_week: number | null;
  day_of_month: number | null;
  hour_of_day: number;
  recipient_spec: string | Record<string, unknown>;
  requested_format: 'xlsx' | 'csv' | 'pdf';
  dispatch_mode: 'shadow' | 'live';
  owner_user_id: string;
}

/**
 * Stable identifier for "the slot this run belongs to".
 * Derived from the date rather than from NOW(), so retrying inside the same slot is a
 * no-op instead of a second report.
 */
export function slotKeyFor(freq: SubscriptionRow['frequency'], now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  if (freq === 'daily') return `${y}-${m}-${d}`;
  if (freq === 'monthly') return `${y}-${m}`;
  // ISO week number.
  const t = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;          // Mon=0
  t.setUTCDate(t.getUTCDate() - dayNum + 3);        // nearest Thursday
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Next occurrence after `from`, honouring frequency and the configured hour. */
export function computeNextRun(sub: Pick<SubscriptionRow, 'frequency' | 'day_of_week' | 'day_of_month' | 'hour_of_day'>, from: Date): Date {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(sub.hour_of_day);
  if (sub.frequency === 'daily') {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (sub.frequency === 'weekly') {
    const target = sub.day_of_week ?? 0;                 // 0=Monday
    const cur = (next.getUTCDay() + 6) % 7;
    let delta = (target - cur + 7) % 7;
    if (delta === 0 && next <= from) delta = 7;
    next.setUTCDate(next.getUTCDate() + delta);
    return next;
  }
  const dom = Math.min(sub.day_of_month ?? 1, 28);
  next.setUTCDate(dom);
  if (next <= from) { next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(dom); }
  return next;
}

/** All active role keys for a user — the same union accessGuard uses. */
async function rolesFor(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1
     UNION
     SELECT role_key FROM user_assignment_scope WHERE user_id = ? AND active_status = 1`,
    [userId, userId],
  );
  return rows.map((r) => String(r.role_key).trim().toLowerCase());
}

export async function runSubscriptionSweep(now = new Date()): Promise<{
  due: number; requested: number; skipped: number;
}> {
  const [subs] = await db.execute<SubscriptionRow[]>(
    `SELECT * FROM report_subscription
      WHERE is_active = 1 AND (next_run_at IS NULL OR next_run_at <= NOW())
      ORDER BY next_run_at IS NULL DESC, next_run_at ASC
      LIMIT ${MAX_SUBSCRIPTIONS_PER_RUN}`,
  );

  let requested = 0;
  let skipped = 0;

  for (const sub of subs) {
    const slot = slotKeyFor(sub.frequency, now);
    let runId: string | null = null;

    try {
      // Claim the slot before doing anything expensive. A duplicate key means this slot
      // is already handled — by an earlier run, or by another worker.
      runId = randomUUID();
      try {
        await db.execute(
          `INSERT INTO report_subscription_run (id, subscription_id, slot_key, mode, status)
           VALUES (?, ?, ?, ?, 'claimed')`,
          [runId, sub.id, slot, sub.dispatch_mode],
        );
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') { skipped++; continue; }
        throw err;
      }

      const definition = getReportDefinition(sub.report_code);
      if (!definition) {
        await failRun(runId, sub.id, `report_code '${sub.report_code}' is not in the catalog`);
        skipped++; continue;
      }

      const resolution = await resolveRecipients(
        normaliseSpec(sub.recipient_spec),
        // Reports carry PII and financial data; treat them as confidential so the
        // client-portal deny-list applies and personal addresses are refused.
        { sensitivity: definition.containsFinancialData ? 'fin' : 'conf', context: {} },
      );

      const created: string[] = [];
      for (const r of [...resolution.to, ...resolution.cc]) {
        if (!r.userId) continue;

        // Send-time RBAC. The subscription may predate a role change.
        const roles = await rolesFor(r.userId);
        if (!canExportReport(sub.report_code, roles)) continue;

        if (sub.dispatch_mode === 'shadow') { created.push('shadow'); continue; }

        const reqId = randomUUID();
        const ref = `RPT-SUB-${slot}-${reqId.slice(0, 8).toUpperCase()}`;
        await db.execute<ResultSetHeader>(
          `INSERT INTO report_request
             (id, request_reference, report_code, report_name_snapshot,
              requested_by_user_id, requested_by_employee_id, official_email,
              official_email_source, requested_filters_json, requested_format,
              request_source, correlation_id, status, requested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'employees.official_email', ?, ?, 'subscription', ?, 'REQUESTED', NOW())`,
          [
            reqId, ref, sub.report_code, definition.name,
            r.userId, r.employeeId, r.email,
            sub.filters_json ? JSON.stringify(sub.filters_json) : null,
            sub.requested_format, runId,
          ],
        );
        created.push(reqId);
      }

      await db.execute(
        `UPDATE report_subscription_run
            SET status = ?, recipient_count = ?, report_request_ids = ?, completed_at = NOW()
          WHERE id = ?`,
        [created.length ? 'requested' : 'skipped', created.length, JSON.stringify(created), runId],
      );
      await db.execute(
        `UPDATE report_subscription
            SET last_run_at = NOW(), next_run_at = ?, last_status = ?, last_error = NULL,
                consecutive_failures = 0
          WHERE id = ?`,
        [computeNextRun(sub, now), created.length ? 'requested' : 'no_eligible_recipients', sub.id],
      );
      requested += created.length;
    } catch (err) {
      const msg = err instanceof RecipientResolutionError
        ? `${err.code}: ${err.message}`
        : (err as Error).message;
      if (runId) await failRun(runId, sub.id, msg);
      skipped++;
      console.error(`[${WORKER_NAME}] subscription ${sub.subscription_name}:`, msg);
    }
  }

  return { due: subs.length, requested, skipped };
}

async function failRun(runId: string, subscriptionId: string, message: string): Promise<void> {
  await db.execute(
    `UPDATE report_subscription_run SET status='failed', error_message=?, completed_at=NOW() WHERE id=?`,
    [message.slice(0, 1000), runId],
  ).catch(() => {});
  // Count failures so the UI can surface a subscription that has quietly stopped working
  // rather than leaving it looking healthy.
  await db.execute(
    `UPDATE report_subscription
        SET last_status='failed', last_error=?, consecutive_failures = consecutive_failures + 1,
            last_run_at = NOW()
      WHERE id = ?`,
    [message.slice(0, 1000), subscriptionId],
  ).catch(() => {});
}

function normaliseSpec(raw: string | Record<string, unknown>): RecipientSpec {
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as RecipientSpec;
}

async function tick(): Promise<void> {
  if (!(await isWorkerEnabled(WORKER_NAME))) return;
  await withWorkerLock(WORKER_NAME, async () => {
    const started = Date.now();
    const stats = await runSubscriptionSweep();
    await markWorkerRun(WORKER_NAME);
    await recordWorkerRun(WORKER_NAME, 'completed', { ...stats, duration_ms: Date.now() - started });
  });
}

let startupTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

export function startReportSubscriptionWorker(): void {
  startupTimer = setTimeout(() => {
    void tick();
    intervalTimer = setInterval(() => void tick(), POLL_MS);
    registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
  }, STARTUP_DELAY_MS);
  registerTimer(`${WORKER_NAME}-startup`, startupTimer);
  console.log(`[${WORKER_NAME}] scheduled — every ${POLL_MS / 60000}m (disabled by default via worker_config)`);
}

export function stopReportSubscriptionWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}-startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(`${WORKER_NAME}-interval`); intervalTimer = null; }
  console.log(`[${WORKER_NAME}] stopped`);
}
