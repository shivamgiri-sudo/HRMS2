/**
 * HC Gap Alert Cron
 * File: backend/src/modules/workforce-mandate/hc-gap-alert.cron.ts
 *
 * Runs daily at 06:30 IST.
 * For each active workforce mandate where coverage_pct < alert_threshold_pct,
 * logs an audit record and prints to console.
 *
 * Deduplication: Checks audit_log for HC_GAP_ALERT on same scope in last 24h.
 */

import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../db/mysql.js";
import { createWorkItem } from "../work-inbox/work-inbox.service.js";
import { randomUUID } from "crypto";

let nextRun: ReturnType<typeof setTimeout> | undefined;
const RUN_HOUR = 6;
const RUN_MINUTE = 30;

interface GapAlert {
  mandate_id: string;
  process_id: string | null;
  branch_id: string | null;
  process_name: string;
  branch_name: string | null;
  mandated_hc: number;
  alert_threshold_pct: number;
  coverage_pct: number;
  net_gap: number;
  hiring_demand: number;
}

function millisecondsUntilNextRun(): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(RUN_HOUR, RUN_MINUTE, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}


/**
 * Who is told about a shortage on this mandate.
 *
 * Owner rule (2026-09-03): super_admin sees every shortage; a branch head sees the ones in their
 * own scope. Recipients are resolved to USER IDS rather than assigned to a role, because
 * work_item routes on `assigned_to_role = <the reader's single role>` — a role-assigned item would
 * put every branch's shortage in every branch head's inbox, which is the opposite of the rule.
 *
 * A branch head with no scope row gets nothing rather than everything: the same fail-closed
 * behaviour buildScopeWhereClause applies to the board this alert links to.
 */
async function resolveAlertRecipients(gap: GapAlert): Promise<string[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT ur.user_id
       FROM mas_hrms.user_roles ur
      WHERE ur.active_status = 1
        AND (
          ur.role_key = 'super_admin'
          OR (
            ur.role_key IN ('branch_head', 'branch_manager')
            AND EXISTS (
              SELECT 1 FROM mas_hrms.user_assignment_scope uas
               WHERE uas.user_id = ur.user_id
                 AND uas.active_status = 1
                 AND (
                   uas.scope_type = 'all'
                   OR (uas.branch_id IS NOT NULL AND uas.branch_id = ?)
                   OR (uas.process_id IS NOT NULL AND uas.process_id = ?)
                 )
            )
          )
        )`,
    [gap.branch_id, gap.process_id]
  );
  return (rows as RowDataPacket[]).map((r) => String(r.user_id));
}

async function checkHcGaps(): Promise<void> {
  console.log("[hc-gap-alert] Starting HC gap check...");

  try {
    const sql = `
      WITH live_counts AS (
        SELECT
          wm.id AS mandate_id,
          wm.process_id,
          wm.branch_id,
          p.process_name,
          b.branch_name,
          wm.mandated_hc,
          COALESCE(wm.alert_threshold_pct, 80.00) AS alert_threshold_pct,
          wm.shrinkage_pct,
          wm.attrition_buffer_pct,
          wm.training_buffer_pct,
          (SELECT COUNT(*) FROM mas_hrms.employees e
           WHERE e.process_id = wm.process_id
             AND (wm.branch_id IS NULL OR e.branch_id = wm.branch_id)
             AND e.active_status = 1) AS active_hc,
          (SELECT COUNT(*) FROM mas_hrms.employees e
           JOIN mas_hrms.exit_request er ON er.employee_id = e.id
           WHERE e.process_id = wm.process_id
             AND (wm.branch_id IS NULL OR e.branch_id = wm.branch_id)
             AND e.active_status = 1
             AND er.status IN ('accepted','notice_serving')) AS on_notice_hc,
          (SELECT COUNT(DISTINCT lr.employee_id) FROM mas_hrms.leave_request lr
           JOIN mas_hrms.employees e ON e.id = lr.employee_id
           WHERE e.process_id = wm.process_id
             AND (wm.branch_id IS NULL OR e.branch_id = wm.branch_id)
             AND e.active_status = 1
             AND lr.status = 'approved'
             AND lr.start_date <= CURDATE()
             AND lr.end_date >= DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS long_leave_hc,
          (SELECT COUNT(*) FROM mas_hrms.employees e
           WHERE e.process_id = wm.process_id
             AND (wm.branch_id IS NULL OR e.branch_id = wm.branch_id)
             AND e.active_status = 1
             AND DATEDIFF(CURDATE(), e.date_of_joining) <= 30) AS in_training_hc
        FROM mas_hrms.workforce_mandate wm
        JOIN mas_hrms.process_master p ON p.id = wm.process_id
        LEFT JOIN mas_hrms.branch_master b ON b.id = wm.branch_id
        WHERE wm.effective_from <= CURDATE()
          AND (wm.effective_to IS NULL OR wm.effective_to > CURDATE())
      ),
      formula AS (
        SELECT
          mandate_id,
          process_name,
          branch_name,
          mandated_hc,
          alert_threshold_pct,
          active_hc,
          on_notice_hc,
          long_leave_hc,
          in_training_hc,
          ROUND(
            mandated_hc * (1 + shrinkage_pct / 100)
            / (1 - attrition_buffer_pct / 100 - training_buffer_pct / 100)
          , 0) AS required_staffed_hc,
          (active_hc - on_notice_hc - long_leave_hc - in_training_hc) AS available_production_hc
        FROM live_counts
      )
      SELECT
        mandate_id,
        process_id,
        branch_id,
        process_name,
        branch_name,
        mandated_hc,
        alert_threshold_pct,
        ROUND(
          CASE WHEN required_staffed_hc > 0
               THEN (available_production_hc / required_staffed_hc) * 100
               ELSE 0 END
        , 1) AS coverage_pct,
        GREATEST(0, required_staffed_hc - available_production_hc) AS net_gap,
        GREATEST(0, required_staffed_hc - available_production_hc) + on_notice_hc AS hiring_demand
      FROM formula
      WHERE ROUND(
          CASE WHEN required_staffed_hc > 0
               THEN (available_production_hc / required_staffed_hc) * 100
               ELSE 0 END
        , 1) < alert_threshold_pct
    `;

    const [gaps] = await pool.execute<RowDataPacket[]>(sql);

    if (gaps.length === 0) {
      console.log("[hc-gap-alert] No HC gaps below threshold. Done.");
      return;
    }

    console.log(`[hc-gap-alert] Found ${gaps.length} mandates below threshold.`);

    for (const gap of gaps as GapAlert[]) {
      const [[existing]] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM mas_hrms.audit_log
         WHERE action_type = 'HC_GAP_ALERT'
           AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.mandate_id')) = ?
           AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         LIMIT 1`,
        [gap.mandate_id]
      );

      if (existing) {
        console.log(`[hc-gap-alert] Skipping ${gap.process_name} (${gap.branch_name ?? "all branches"}) — alerted within 24h`);
        continue;
      }

      const scopeLabel = gap.branch_name
        ? `${gap.process_name} (${gap.branch_name})`
        : gap.process_name;

      await pool.execute(
        `INSERT INTO mas_hrms.audit_log (id, action_type, entity_type, entity_id, payload, created_at)
         VALUES (?, 'HC_GAP_ALERT', 'workforce_mandate', ?, ?, NOW())`,
        [
          randomUUID(),
          gap.mandate_id,
          JSON.stringify({
            mandate_id: gap.mandate_id,
            process_name: gap.process_name,
            branch_name: gap.branch_name,
            coverage_pct: gap.coverage_pct,
            alert_threshold_pct: gap.alert_threshold_pct,
            net_gap: gap.net_gap,
            hiring_demand: gap.hiring_demand,
          }),
        ]
      );

      // Deliver it. Until now this cron wrote an audit row and told nobody — the worker
      // registration comment claimed it "fires push notifications to HR Admin + Branch Head"
      // and no such code existed.
      const recipients = await resolveAlertRecipients(gap);
      for (const userId of recipients) {
        const [[already]] = await pool.execute<RowDataPacket[]>(
          `SELECT id FROM mas_hrms.work_item
            WHERE item_type = 'HIRING_SHORTAGE' AND entity_id = ? AND assigned_to_user_id = ?
              AND status NOT IN ('completed', 'cancelled')
            LIMIT 1`,
          [gap.mandate_id, userId]
        );
        if (already) continue;
        await createWorkItem({
          itemType: "HIRING_SHORTAGE",
          title: `${scopeLabel} is ${gap.hiring_demand} short of mandate`,
          description:
            `Coverage is ${gap.coverage_pct}% against a threshold of ${gap.alert_threshold_pct}%. ` +
            `Mandate ${gap.mandated_hc}, gap ${gap.net_gap}, hiring demand ${gap.hiring_demand} ` +
            `(includes people already on notice).`,
          moduleCode: "hrms",
          entityType: "workforce_mandate",
          entityId: gap.mandate_id,
          assignedToUserId: userId,
          branchId: gap.branch_id ?? undefined,
          processId: gap.process_id ?? undefined,
          priority: gap.coverage_pct < 50 ? "critical" : "high",
          createdBy: "hc-gap-alert",
        });
      }

      console.log(`[hc-gap-alert] Alert logged for ${scopeLabel}: coverage ${gap.coverage_pct}%, gap ${gap.net_gap}, hiring demand ${gap.hiring_demand}; notified ${recipients.length} recipient(s)`);
    }

    console.log("[hc-gap-alert] HC gap check complete.");
  } catch (error) {
    console.error("[hc-gap-alert] Error during HC gap check:", error);
  }
}

function schedule(delayMs: number): void {
  nextRun = setTimeout(async () => {
    nextRun = undefined;
    try {
      await checkHcGaps();
    } catch (err) {
      console.error("[hc-gap-alert] Sweep error:", (err as Error).message);
    }
    schedule(millisecondsUntilNextRun());
  }, delayMs);
  nextRun.unref();
}

export function startHcGapAlertScheduler(): void {
  if (nextRun) return;
  schedule(millisecondsUntilNextRun());
  console.log("[hc-gap-alert] Scheduler started: 06:30 daily");
}

export function stopHcGapAlertScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
  console.log("[hc-gap-alert] Scheduler stopped");
}
