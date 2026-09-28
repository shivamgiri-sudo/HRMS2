import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../db/mysql.js";

/**
 * After inserting a row into cost_centre_master, mirror it into the two tables
 * that drive UI dropdowns:
 *
 *   salary_cost_centre  — the db_bill sync mirror; the payroll/salary package
 *                         dropdowns resolve cost centres through this table.
 *   process_master      — the job-requisition process cascade reads from here;
 *                         without a matching row the process never appears.
 *
 * Called from costCentreService.create (org path) and
 * costCentreManagementService.create (finance path).  Both paths provide the
 * same four IDs; everything else is looked up here to keep callers simple.
 *
 * Re-entrant: ON DUPLICATE KEY / INSERT IGNORE make this safe to call again
 * on the same cost_centre_code without creating duplicates.
 */
export async function syncCostCentreRelatedTables(opts: {
  cost_centre_code: string;
  cost_centre_name: string;
  branch_id: string | null | undefined;
  client_id: string | null | undefined;
  process_id: string | null | undefined;
}): Promise<void> {
  const { cost_centre_code, cost_centre_name, branch_id, client_id, process_id } = opts;

  // ── look-ups ───────────────────────────────────────────────────────────────
  let branchName: string | null = null;
  if (branch_id) {
    const [[row]] = await db.execute<RowDataPacket[]>(
      `SELECT branch_name FROM branch_master WHERE id = ? LIMIT 1`,
      [branch_id]
    );
    branchName = (row as any)?.branch_name ?? null;
  }

  let clientName: string | null = null;
  if (client_id) {
    const [[row]] = await db.execute<RowDataPacket[]>(
      `SELECT client_name FROM client_master WHERE id = ? LIMIT 1`,
      [client_id]
    );
    clientName = (row as any)?.client_name ?? null;
  }

  let processName: string | null = null;
  if (process_id) {
    const [[row]] = await db.execute<RowDataPacket[]>(
      `SELECT process_name FROM process_master WHERE id = ? LIMIT 1`,
      [process_id]
    );
    processName = (row as any)?.process_name ?? null;
  }

  // ── salary_cost_centre ─────────────────────────────────────────────────────
  // branch_name is NOT NULL in the schema so only insert when we have it.
  if (branchName) {
    await db.execute(
      `INSERT INTO salary_cost_centre
         (cost_centre_code, display_name, branch_name, client_name, process_name,
          active_status, source_db)
       VALUES (?, ?, ?, ?, ?, 1, 'hrms2')
       ON DUPLICATE KEY UPDATE
         active_status = 1,
         display_name  = VALUES(display_name),
         client_name   = VALUES(client_name),
         process_name  = VALUES(process_name)`,
      [cost_centre_code, cost_centre_name, branchName, clientName, processName]
    );
  }

  // ── process_master: link an EXISTING process to its client ─────────────────
  /*
   * When the caller links the cost centre to a process that already exists, this used to do
   * nothing at all — "there is nothing to add". But there was: the client.
   *
   * process_master.client_id is the FK that says which client a process belongs to, and it was
   * NULL on all 132 live rows while process_master.client_name carried the real client on 40 of
   * them. Every cost centre created against an existing process knew its client_id and threw it
   * away, which is how the column stayed empty. That empty column is why manager and
   * process_manager were cut from the inbound-quality dashboard in the 2026-08-18 RBAC audit —
   * there was no way to scope them to a client.
   *
   * Only fills when the column is NULL. A process already pointing at a different client is
   * left alone: re-pointing it from here would silently move a process between clients as a
   * side effect of creating a cost centre. That needs a deliberate edit, not this.
   */
  if (process_id && client_id) {
    await db.execute(
      `UPDATE process_master
          SET client_id = ?,
              client_name = COALESCE(client_name, ?)
        WHERE id = ? AND client_id IS NULL`,
      [client_id, clientName, process_id]
    );
  }

  // ── process_master: create the row when there is no process yet ────────────
  // Derive a stable code from the CC code: slashes/spaces → underscores.
  if (!process_id && branch_id) {
    const derivedCode = cost_centre_code
      .replace(/[^A-Za-z0-9]/g, "_")
      .toUpperCase()
      .replace(/_+/g, "_")
      .slice(0, 50);

    await db.execute(
      `INSERT IGNORE INTO process_master
         (process_code, process_name, branch_id, client_id, client_name, active_status)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [derivedCode, cost_centre_name, branch_id, client_id ?? null, clientName]
    );
  }
}

function ccTypeToWorkload(ccType: string | null | undefined): string {
  switch ((ccType ?? "").toLowerCase().trim()) {
    case "inbound":     return "inbound_voice";
    case "blended":     return "blended";
    case "backoffice":
    case "back office": return "backoffice";
    case "chat":        return "chat";
    case "email":       return "email";
    default:            return "outbound_voice";
  }
}

function ccTypeToProcessType(ccType: string | null | undefined): string {
  switch ((ccType ?? "").toLowerCase().trim()) {
    case "inbound":     return "INBOUND";
    case "blended":     return "OUTBOUND";
    case "backoffice":
    case "back office": return "BACK_OFFICE";
    case "chat":        return "CHAT";
    case "email":       return "EMAIL";
    default:            return "OUTBOUND";
  }
}

/**
 * Creates process_master entries for any active cost centres that have a client_name
 * but no matching active process yet.
 *
 * Called nightly by cost-centre-process-resolver.worker after the db_bill sync lands
 * new cost centres — that path bypasses the API (which calls syncCostCentreRelatedTables
 * inline), so this is the backstop that closes the gap.
 *
 * Returns the count of newly created rows.
 */
export async function backfillProcessMasterForOrphanedCostCentres(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT cc.cost_centre_code, cc.client_name, cc.billing_client_name,
           cc.branch_id, cc.cc_type
    FROM cost_centre_master cc
    WHERE cc.client_name IS NOT NULL
      AND TRIM(cc.client_name) <> ''
      AND cc.active_status = 1
      AND LOWER(COALESCE(cc.status, '')) <> 'closed'
      AND NOT EXISTS (
        SELECT 1 FROM process_master pm
        WHERE TRIM(LOWER(pm.process_name)) = TRIM(LOWER(cc.client_name))
          AND pm.active_status = 1
      )
  `);

  let created = 0;
  for (const row of rows as Array<{
    cost_centre_code: string;
    client_name: string;
    billing_client_name: string | null;
    branch_id: string | null;
    cc_type: string | null;
  }>) {
    const derivedCode = row.cost_centre_code
      .replace(/[^A-Za-z0-9]/g, "_")
      .toUpperCase()
      .replace(/_+/g, "_")
      .slice(0, 50);

    const [result] = await db.execute<ResultSetHeader>(
      `INSERT IGNORE INTO process_master
         (process_code, process_name, branch_id, workload_type, process_type, client_name, active_status)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        derivedCode,
        row.client_name.trim(),
        row.branch_id ?? null,
        ccTypeToWorkload(row.cc_type),
        ccTypeToProcessType(row.cc_type),
        row.billing_client_name ?? null,
      ]
    );
    if (result.affectedRows > 0) created++;
  }
  return created;
}

/**
 * Cost centres linked to each process, with whether each is closed. A process is linked to a
 * cost centre by cost_centre_master.process_id, or by the process_code the backfill above
 * derives from cost_centre_code (non-alphanumerics -> "_", upper-cased, first 50 chars).
 */
const PROCESS_COST_CENTRE_LINKS_SQL = `
  WITH cc AS (
    SELECT process_id,
           LEFT(UPPER(REGEXP_REPLACE(cost_centre_code, '[^A-Za-z0-9]+', '_')), 50) AS derived_code,
           (active_status = 0 OR LOWER(COALESCE(status, '')) = 'closed') AS is_closed
      FROM cost_centre_master
  ),
  links AS (
    SELECT process_id AS pid, is_closed FROM cc WHERE process_id IS NOT NULL
    UNION ALL
    SELECT pm.id AS pid, cc.is_closed FROM process_master pm JOIN cc ON cc.derived_code = pm.process_code
  )`;

/**
 * Keeps process_master.active_status in step with the cost centres behind each process.
 * Owner ruling 2026-09-24: "if their cost centre is inactive then mark process also inactive
 * and it should be auto".
 *
 * Deactivates an active process when every cost centre linked to it is closed, unless it
 * still has active employees or an open approved requisition — those are left for a human
 * (moving the staff or reopening the cost centre), since flipping them would strand live
 * people on an inactive process. A process linked to no cost centre is never touched.
 *
 * Every automatic deactivation is recorded in process_master_auto_deactivation, and only
 * those recorded rows are reactivated automatically once one of their cost centres is open
 * again. Processes someone deactivated by hand are never reactivated here.
 *
 * Called nightly by cost-centre-process-resolver.worker.
 */
export async function syncProcessActiveStatusWithCostCentres(): Promise<{ deactivated: number; reactivated: number }> {
  const [toDeactivate] = await db.execute<RowDataPacket[]>(`
    ${PROCESS_COST_CENTRE_LINKS_SQL},
    all_closed AS (SELECT pid FROM links GROUP BY pid HAVING MIN(is_closed) = 1)
    SELECT pm.id, pm.process_code, pm.process_name
      FROM process_master pm
      JOIN all_closed ac ON ac.pid = pm.id
     WHERE pm.active_status = 1
       AND NOT EXISTS (
         SELECT 1 FROM employees e WHERE e.process_id = pm.id AND e.employment_status = 'active'
       )
       AND NOT EXISTS (
         SELECT 1 FROM job_requisition jr
          WHERE jr.process_id = pm.id AND jr.active_status = 1
            AND jr.approval_status = 'approved' AND jr.fulfilled_headcount < jr.requested_headcount
       )
  `);

  for (const row of toDeactivate as Array<{ id: string; process_code: string; process_name: string }>) {
    await db.execute(
      `INSERT INTO process_master_auto_deactivation (process_id, process_code, process_name, deactivated_at, reactivated_at)
       VALUES (?, ?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE deactivated_at = NOW(), reactivated_at = NULL`,
      [row.id, row.process_code, row.process_name],
    );
    await db.execute(
      `UPDATE process_master SET active_status = 0, updated_at = NOW() WHERE id = ? AND active_status = 1`,
      [row.id],
    );
  }

  const [toReactivate] = await db.execute<RowDataPacket[]>(`
    ${PROCESS_COST_CENTRE_LINKS_SQL},
    any_open AS (SELECT DISTINCT pid FROM links WHERE is_closed = 0)
    SELECT pm.id
      FROM process_master pm
      JOIN process_master_auto_deactivation d ON d.process_id = pm.id AND d.reactivated_at IS NULL
      JOIN any_open ao ON ao.pid = pm.id
     WHERE pm.active_status = 0
  `);

  for (const row of toReactivate as Array<{ id: string }>) {
    await db.execute(
      `UPDATE process_master SET active_status = 1, updated_at = NOW() WHERE id = ? AND active_status = 0`,
      [row.id],
    );
    await db.execute(
      `UPDATE process_master_auto_deactivation SET reactivated_at = NOW() WHERE process_id = ?`,
      [row.id],
    );
  }

  return { deactivated: toDeactivate.length, reactivated: toReactivate.length };
}
