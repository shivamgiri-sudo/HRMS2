import type { RowDataPacket } from "mysql2";
import { daysBetween } from "../rehireFacts.js";
import { num, numOrNull, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface ExitSection {
  exitRequestId: string;
  exitType: string | null;
  subType: string | null;
  reasonCategory: string | null;
  reasonText: string | null;
  /** Last day the employee was actually present, for absconding / abandonment. */
  abscondingSince: string | null;
  lastWorkingDay: string | null;
  status: string;
  notice: { requiredDays: number | null; servedDays: number | null; shortfallDays: number | null };
  clearance: { total: number; done: number; pending: { department: string; remarks: string | null }[] };
  assetsHeld: { name: string; category: string | null; assigned: string | null }[];
  ff: { netPayable: number | null; status: string; paid: boolean } | null;
}

// Latest real exit. Drafts are not exits. A 'rejoined' exit is still shown: it is the history the
// branch head is judging, and it is what the open request refers to until approval.
const EXIT_SQL = `
  SELECT id, exit_type, exit_sub_type, exit_reason_category, resignation_reason,
         DATE_FORMAT(absconding_since, '%Y-%m-%d') AS absconding_since,
         DATE_FORMAT(COALESCE(last_working_day_confirmed, last_working_day_proposed), '%Y-%m-%d') AS lwd,
         notice_period_days, DATE_FORMAT(notice_start_date, '%Y-%m-%d') AS notice_start_date, status
    FROM exit_request
   WHERE employee_id = ? AND LOWER(status) NOT IN ('draft')
   ORDER BY created_at DESC
   LIMIT 1`;
const CLEARANCE_SQL = `
  SELECT department, status, remarks FROM exit_clearance_checklist WHERE exit_request_id = ? ORDER BY department`;
const ASSET_SQL = `
  SELECT am.asset_name AS asset_name, am.asset_category AS asset_category,
         DATE_FORMAT(aa.assigned_date, '%Y-%m-%d') AS assigned_date
    FROM asset_assignment aa
    JOIN asset_master am ON am.id = aa.asset_id
   WHERE aa.employee_id = ? AND aa.returned_date IS NULL`;
const FF_SQL = `
  SELECT net_payable, status, ff_paid_at FROM full_final_calculation
   WHERE exit_request_id = ? ORDER BY created_at DESC LIMIT 1`;

export async function loadExitSection(db: SqlExecutor, w: DossierWindow): Promise<ExitSection | null> {
  const [exitRows] = await db.execute<RowDataPacket[]>(EXIT_SQL, [w.employeeId]);
  const x = exitRows[0];
  if (!x) return null;

  const [clearRows] = await db.execute<RowDataPacket[]>(CLEARANCE_SQL, [x.id]);
  const [assetRows] = await db.execute<RowDataPacket[]>(ASSET_SQL, [w.employeeId]);
  const [ffRows] = await db.execute<RowDataPacket[]>(FF_SQL, [x.id]);

  const required = numOrNull(x.notice_period_days);
  const served = x.notice_start_date && x.lwd ? Math.max(0, daysBetween(x.notice_start_date, x.lwd)) : null;
  const shortfall = required !== null && served !== null ? Math.max(0, required - served) : null;

  const isDone = (s: unknown) => ["cleared", "waived"].includes(String(s).toLowerCase());
  const ff = ffRows[0];

  return {
    exitRequestId: String(x.id),
    exitType: x.exit_type ?? null,
    subType: x.exit_sub_type ?? null,
    reasonCategory: x.exit_reason_category ?? null,
    reasonText: x.resignation_reason ?? null,
    abscondingSince: x.absconding_since ?? null,
    lastWorkingDay: x.lwd ?? null,
    status: String(x.status),
    notice: { requiredDays: required, servedDays: served, shortfallDays: shortfall },
    clearance: {
      total: clearRows.length,
      done: clearRows.filter((r) => isDone(r.status)).length,
      pending: clearRows
        .filter((r) => !isDone(r.status) && String(r.status).toLowerCase() !== "superseded")
        .map((r) => ({ department: String(r.department), remarks: r.remarks ?? null })),
    },
    assetsHeld: assetRows.map((r) => ({
      name: String(r.asset_name),
      category: r.asset_category ?? null,
      assigned: r.assigned_date ?? null,
    })),
    ff: ff ? { netPayable: numOrNull(ff.net_payable), status: String(ff.status), paid: ff.ff_paid_at != null } : null,
  };
}
