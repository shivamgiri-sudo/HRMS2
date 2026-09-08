/**
 * Cost Centre Drift Alert Cron
 * File: backend/src/modules/workforce-mandate/cost-centre-drift-alert.cron.ts
 *
 * Runs daily at 07:15 IST (staggered 45 min after hc-gap-alert's 06:30 run).
 *
 * Background: HR picks the cost centre at offer time in mas_hrms
 * (NativeHROnboardingRequests.tsx -> ats_employment_offer.cost_centre ->
 * employees.cost_centre_id / cost_center_code). db_bill — the legacy finance
 * ledger that drives client billing and is the payroll source of truth — has
 * no automatic writer for that field; Finance keys masjclrentry.CostCenter in
 * separately once they process a new joiner. mas_hrms has no path (and, per
 * the Database Boundary Rule, no permission) to write db_bill for them — see
 * db/billDb.ts's billQuery(), which physically blocks anything but a read.
 *
 * This job cannot close that gap by writing db_bill. What it CAN do
 * permanently is stop the gap from drifting unnoticed: it diffs mas_hrms's
 * employees.cost_center_code against db_bill.masjclrentry.CostCenter (by
 * EmpCode) for everyone who has been on payroll long enough that the normal
 * onboarding lag no longer explains a mismatch, and raises one grouped work
 * item per drifted cost centre to Finance so they can key the correction in
 * through db_bill's own process.
 *
 * Grace period: employees who joined in the last 15 days are excluded. That
 * window was sized against the real distribution found during the Onfido/
 * NOIDA-2 audit (2026-09-07) — the 23 genuine "not filed yet" mismatches all
 * had a date_of_joining within the last week; the 15-day cushion gives
 * Finance's normal cadence room before something is treated as stuck rather
 * than merely new.
 *
 * Deduplication: same as hc-gap-alert — checks audit_log for
 * COST_CENTRE_DRIFT_ALERT on the same cost centre in the last 24h.
 */

import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../db/mysql.js";
import { billQuery } from "../../db/billDb.js";
import { createWorkItem } from "../work-inbox/work-inbox.service.js";
import { randomUUID } from "crypto";

let nextRun: ReturnType<typeof setTimeout> | undefined;
const RUN_HOUR = 7;
const RUN_MINUTE = 15;
const GRACE_PERIOD_DAYS = 15;

interface DriftedEmployee {
  employee_code: string;
  full_name: string;
  date_of_joining: string;
  hrms_cost_centre_code: string;
  bill_cost_centre: string | null; // null = not found in db_bill at all
}

interface CostCentreDriftGroup {
  cost_centre_code: string;
  cost_centre_name: string | null;
  process_id: string | null;
  branch_id: string | null;
  branch_name: string | null;
  employees: DriftedEmployee[];
}

interface BillRow extends RowDataPacket {
  EmpCode: string;
  Status: string;
  CostCenter: string | null;
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
 * Finance owns db_bill's data entry; super_admin sees everything, same
 * convention as hc-gap-alert's resolveAlertRecipients.
 */
async function resolveAlertRecipients(): Promise<string[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT ur.user_id
       FROM user_roles ur
      WHERE ur.active_status = 1
        AND ur.role_key IN ('finance_head', 'super_admin')`
  );
  return (rows as RowDataPacket[]).map((r) => String(r.user_id));
}

async function findDriftedCostCentres(): Promise<CostCentreDriftGroup[]> {
  const [employeeRows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.employee_code, e.full_name, e.date_of_joining,
            e.cost_center_code, e.cost_centre_id, e.process_id, e.branch_id,
            b.branch_name, cc.cost_centre_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      WHERE e.active_status = 1
        AND e.cost_center_code IS NOT NULL
        AND e.cost_center_code <> ''
        AND e.date_of_joining <= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [GRACE_PERIOD_DAYS]
  );

  if (employeeRows.length === 0) return [];

  const codes = employeeRows.map((r) => String(r.employee_code));
  // db_bill has no bind-safe IN() helper of its own; billQuery still runs
  // through mysql2's parameterised execute(), so this stays injection-safe.
  const placeholders = codes.map(() => "?").join(",");
  const billRows = await billQuery<BillRow>(
    `SELECT EmpCode, Status, CostCenter FROM masjclrentry WHERE EmpCode IN (${placeholders})`,
    codes
  );
  const billMap = new Map(billRows.map((r) => [r.EmpCode, r]));

  const groups = new Map<string, CostCentreDriftGroup>();
  for (const e of employeeRows) {
    const hrmsCode = String(e.cost_center_code);
    const bill = billMap.get(String(e.employee_code));

    const isDrift =
      !bill || (bill.Status === "1" && bill.CostCenter !== hrmsCode);
    if (!isDrift) continue;

    if (!groups.has(hrmsCode)) {
      groups.set(hrmsCode, {
        cost_centre_code: hrmsCode,
        cost_centre_name: e.cost_centre_name ? String(e.cost_centre_name) : null,
        process_id: e.process_id ? String(e.process_id) : null,
        branch_id: e.branch_id ? String(e.branch_id) : null,
        branch_name: e.branch_name ? String(e.branch_name) : null,
        employees: [],
      });
    }
    groups.get(hrmsCode)!.employees.push({
      employee_code: String(e.employee_code),
      full_name: String(e.full_name),
      date_of_joining: String(e.date_of_joining),
      hrms_cost_centre_code: hrmsCode,
      bill_cost_centre: bill ? bill.CostCenter : null,
    });
  }

  return Array.from(groups.values());
}

async function checkCostCentreDrift(): Promise<void> {
  console.log("[cost-centre-drift-alert] Starting cost-centre drift check...");

  try {
    const groups = await findDriftedCostCentres();

    if (groups.length === 0) {
      console.log("[cost-centre-drift-alert] No drifted cost centres found. Done.");
      return;
    }

    console.log(`[cost-centre-drift-alert] Found ${groups.length} cost centre(s) with drift.`);
    const recipients = await resolveAlertRecipients();

    for (const group of groups) {
      const [[existing]] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM audit_log
          WHERE action_type = 'COST_CENTRE_DRIFT_ALERT'
            AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.cost_centre_code')) = ?
            AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          LIMIT 1`,
        [group.cost_centre_code]
      );
      if (existing) {
        console.log(`[cost-centre-drift-alert] Skipping ${group.cost_centre_code} — alerted within 24h`);
        continue;
      }

      const label = group.cost_centre_name
        ? `${group.cost_centre_name} (${group.cost_centre_code})`
        : group.cost_centre_code;
      const notFiledCount = group.employees.filter((e) => e.bill_cost_centre === null).length;
      const wrongCcCount = group.employees.length - notFiledCount;

      await pool.execute(
        `INSERT INTO audit_log (id, action_type, module_key, entity_type, entity_id, metadata_json, created_at)
         VALUES (?, 'COST_CENTRE_DRIFT_ALERT', 'workforce-mandate', 'cost_centre_master', ?, ?, NOW())`,
        [
          randomUUID(),
          group.cost_centre_code,
          JSON.stringify({
            cost_centre_code: group.cost_centre_code,
            cost_centre_name: group.cost_centre_name,
            branch_name: group.branch_name,
            drifted_count: group.employees.length,
            not_filed_in_db_bill: notFiledCount,
            wrong_cost_centre_in_db_bill: wrongCcCount,
            employee_codes: group.employees.map((e) => e.employee_code),
          }),
        ]
      );

      const descriptionLines = group.employees
        .slice(0, 15)
        .map((e) =>
          e.bill_cost_centre === null
            ? `${e.employee_code} (${e.full_name}) — not yet in db_bill, joined ${e.date_of_joining}`
            : `${e.employee_code} (${e.full_name}) — db_bill shows "${e.bill_cost_centre}"`
        )
        .join("\n");
      const more = group.employees.length > 15 ? `\n...and ${group.employees.length - 15} more` : "";

      for (const userId of recipients) {
        const [[already]] = await pool.execute<RowDataPacket[]>(
          `SELECT id FROM work_item
            WHERE item_type = 'COST_CENTRE_DRIFT' AND entity_id = ? AND assigned_to_user_id = ?
              AND status NOT IN ('completed', 'cancelled')
            LIMIT 1`,
          [group.cost_centre_code, userId]
        );
        if (already) continue;
        await createWorkItem({
          itemType: "COST_CENTRE_DRIFT",
          title: `${group.employees.length} employee(s) at ${label} not correctly filed in db_bill`,
          description:
            `mas_hrms and db_bill disagree on cost centre for ${group.employees.length} employee(s) ` +
            `who have been active for over ${GRACE_PERIOD_DAYS} days (so this isn't normal onboarding lag). ` +
            `${notFiledCount} not entered in db_bill at all, ${wrongCcCount} filed under a different cost centre.\n\n` +
            descriptionLines + more,
          moduleCode: "hrms",
          entityType: "cost_centre_master",
          entityId: group.cost_centre_code,
          assignedToUserId: userId,
          branchId: group.branch_id ?? undefined,
          processId: group.process_id ?? undefined,
          priority: group.employees.length >= 10 ? "high" : "medium",
          createdBy: "cost-centre-drift-alert",
        });
      }

      console.log(
        `[cost-centre-drift-alert] Alert logged for ${label}: ${group.employees.length} drifted employee(s); notified ${recipients.length} recipient(s)`
      );
    }

    console.log("[cost-centre-drift-alert] Cost-centre drift check complete.");
  } catch (error) {
    console.error("[cost-centre-drift-alert] Error during drift check:", error);
  }
}

function schedule(delayMs: number): void {
  nextRun = setTimeout(async () => {
    nextRun = undefined;
    try {
      await checkCostCentreDrift();
    } catch (err) {
      console.error("[cost-centre-drift-alert] Sweep error:", (err as Error).message);
    }
    schedule(millisecondsUntilNextRun());
  }, delayMs);
  nextRun.unref();
}

export function startCostCentreDriftAlertScheduler(): void {
  if (nextRun) return;
  schedule(millisecondsUntilNextRun());
  console.log("[cost-centre-drift-alert] Scheduler started: 07:15 daily");
}

export function stopCostCentreDriftAlertScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
  console.log("[cost-centre-drift-alert] Scheduler stopped");
}

// Exported for one-off manual verification (e.g. a script run outside the
// daily schedule) without waiting for 07:15 IST.
export { checkCostCentreDrift };
