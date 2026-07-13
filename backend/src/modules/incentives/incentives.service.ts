import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';

// ── INCENTIVE MASTER ──────────────────────────────────────────────────────────

export async function listIncentiveMasters(includeInactive = false) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *, CASE WHEN active_status = 1 THEN 'active' ELSE 'inactive' END AS status
       FROM incentive_master
      ${includeInactive ? '' : 'WHERE active_status = 1'}
      ORDER BY incentive_name`
  );
  return rows;
}

export async function toggleIncentiveMaster(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT active_status FROM incentive_master WHERE id=?', [id]
  );
  if (!(rows as any[]).length) throw new Error('Incentive type not found');
  const current = (rows[0] as any).active_status;
  await db.execute('UPDATE incentive_master SET active_status=? WHERE id=?', [current ? 0 : 1, id]);
  return { active_status: current ? 0 : 1 };
}

export async function getIncentiveMasterById(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *, CASE WHEN active_status = 1 THEN 'active' ELSE 'inactive' END AS status
       FROM incentive_master WHERE id=?`, [id]
  );
  return rows[0] ?? null;
}

export async function createIncentiveMaster(data: {
  incentive_code: string; incentive_name: string;
  description?: string | null; gl_code?: string | null;
  taxable: number; pf_applicable: number; esic_applicable: number;
}, createdBy: string) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO incentive_master
       (id, incentive_code, incentive_name, description, gl_code, taxable, pf_applicable, esic_applicable, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.incentive_code, data.incentive_name, data.description ?? null, data.gl_code ?? null,
     data.taxable, data.pf_applicable, data.esic_applicable, createdBy]
  );
  return getIncentiveMasterById(id);
}

export async function updateIncentiveMaster(id: string, data: Partial<{
  incentive_code: string; incentive_name: string; description: string | null;
  gl_code: string | null; taxable: number; pf_applicable: number; esic_applicable: number;
}>) {
  const fields = Object.keys(data).map(k => `${k}=?`).join(', ');
  if (!fields) return getIncentiveMasterById(id);
  await db.execute(`UPDATE incentive_master SET ${fields} WHERE id=?`, [...Object.values(data), id]);
  return getIncentiveMasterById(id);
}

export async function softDeleteIncentiveMaster(id: string) {
  await db.execute('UPDATE incentive_master SET active_status=0 WHERE id=?', [id]);
}

// ── BATCHES ───────────────────────────────────────────────────────────────────

export async function listBatches(payMonth?: string) {
  let sql = `
    SELECT iub.*, im.incentive_name, im.incentive_code
    FROM incentive_upload_batch iub
    JOIN incentive_master im ON im.id = iub.incentive_id
    WHERE 1=1`;
  const params: unknown[] = [];
  if (payMonth) { sql += ' AND iub.pay_month=?'; params.push(payMonth); }
  sql += ' ORDER BY iub.pay_month DESC, im.incentive_name';
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function getBatchById(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT iub.*, im.incentive_name, im.incentive_code
     FROM incentive_upload_batch iub
     JOIN incentive_master im ON im.id = iub.incentive_id
     WHERE iub.id=?`, [id]
  );
  return rows[0] ?? null;
}

export async function createBatch(data: {
  incentive_id: string; pay_month: string; remarks?: string | null;
}, uploadedBy: string) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO incentive_upload_batch (id, incentive_id, pay_month, uploaded_by, remarks)
     VALUES (?, ?, ?, ?, ?)`,
    [id, data.incentive_id, data.pay_month, uploadedBy, data.remarks ?? null]
  );
  return getBatchById(id);
}

export async function getBatchLines(batchId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT iul.*,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name
     FROM incentive_upload_line iul
     JOIN employees e ON e.id = iul.employee_id
     WHERE iul.batch_id=?
     ORDER BY employee_name`,
    [batchId]
  );
  return rows;
}

export async function importLines(
  batchId: string,
  rows: Array<{ employee_code: string; amount: number; remarks?: string | null }>
) {
  if (!rows.length) {
    return { imported: 0, valid: 0, total_amount: 0 };
  }

  const codes = Array.from(new Set(rows.map(r => String(r.employee_code ?? '').trim()).filter(Boolean)));
  if (!codes.length) {
    return { imported: rows.length, valid: 0, total_amount: 0 };
  }

  const placeholders = codes.map(() => '?').join(',');
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code
       FROM employees
      WHERE employee_code IN (${placeholders})
        AND active_status = 1
        AND LOWER(COALESCE(employment_status, 'active')) NOT IN ('inactive', 'terminated', 'offboarded', 'absconded')`,
    codes
  );
  const empMap = new Map<string, string>();
  for (const e of empRows as any[]) empMap.set(String(e.employee_code), e.id);

  let validCount = 0;
  let totalAmount = 0;

  for (const row of rows) {
    const code = String(row.employee_code ?? '').trim();
    const empId = empMap.get(code);
    const id = randomUUID();
    const amount = Number(row.amount ?? 0);
    const isValid = !!empId && Number.isFinite(amount) && amount > 0;
    await db.execute(
      `INSERT INTO incentive_upload_line
         (id, batch_id, employee_id, employee_code, amount, remarks, validation_status, validation_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         amount=VALUES(amount), remarks=VALUES(remarks),
         validation_status=VALUES(validation_status), validation_msg=VALUES(validation_msg)`,
      [id, batchId,
       empId ?? '00000000-0000-0000-0000-000000000000',
       code,
       Number.isFinite(amount) ? amount : 0,
       row.remarks ?? null,
       isValid ? 'ok' : 'error',
       isValid ? null : !empId ? `Employee code '${code}' not found or inactive` : `Amount must be greater than 0`]
    );
    if (isValid) { validCount++; totalAmount += amount; }
  }

  await db.execute(
    'UPDATE incentive_upload_batch SET total_employees=?, total_amount=? WHERE id=?',
    [validCount, totalAmount, batchId]
  );
  return { imported: rows.length, valid: validCount, total_amount: totalAmount };
}

async function logApproval(batchId: string, actorId: string, action: string, remarks?: string | null) {
  const id = randomUUID();
  await db.execute(
    'INSERT INTO incentive_approval_log (id, batch_id, actor_user_id, action, remarks) VALUES (?, ?, ?, ?, ?)',
    [id, batchId, actorId, action, remarks ?? null]
  );
}

async function transitionBatch(batchId: string, newStatus: string, actorId: string, action: string, remarks?: string | null) {
  await db.execute('UPDATE incentive_upload_batch SET status=? WHERE id=?', [newStatus, batchId]);
  await logApproval(batchId, actorId, action, remarks);
  return getBatchById(batchId);
}

export async function submitBatch(batchId: string, actorId: string) {
  return transitionBatch(batchId, 'pending_approval', actorId, 'submitted');
}

export async function approveBatch(batchId: string, actorId: string, remarks?: string | null) {
  return transitionBatch(batchId, 'approved', actorId, 'approved', remarks);
}

export async function rejectBatch(batchId: string, actorId: string, remarks?: string | null) {
  return transitionBatch(batchId, 'rejected', actorId, 'rejected', remarks);
}

export async function applyToRun(runId: string, payMonth: string, actorId: string) {
  // Clear previous incentive components and rollup for this run
  await db.execute(
    `DELETE FROM salary_prep_line_component
     WHERE line_id IN (SELECT id FROM salary_prep_line WHERE run_id=?)
       AND (component_code LIKE 'INCEN_%' OR component_code = 'INCENTIVE')`,
    [runId]
  );

  await db.execute(
    'UPDATE salary_prep_line SET incentive_total=0 WHERE run_id=?',
    [runId]
  );

  const [batches] = await db.execute<RowDataPacket[]>(
    `SELECT iub.id, im.incentive_code, im.incentive_name, im.taxable
     FROM incentive_upload_batch iub
     JOIN incentive_master im ON im.id = iub.incentive_id
     WHERE iub.pay_month=? AND iub.status='approved'`,
    [payMonth]
  );

  // Accumulate per-employee totals across all batches
  const employeeTotals = new Map<string, { prepLineId: string; total: number }>();

  let applied = 0;
  for (const batch of batches as any[]) {
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT iul.employee_id, iul.amount
       FROM incentive_upload_line iul
       WHERE iul.batch_id=? AND iul.validation_status='ok'`,
      [batch.id]
    );

    for (const line of lines as any[]) {
      const [prepLines] = await db.execute<RowDataPacket[]>(
        'SELECT id FROM salary_prep_line WHERE run_id=? AND employee_id=? LIMIT 1',
        [runId, line.employee_id]
      );
      if (!prepLines.length) continue;
      const prepLineId = (prepLines[0] as any).id;

      // Insert per-type component (INCEN_NSA, INCEN_PERF, etc.)
      await db.execute(
        `INSERT INTO salary_prep_line_component
           (id, run_id, line_id, employee_id, component_code, component_name, component_type, amount, source, taxable)
         VALUES (?, ?, ?, ?, ?, ?, 'earning', ?, 'incentive', ?)
         ON DUPLICATE KEY UPDATE amount=VALUES(amount)`,
        [randomUUID(), runId, prepLineId, line.employee_id,
         `INCEN_${batch.incentive_code}`, batch.incentive_name,
         line.amount, batch.taxable ?? 1]
      );

      // Accumulate total for rollup
      const prev = employeeTotals.get(line.employee_id);
      if (prev) {
        prev.total += Number(line.amount);
      } else {
        employeeTotals.set(line.employee_id, { prepLineId, total: Number(line.amount) });
      }
      applied++;
    }

    await transitionBatch(batch.id, 'applied', actorId, 'applied');
  }

  // Insert/update rollup INCENTIVE component and update gross/net on salary_prep_line
  for (const [employeeId, { prepLineId, total }] of employeeTotals) {
    // Rollup component for payslip display (PayslipViewer reads earning("INCENTIVE"))
    await db.execute(
      `INSERT INTO salary_prep_line_component
         (id, run_id, line_id, employee_id, component_code, component_name, component_type, amount, source, taxable)
       VALUES (?, ?, ?, ?, 'INCENTIVE', 'Total Incentive', 'earning', ?, 'incentive', 1)
       ON DUPLICATE KEY UPDATE amount=VALUES(amount)`,
      [randomUUID(), runId, prepLineId, employeeId, total]
    );

    // Update incentive_total, gross_salary and net_salary on the prep line
    await db.execute(
      `UPDATE salary_prep_line
       SET incentive_total = ?,
           gross_salary    = gross_salary + ?,
           net_salary      = net_salary + ?
       WHERE id = ?`,
      [total, total, total, prepLineId]
    );
  }

  // Stamp the run so recalculation knows incentives are applied
  if (applied > 0) {
    await db.execute(
      `UPDATE salary_prep_run SET incentives_applied_at = NOW() WHERE id = ?`,
      [runId]
    );
  }

  return { batches_applied: (batches as any[]).length, lines_applied: applied };
}
