import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';

// ── SLABS ─────────────────────────────────────────────────────────────────────

export async function listSlabs() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *, label AS name, CASE WHEN active_status = 1 THEN 'active' ELSE 'inactive' END AS status
       FROM salary_slab_master
      WHERE active_status = 1
      ORDER BY seq_order ASC`
  );
  return rows;
}

export async function getSlabById(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *, label AS name, CASE WHEN active_status = 1 THEN 'active' ELSE 'inactive' END AS status
       FROM salary_slab_master WHERE id = ?`, [id]
  );
  return rows[0] ?? null;
}

export async function createSlab(data: {
  slab_code: string; range_from: number; range_to: number;
  label: string; seq_order: number; active_status: number;
}) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO salary_slab_master (id, slab_code, range_from, range_to, label, seq_order, active_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.slab_code, data.range_from, data.range_to, data.label, data.seq_order, data.active_status]
  );
  return getSlabById(id);
}

export async function updateSlab(id: string, data: Partial<{
  slab_code: string; range_from: number; range_to: number;
  label: string; seq_order: number; active_status: number;
}>) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  if (!fields) return getSlabById(id);
  await db.execute(`UPDATE salary_slab_master SET ${fields} WHERE id = ?`, [...Object.values(data), id]);
  return getSlabById(id);
}

export async function deleteSlab(id: string) {
  await db.execute('DELETE FROM salary_slab_master WHERE id = ?', [id]);
}

// ── PACKAGES ──────────────────────────────────────────────────────────────────

function calcGrossAndCtc(data: {
  basic_amt: number; conveyance_amt: number; conveyance_type: string;
  medical_amt: number; medical_type: string;
  other_allowance_amt: number; other_allowance_type: string;
  bonus_amt: number; bonus_type: string;
  portfolio_amt: number; special_allowance_amt: number; pli_amt: number;
}) {
  const conv   = data.conveyance_type   === 'pct' ? data.basic_amt * data.conveyance_amt   / 100 : data.conveyance_amt;
  const med    = data.medical_type      === 'pct' ? data.basic_amt * data.medical_amt      / 100 : data.medical_amt;
  const other  = data.other_allowance_type === 'pct' ? data.basic_amt * data.other_allowance_amt / 100 : data.other_allowance_amt;
  const bonus  = data.bonus_type        === 'pct' ? data.basic_amt * data.bonus_amt        / 100 : data.bonus_amt;
  const gross  = data.basic_amt + conv + med + other + bonus + data.portfolio_amt + data.special_allowance_amt + data.pli_amt;
  const pfBase   = Math.min(data.basic_amt, 15000);
  const pfEr     = pfBase * 0.12;
  const esicEr   = gross <= 21000 ? gross * 0.0325 : 0;
  const ctc      = gross + pfEr + esicEr;
  return { gross_monthly: Math.round(gross * 100) / 100, ctc_monthly: Math.round(ctc * 100) / 100 };
}

export async function listPackages(filters: {
  grade_id?: string; slab_id?: string; location_id?: string;
} = {}) {
  let sql = `
    SELECT spm.*,
           gbm.grade_name, gbm.band,
           ssm.label AS slab_label,
           lm.location_name,
           ccm.cost_centre_name
    FROM salary_package_master spm
    JOIN grade_band_master gbm ON gbm.id = spm.grade_id
    JOIN salary_slab_master ssm ON ssm.id = spm.slab_id
    LEFT JOIN location_master lm ON lm.id = spm.location_id
    LEFT JOIN cost_centre_master ccm ON ccm.id = spm.cost_centre_id
    WHERE 1=1`;
  const params: unknown[] = [];
  if (filters.grade_id)    { sql += ' AND spm.grade_id = ?';    params.push(filters.grade_id); }
  if (filters.slab_id)     { sql += ' AND spm.slab_id = ?';     params.push(filters.slab_id); }
  if (filters.location_id) { sql += ' AND spm.location_id = ?'; params.push(filters.location_id); }
  sql += ' ORDER BY gbm.band, ssm.seq_order';
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function getPackageById(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spm.*, gbm.grade_name, gbm.band, ssm.label AS slab_label
     FROM salary_package_master spm
     JOIN grade_band_master gbm ON gbm.id = spm.grade_id
     JOIN salary_slab_master ssm ON ssm.id = spm.slab_id
     WHERE spm.id = ?`, [id]
  );
  return rows[0] ?? null;
}

export async function createPackage(data: any, createdBy: string) {
  const id = randomUUID();
  const { gross_monthly, ctc_monthly } = calcGrossAndCtc(data);
  await db.execute(
    `INSERT INTO salary_package_master
       (id, grade_id, slab_id, location_id, cost_centre_id,
        basic_amt, conveyance_amt, conveyance_type,
        medical_amt, medical_type, other_allowance_amt, other_allowance_type,
        bonus_amt, bonus_type, portfolio_amt, special_allowance_amt, pli_amt,
        gross_monthly, ctc_monthly, effective_from, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.grade_id, data.slab_id, data.location_id ?? null, data.cost_centre_id ?? null,
     data.basic_amt ?? 0, data.conveyance_amt ?? 0, data.conveyance_type ?? 'fixed',
     data.medical_amt ?? 0, data.medical_type ?? 'fixed',
     data.other_allowance_amt ?? 0, data.other_allowance_type ?? 'fixed',
     data.bonus_amt ?? 0, data.bonus_type ?? 'fixed',
     data.portfolio_amt ?? 0, data.special_allowance_amt ?? 0, data.pli_amt ?? 0,
     gross_monthly, ctc_monthly, data.effective_from, createdBy]
  );
  return getPackageById(id);
}

export async function updatePackage(id: string, data: any) {
  const existing = await getPackageById(id);
  if (!existing) return null;
  const merged = { ...existing, ...data };
  const { gross_monthly, ctc_monthly } = calcGrossAndCtc(merged);
  await db.execute(
    `UPDATE salary_package_master SET
       basic_amt=?, conveyance_amt=?, conveyance_type=?,
       medical_amt=?, medical_type=?, other_allowance_amt=?, other_allowance_type=?,
       bonus_amt=?, bonus_type=?, portfolio_amt=?, special_allowance_amt=?, pli_amt=?,
       gross_monthly=?, ctc_monthly=?, effective_from=?, active_status=?
     WHERE id=?`,
    [merged.basic_amt, merged.conveyance_amt, merged.conveyance_type,
     merged.medical_amt, merged.medical_type, merged.other_allowance_amt, merged.other_allowance_type,
     merged.bonus_amt, merged.bonus_type, merged.portfolio_amt, merged.special_allowance_amt, merged.pli_amt,
     gross_monthly, ctc_monthly, merged.effective_from, merged.active_status ?? 1, id]
  );
  return getPackageById(id);
}

export async function deletePackage(id: string) {
  await db.execute('DELETE FROM salary_package_master WHERE id = ?', [id]);
}

// ── DESIGNATION-BAND MATRIX ───────────────────────────────────────────────────

export async function listMatrix(departmentId?: string) {
  let sql = `
    SELECT dbm.*,
           dm.dept_name   AS department_name,
           desm.designation_name,
           gbm.grade_name, gbm.band,
           ssm.label      AS min_slab_label
    FROM designation_band_matrix dbm
    JOIN department_master dm    ON dm.id   = dbm.department_id
    JOIN designation_master desm ON desm.id = dbm.designation_id
    JOIN grade_band_master gbm   ON gbm.id  = dbm.grade_id
    LEFT JOIN salary_slab_master ssm ON ssm.id = dbm.min_slab_id
    WHERE dbm.active_status = 1`;
  const params: unknown[] = [];
  if (departmentId) { sql += ' AND dbm.department_id = ?'; params.push(departmentId); }
  sql += ' ORDER BY dm.dept_name, desm.designation_name';
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function getMatrixEntryById(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dbm.*, dm.dept_name AS department_name, desm.designation_name,
            gbm.grade_name, gbm.band, ssm.label AS min_slab_label
     FROM designation_band_matrix dbm
     JOIN department_master dm ON dm.id = dbm.department_id
     JOIN designation_master desm ON desm.id = dbm.designation_id
     JOIN grade_band_master gbm ON gbm.id = dbm.grade_id
     LEFT JOIN salary_slab_master ssm ON ssm.id = dbm.min_slab_id
     WHERE dbm.id = ?`, [id]
  );
  return rows[0] ?? null;
}

export async function createMatrixEntry(data: {
  department_id: string; designation_id: string;
  grade_id: string; min_slab_id?: string | null;
}, createdBy: string) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO designation_band_matrix (id, department_id, designation_id, grade_id, min_slab_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE grade_id=VALUES(grade_id), min_slab_id=VALUES(min_slab_id), active_status=1`,
    [id, data.department_id, data.designation_id, data.grade_id, data.min_slab_id ?? null, createdBy]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT id FROM designation_band_matrix WHERE department_id=? AND designation_id=?',
    [data.department_id, data.designation_id]
  );
  return getMatrixEntryById((rows[0] as any).id);
}

export async function updateMatrixEntry(id: string, data: Partial<{
  grade_id: string; min_slab_id: string | null;
}>) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  if (!fields) return getMatrixEntryById(id);
  await db.execute(`UPDATE designation_band_matrix SET ${fields} WHERE id = ?`, [...Object.values(data), id]);
  return getMatrixEntryById(id);
}

export async function deleteMatrixEntry(id: string) {
  await db.execute('UPDATE designation_band_matrix SET active_status=0 WHERE id=?', [id]);
}

export async function bulkUpsertMatrix(
  rows: Array<{ department_id: string; designation_id: string; grade_id: string; min_slab_id?: string | null }>,
  createdBy: string
) {
  let inserted = 0;
  for (const row of rows) {
    await createMatrixEntry(row, createdBy);
    inserted++;
  }
  return { inserted };
}

export async function lookupBandForDesignation(departmentId: string, designationId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dbm.grade_id, dbm.min_slab_id,
            gbm.grade_name, gbm.band, gbm.min_ctc, gbm.max_ctc,
            ssm.label AS min_slab_label, ssm.range_from, ssm.range_to
     FROM designation_band_matrix dbm
     JOIN grade_band_master gbm ON gbm.id = dbm.grade_id
     LEFT JOIN salary_slab_master ssm ON ssm.id = dbm.min_slab_id
     WHERE dbm.department_id=? AND dbm.designation_id=? AND dbm.active_status=1
     LIMIT 1`,
    [departmentId, designationId]
  );
  if (!rows.length) return null;
  const entry = rows[0] as any;
  let suggestedPackage = null;
  if (entry.min_slab_id) {
    const [pkgs] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM salary_package_master WHERE grade_id=? AND slab_id=? AND active_status=1 ORDER BY effective_from DESC LIMIT 1`,
      [entry.grade_id, entry.min_slab_id]
    );
    suggestedPackage = pkgs[0] ?? null;
  }
  return { ...entry, suggested_package: suggestedPackage };
}

// ── MINIMUM WAGES ─────────────────────────────────────────────────────────────

export async function listMinWages() {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM minimum_wage_master WHERE is_active=1 ORDER BY state_code, category'
  );
  return rows;
}

export async function createMinWage(data: {
  state_code: string; state_name: string; category: string;
  daily_rate: number; monthly_rate: number; effective_from: string;
}) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO minimum_wage_master (id, state_code, state_name, category, daily_rate, monthly_rate, effective_from, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, data.state_code, data.state_name, data.category, data.daily_rate, data.monthly_rate, data.effective_from]
  );
  const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM minimum_wage_master WHERE id=?', [id]);
  return rows[0];
}

export async function updateMinWage(id: string, data: Partial<{
  state_code: string; state_name: string; category: string; daily_rate: number;
  monthly_rate: number; effective_from: string;
}>) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  if (!fields) return;
  await db.execute(`UPDATE minimum_wage_master SET ${fields} WHERE id=?`, [...Object.values(data), id]);
  const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM minimum_wage_master WHERE id=?', [id]);
  return rows[0];
}

export async function deleteMinWage(id: string) {
  await db.execute('UPDATE minimum_wage_master SET is_active=0 WHERE id=?', [id]);
}
