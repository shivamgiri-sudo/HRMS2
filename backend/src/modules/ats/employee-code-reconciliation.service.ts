/**
 * Employee Code Reconciliation
 *
 * `ats_candidate.employee_code` and `ats_onboarding_bridge.employee_code` are denormalized
 * copies of `employees.employee_code`, written once at conversion time. Nothing keeps them in
 * sync afterward — so when `employees.employee_code` is later changed (a dedup/merge rename,
 * the kind of thing sql/1651-1652 did for 10 real people, renaming ats_candidate's own
 * `MAS634xx` codes to the older db_bill-canonical code they should have carried all along), the
 * ATS-side copy silently goes stale. Confirmed live 2026-09-11: 4 real employees (Jaswant Singh,
 * Altaf Raja, Dave Ujjawal, Nitin Rana) each have a fully real, live `employees` row, correctly
 * linked via `ats_onboarding_bridge.employee_id` — but their `ats_candidate.employee_code` still
 * shows the pre-rename code, which matches no row in `employees` at all. Searching HRMS for that
 * dead code finds nothing, even though the person is fully present under their current code.
 *
 * Two distinct problems, two checks:
 *
 *   1. STALE CODE (what actually happened here): a bridge row links to a real employee, but the
 *      denormalized code copies disagree with employees.employee_code. Auto-repair — refresh the
 *      copies from the one place that's actually authoritative. No human action needed; the
 *      employee already exists correctly, only the display copy was wrong.
 *
 *   2. TRUE ORPHAN (the scenario this was originally, wrongly, suspected to be): employee_code is
 *      set on the candidate but no bridge row points to a real employee at all — the conversion
 *      genuinely never finished and nobody was ever notified, because the code was set through a
 *      path that skipped POST /:candidateId/generate's own work_item creation (that endpoint sets
 *      employee_code and creates the follow-up work item in the same request; some other writer,
 *      not found among the 3 live paths audited 2026-09-11, must have set it without that step —
 *      this catches it regardless of which path did it, present or future). Raise the same
 *      EMPLOYEE_MASTER_CREATION work item /generate would have, so HR is actually notified.
 */
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { upsertOpenWorkItem } from '../../shared/workItem.js';

export interface ReconciliationResult {
  staleCodesRepaired: Array<{ candidateId: string; candidateCode: string; oldCode: string; newCode: string }>;
  orphansFlagged: Array<{ candidateId: string; candidateCode: string; employeeCode: string }>;
}

export async function reconcileEmployeeCodeDrift(): Promise<ReconciliationResult> {
  const staleCodesRepaired: ReconciliationResult['staleCodesRepaired'] = [];
  const orphansFlagged: ReconciliationResult['orphansFlagged'] = [];

  // Check 1 — stale denormalized code on an otherwise-real, correctly linked employee.
  const [staleRows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS candidate_id, c.candidate_code, c.employee_code AS stale_code,
            e.employee_code AS current_code
       FROM ats_candidate c
       JOIN ats_onboarding_bridge b ON b.candidate_id = c.id AND b.employee_id IS NOT NULL
       JOIN employees e ON e.id = b.employee_id
      WHERE c.employee_code IS NOT NULL
        AND c.employee_code <> e.employee_code`,
  );

  for (const row of staleRows as Array<{ candidate_id: string; candidate_code: string; stale_code: string; current_code: string }>) {
    await db.execute<ResultSetHeader>(
      `UPDATE ats_candidate SET employee_code = ?, updated_at = NOW() WHERE id = ?`,
      [row.current_code, row.candidate_id],
    );
    await db.execute<ResultSetHeader>(
      `UPDATE ats_onboarding_bridge SET employee_code = ?, updated_at = NOW() WHERE candidate_id = ?`,
      [row.current_code, row.candidate_id],
    ).catch(() => {
      // ats_onboarding_bridge.employee_code may not exist on an older bridge row shape; the
      // ats_candidate copy above is the one every current search path actually reads.
    });
    staleCodesRepaired.push({
      candidateId: row.candidate_id,
      candidateCode: row.candidate_code,
      oldCode: row.stale_code,
      newCode: row.current_code,
    });
  }

  // Check 2 — a code is set but no real employee is linked at all: a genuine unfinished
  // conversion, not a rename artifact. Raise the same work item /generate would have.
  const [orphanRows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS candidate_id, c.candidate_code, c.employee_code
       FROM ats_candidate c
       LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = c.id AND b.employee_id IS NOT NULL
      WHERE c.employee_code IS NOT NULL
        AND b.candidate_id IS NULL`,
  );

  for (const row of orphanRows as Array<{ candidate_id: string; candidate_code: string; employee_code: string }>) {
    await upsertOpenWorkItem({
      itemType: 'EMPLOYEE_MASTER_CREATION',
      title: 'Create employee master record',
      moduleCode: 'employees',
      entityType: 'candidate',
      entityId: row.candidate_id,
      assignedToRole: 'hr',
      priority: 'critical',
      description: `Reconciliation found employee_code ${row.employee_code} set with no linked employee record.`,
    }).catch(() => {});
    orphansFlagged.push({
      candidateId: row.candidate_id,
      candidateCode: row.candidate_code,
      employeeCode: row.employee_code,
    });
  }

  return { staleCodesRepaired, orphansFlagged };
}
