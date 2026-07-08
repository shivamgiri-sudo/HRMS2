import { notificationEventService } from "../modules/communication/notification-event.service.js";

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

// ── In-Memory Cooldown Tracking ──────────────────────────────────────────────

const reminderSent = new Map<string, number>();
const managerEscalated = new Map<string, number>();
const hrEscalated = new Map<string, number>();

function cooldownKey(employeeId: string, checklistId: string): string {
  return `${employeeId}:${checklistId}`;
}

function canSend(map: Map<string, number>, key: string, cooldownMs: number): boolean {
  const last = map.get(key);
  if (!last) return true;
  return (Date.now() - last) >= cooldownMs;
}

function markSent(map: Map<string, number>, key: string): void {
  map.set(key, Date.now());
}

function cleanupCache(map: Map<string, number>, maxAgeMs: number): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, timestamp] of map.entries()) {
    if (timestamp < cutoff) map.delete(key);
  }
}

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
  const items = await findPendingEsignItems();
  if (items.length === 0) return;

  let reminders = 0;
  let managerEscalations = 0;
  let hrEscalations = 0;

  for (const item of items) {
    const key = cooldownKey(item.employee_id, item.checklist_id);
    const daysPending = Number(item.days_pending ?? 0);
    const deadline = item.expires_at
      ? new Date(item.expires_at).toLocaleDateString("en-IN")
      : "soon";

    // Daily reminder to employee (after day 1)
    if (daysPending >= 1 && canSend(reminderSent, key, REMINDER_COOLDOWN_MS)) {
      try {
        await notificationEventService.dispatch({
          eventCode: "esign_reminder",
          recipientEmployeeIds: [item.employee_id],
          data: {
            document_name: item.document_name,
            days_pending: String(daysPending),
            deadline,
          },
        });
        markSent(reminderSent, key);
        reminders++;
      } catch (err: any) {
        console.error("[EsignComplianceWorker] Reminder dispatch failed:", err.message);
      }
    }

    // Manager escalation (after 5 days)
    if (daysPending >= MANAGER_ESCALATION_DAYS && item.reporting_manager_id) {
      if (canSend(managerEscalated, key, ESCALATION_COOLDOWN_MS)) {
        const managerId = await getEmployeeIdForUser(item.reporting_manager_id);
        if (managerId) {
          try {
            await notificationEventService.dispatch({
              eventCode: "esign_escalation_manager",
              recipientEmployeeIds: [managerId],
              data: {
                employee_name: item.employee_name,
                employee_code: item.employee_code,
                document_name: item.document_name,
                days_pending: String(daysPending),
              },
            });
            markSent(managerEscalated, key);
            managerEscalations++;
          } catch (err: any) {
            console.error("[EsignComplianceWorker] Manager escalation failed:", err.message);
          }
        }
      }
    }

    // HR escalation (after 6 days — link about to expire)
    if (daysPending >= HR_ESCALATION_DAYS) {
      if (canSend(hrEscalated, key, ESCALATION_COOLDOWN_MS)) {
        const hrIds = await getHrUsersForBranch(item.branch_id);
        if (hrIds.length > 0) {
          try {
            await notificationEventService.dispatch({
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
            markSent(hrEscalated, key);
            hrEscalations++;
          } catch (err: any) {
            console.error("[EsignComplianceWorker] HR escalation failed:", err.message);
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

export async function startEsignComplianceWorker(): Promise<void> {
  console.log("[EsignComplianceWorker] Starting (interval: 4h)");
  await processEsignCompliance();
  intervalHandle = setInterval(async () => {
    cleanupCache(reminderSent, 7 * 24 * 60 * 60 * 1000);
    cleanupCache(managerEscalated, 7 * 24 * 60 * 60 * 1000);
    cleanupCache(hrEscalated, 7 * 24 * 60 * 60 * 1000);
    await processEsignCompliance();
  }, CHECK_INTERVAL_MS);
}

export function stopEsignComplianceWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
