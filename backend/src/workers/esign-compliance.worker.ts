import { notificationEventService } from "../modules/communication/notification-event.service.js";
import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";

let db: any;
try {
  const dbModule = await import("../db/mysql.js");
  db = dbModule.db;
} catch {
  console.error("[EsignComplianceWorker] Database module not found - worker will not run");
  process.exit(1);
}

// ── Configuration ────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // Every 4 hours
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h cooldown per employee+doc
const ESCALATION_COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48h cooldown for escalations
const MANAGER_ESCALATION_DAYS = 5;
const HR_ESCALATION_DAYS = 6;

// ── Durable Cooldown Tracking ────────────────────────────────────────────────
//
// These cooldowns used to live in in-process Maps, and startEsignComplianceWorker
// runs a full cycle the moment it starts. Together that meant every restart of
// hrms-workers began with an empty cooldown and immediately re-sent everything.
// Over 2026-08-05..08 that put 1,428 messages — email AND SMS — onto 10 contacts
// from a standing set of three pending documents, at intervals of 7-30 minutes
// that no 4-hour timer could produce. One preboarding candidate received 47.
//
// The state has to outlive the process, so it lives in esign_notification_cooldown
// (migration 1109). Every read and write below fails CLOSED: if the table cannot
// be reached we skip the send rather than fall back to sending, because the whole
// failure being fixed here is a cooldown that silently evaluated to "go ahead".

type CooldownKind = "reminder" | "manager_escalation" | "hr_escalation";

async function canSend(
  employeeId: string,
  checklistId: string,
  kind: CooldownKind,
  cooldownMs: number,
): Promise<boolean> {
  try {
    const [rows]: any = await db.execute(
      `SELECT last_sent_at FROM esign_notification_cooldown
        WHERE employee_id = ? AND checklist_id = ? AND notification_kind = ?
        LIMIT 1`,
      [employeeId, checklistId, kind],
    );
    const last = rows[0]?.last_sent_at;
    if (!last) return true;
    return (Date.now() - new Date(String(last)).getTime()) >= cooldownMs;
  } catch (error: any) {
    console.error(
      `[EsignComplianceWorker] Cooldown read failed for ${kind} — skipping send:`,
      error.message,
    );
    return false;
  }
}

/**
 * Records the send. Returns false when the row could not be written, which the
 * caller treats as a failed send: an unrecorded send is one that repeats on the
 * next cycle, and repeating is the defect.
 */
async function markSent(
  employeeId: string,
  checklistId: string,
  kind: CooldownKind,
): Promise<{ ok: boolean; previousLastSentAt: string | null; existed: boolean }> {
  // The prior state is captured so a dispatch that reaches nobody can put it back. Without
  // it the only way to "release" is to blank the row, which would let the NEXT cycle send
  // immediately even when an older, still-valid send exists — turning a failed retry into a
  // duplicate.
  let previousLastSentAt: string | null = null;
  let existed = false;
  try {
    const [prior]: any = await db.execute(
      `SELECT last_sent_at FROM esign_notification_cooldown
        WHERE employee_id = ? AND checklist_id = ? AND notification_kind = ? LIMIT 1`,
      [employeeId, checklistId, kind],
    );
    if (prior[0]) {
      existed = true;
      previousLastSentAt = prior[0].last_sent_at ? String(prior[0].last_sent_at) : null;
    }

    await db.execute(
      `INSERT INTO esign_notification_cooldown
         (id, employee_id, checklist_id, notification_kind, last_sent_at, send_count)
       VALUES (UUID(), ?, ?, ?, NOW(), 1)
       ON DUPLICATE KEY UPDATE last_sent_at = NOW(), send_count = send_count + 1`,
      [employeeId, checklistId, kind],
    );
    return { ok: true, previousLastSentAt, existed };
  } catch (error: any) {
    console.error(`[EsignComplianceWorker] Cooldown write failed for ${kind}:`, error.message);
    return { ok: false, previousLastSentAt, existed };
  }
}

/**
 * Undo a claim whose dispatch reached nobody.
 *
 * Claiming before dispatch is what stops a crash double-sending, but it also meant a total
 * failure looked exactly like a delivery for 24 hours. Measured 2026-08-12: all 12 attempts
 * failed (Gmail 535-5.7.8, and SmartPing rejecting SMS for a missing DLT template), the SMTP
 * credential was fixed at 17:51 and the worker restarted at 18:03 carrying the fix — and three
 * pending documents still had nothing sent, because the 11:09 failures had burned the window.
 *
 * Restores the previous timestamp when there was one, and removes the row when this was the
 * first claim, so the next cycle is free to try again. Failing to release is logged and
 * otherwise ignored: the cost is one delayed reminder, never a duplicate.
 */
async function releaseClaim(
  employeeId: string,
  checklistId: string,
  kind: CooldownKind,
  prior: { previousLastSentAt: string | null; existed: boolean },
): Promise<void> {
  try {
    if (prior.existed) {
      await db.execute(
        `UPDATE esign_notification_cooldown
            SET last_sent_at = ?, send_count = GREATEST(send_count - 1, 0)
          WHERE employee_id = ? AND checklist_id = ? AND notification_kind = ?`,
        [prior.previousLastSentAt, employeeId, checklistId, kind],
      );
    } else {
      await db.execute(
        `DELETE FROM esign_notification_cooldown
          WHERE employee_id = ? AND checklist_id = ? AND notification_kind = ?`,
        [employeeId, checklistId, kind],
      );
    }
    console.warn(
      `[EsignComplianceWorker] ${kind} reached nobody — cooldown released so the next cycle retries`,
    );
  } catch (error: any) {
    console.error(`[EsignComplianceWorker] Cooldown release failed for ${kind}:`, error.message);
  }
}

/** True when a dispatch queued nothing at all. A PARTIAL success keeps its claim: re-sending
 *  to recipients who did receive it is the storm this whole design exists to prevent. */
function reachedNobody(result: { queued?: number } | null | undefined): boolean {
  return !result || Number(result.queued ?? 0) <= 0;
}

// The killswitch this worker never had. shared/worker-config.ts is the existing
// reader and fails OPEN on a missing row — "unmanaged", not "disabled" — which is
// safe here only because migration 1109 seeds an explicit enabled = 0 row. It
// caches for 60s, so flipping that row stops or starts sending within a minute
// with no deploy. Its fail-open on a DB error is covered from the other side: the
// cooldown reads below fail CLOSED, so a database blip cannot produce a send.

// ── Worker Logic ─────────────────────────────────────────────────────────────

async function findPendingEsignItems(): Promise<any[]> {
  try {
    const [rows]: any = await db.execute(
      `SELECT
         c.id AS checklist_id,
         c.employee_id,
         c.document_code,
         c.document_name,
         c.status,
         c.due_at,
         pt.created_at AS esign_link_created_at,
         pt.expires_at,
         e.full_name AS employee_name,
         e.employee_code,
         e.reporting_manager_id,
         e.branch_id,
         DATEDIFF(NOW(), pt.created_at) AS days_pending
       FROM employee_joining_document_checklist c
       JOIN employee_joining_document_public_token pt
         ON pt.checklist_id = c.id AND pt.token_status = 'active'
       JOIN employees e ON e.id = c.employee_id
       WHERE c.status IN ('esign_initiated', 'pending_candidate_esign')
         AND pt.expires_at > NOW()
       ORDER BY days_pending DESC`,
    );
    return rows || [];
  } catch (error: any) {
    console.error("[EsignComplianceWorker] Failed to query pending items:", error.message);
    return [];
  }
}

async function getEmployeeIdForUser(userId: string): Promise<string | null> {
  try {
    const [rows]: any = await db.execute(
      `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
      [userId],
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function getHrUsersForBranch(branchId: string | null): Promise<string[]> {
  try {
    const [rows]: any = await db.execute(
      `SELECT DISTINCT e.id
         FROM employees e
         JOIN user_roles ur ON ur.user_id = e.user_id AND ur.role_key IN ('payroll_hr', 'hr') AND ur.active_status = 1
        WHERE e.active_status = 1
          ${branchId ? "AND e.branch_id = ?" : ""}
        LIMIT 5`,
      branchId ? [branchId] : [],
    );
    return (rows || []).map((r: any) => String(r.id));
  } catch {
    return [];
  }
}

async function processEsignCompliance(): Promise<void> {
  if (!await isWorkerEnabled("esign-compliance")) return;
  await markWorkerRun("esign-compliance");

  const items = await findPendingEsignItems();
  if (items.length === 0) return;

  let reminders = 0;
  let managerEscalations = 0;
  let hrEscalations = 0;

  for (const item of items) {
    const daysPending = Number(item.days_pending ?? 0);
    const deadline = item.expires_at
      ? new Date(item.expires_at).toLocaleDateString("en-IN")
      : "soon";

    // Daily reminder to employee (after day 1)
    if (daysPending >= 1 && await canSend(item.employee_id, item.checklist_id, "reminder", REMINDER_COOLDOWN_MS)) {
      const claim_reminder = await markSent(item.employee_id, item.checklist_id, "reminder");
      try {
        // Claim the cooldown BEFORE dispatching. Claiming afterwards leaves a
        // window where a send that succeeded is never recorded, and the next
        // cycle sends it again.
                if (claim_reminder.ok) {
          const result_reminder = await notificationEventService.dispatch({
            eventCode: "esign_reminder",
            recipientEmployeeIds: [item.employee_id],
            // No outbound action button: the signing token is stored only as a
            // hash, so no link to it can be rebuilt here. The mail names the
            // document and points back at the still-valid link the signer already
            // has. The portal item keeps /profile for anyone who has a login —
            // and a preboarding candidate has none, which is exactly why the old
            // /profile button was useless to the person it was chasing.
            actionUrl: "",
            data: {
              document_name: item.document_name,
              days_pending: String(daysPending),
              deadline,
            },
          });
          // A dispatch that queued nothing must not hold the window shut.
          if (reachedNobody(result_reminder)) {
            await releaseClaim(item.employee_id, item.checklist_id, "reminder", claim_reminder);
          } else {
            reminders++;
          }
        }
      } catch (err: any) {
        console.error("[EsignComplianceWorker] Reminder dispatch failed:", err.message);
        // A throw burns the window exactly like a silent failure, so it releases too.
        if (claim_reminder.ok) await releaseClaim(item.employee_id, item.checklist_id, "reminder", claim_reminder);
      }
    }

    // Manager escalation (after 5 days)
    if (daysPending >= MANAGER_ESCALATION_DAYS && item.reporting_manager_id) {
      if (await canSend(item.employee_id, item.checklist_id, "manager_escalation", ESCALATION_COOLDOWN_MS)) {
        const managerId = await getEmployeeIdForUser(item.reporting_manager_id);
        if (managerId) {
          const claim_manager_escalation = await markSent(item.employee_id, item.checklist_id, "manager_escalation");
          try {
                        if (claim_manager_escalation.ok) {
              const result_manager_escalation = await notificationEventService.dispatch({
                eventCode: "esign_escalation_manager",
                recipientEmployeeIds: [managerId],
                data: {
                  employee_name: item.employee_name,
                  employee_code: item.employee_code,
                  document_name: item.document_name,
                  days_pending: String(daysPending),
                },
              });
              // A dispatch that queued nothing must not hold the window shut.
              if (reachedNobody(result_manager_escalation)) {
                await releaseClaim(item.employee_id, item.checklist_id, "manager_escalation", claim_manager_escalation);
              } else {
                managerEscalations++;
              }
            }
          } catch (err: any) {
            console.error("[EsignComplianceWorker] Manager escalation failed:", err.message);
            if (claim_manager_escalation.ok) await releaseClaim(item.employee_id, item.checklist_id, "manager_escalation", claim_manager_escalation);
          }
        }
      }
    }

    // HR escalation (after 6 days — link about to expire)
    if (daysPending >= HR_ESCALATION_DAYS) {
      if (await canSend(item.employee_id, item.checklist_id, "hr_escalation", ESCALATION_COOLDOWN_MS)) {
        const hrIds = await getHrUsersForBranch(item.branch_id);
        if (hrIds.length > 0) {
          const claim_hr_escalation = await markSent(item.employee_id, item.checklist_id, "hr_escalation");
          try {
                        if (claim_hr_escalation.ok) {
              const result_hr_escalation = await notificationEventService.dispatch({
                eventCode: "esign_escalation_hr",
                recipientEmployeeIds: hrIds,
                data: {
                  employee_name: item.employee_name,
                  employee_code: item.employee_code,
                  document_name: item.document_name,
                  days_pending: String(daysPending),
                  deadline,
                },
              });
              // A dispatch that queued nothing must not hold the window shut.
              if (reachedNobody(result_hr_escalation)) {
                await releaseClaim(item.employee_id, item.checklist_id, "hr_escalation", claim_hr_escalation);
              } else {
                hrEscalations++;
              }
            }
          } catch (err: any) {
            console.error("[EsignComplianceWorker] HR escalation failed:", err.message);
            if (claim_hr_escalation.ok) await releaseClaim(item.employee_id, item.checklist_id, "hr_escalation", claim_hr_escalation);
          }
        }
      }
    }
  }

  if (reminders > 0 || managerEscalations > 0 || hrEscalations > 0) {
    console.log("[EsignComplianceWorker] Cycle complete:", {
      pendingItems: items.length,
      remindersSent: reminders,
      managerEscalations,
      hrEscalations,
    });
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let startupHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Delay before the first cycle after boot.
 *
 * Two competing constraints, and the first value chosen got the second one wrong.
 *
 * Long enough that a crash-looping process never reaches it: pm2 here runs
 * restart_delay 5000 / max_restarts 10, so a genuine loop exhausts its restarts
 * and stops in roughly 50 seconds. 90s clears that.
 *
 * Short enough that the worker actually gets there. 5 minutes did not. Measured
 * on 2026-08-08: the workers process restarted 15 times in two hours (several
 * sessions deploy to this box), and all-workers.ts starts its 45 workers
 * SEQUENTIALLY — the boot at 21:30:30 only reached `✓ esign-compliance` at
 * 21:32:19, nearly two minutes in. A 5-minute delay measured from there needed
 * ~7 minutes of uninterrupted uptime, which this process rarely gets, so the
 * cycle kept being cancelled by the next deploy.
 *
 * The durable cooldown, not this number, is what prevents a storm. This only has
 * to outlast a crash-loop.
 */
const STARTUP_DELAY_MS = 90 * 1000;

export async function startEsignComplianceWorker(): Promise<void> {
  console.log("[EsignComplianceWorker] Starting (first run in 90s, then every 4h)");

  // This originally ran a cycle IMMEDIATELY at startup, which — combined with
  // cooldowns held in memory — turned every restart into a fresh blast: 1,818
  // messages over three days.
  //
  // Removing the startup cycle outright was my first fix and it was wrong. This
  // box is restarted by several sessions deploying: seven restarts in five hours
  // on 2026-08-08. A 4-hour interval that resets on every boot never elapses, so
  // the worker sat with last_run_at NULL and an empty cooldown table for five
  // hours after being enabled. The mail storm was cured by making the reminders
  // silent, which is not a fix.
  //
  // The durable cooldown in esign_notification_cooldown is what actually makes a
  // startup run safe — it caps a reminder at one per document per 24h no matter
  // how often the process boots. So the cycle is restored, just delayed past the
  // window a crash-loop lives in. unref() so a pending first run never holds a
  // shutting-down process open.
  startupHandle = setTimeout(() => {
    void processEsignCompliance();
  }, STARTUP_DELAY_MS);
  if (typeof startupHandle.unref === "function") startupHandle.unref();

  intervalHandle = setInterval(async () => {
    await processEsignCompliance();
  }, CHECK_INTERVAL_MS);
}

export function stopEsignComplianceWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  // The pending first run has to be cancelled too, or a shutdown inside the
  // 5-minute window still fires one cycle on the way out.
  if (startupHandle) {
    clearTimeout(startupHandle);
    startupHandle = null;
  }
}
