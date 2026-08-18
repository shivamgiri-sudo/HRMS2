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

// ── SALARY BANDS ──────────────────────────────────────────────────────────────

export async function listBands(includeInactive = false) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, band_code, band_name, slab_from, slab_to, active_status, created_at, updated_at
       FROM salary_band_master
      ${includeInactive ? '' : 'WHERE active_status = 1'}
      ORDER BY slab_from ASC, band_code ASC`
  );
  return rows;
}

export async function getBandById(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, band_code, band_name, slab_from, slab_to, active_status, created_at, updated_at
       FROM salary_band_master
      WHERE id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createBand(data: {
  band_code: string; band_name: string; slab_from: number; slab_to: number; active_status: number;
}) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO salary_band_master (id, band_code, band_name, slab_from, slab_to, active_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, data.band_code, data.band_name, data.slab_from, data.slab_to, data.active_status]
  );
  return getBandById(id);
}

export async function updateBand(id: string, data: Partial<{
  band_code: string; band_name: string; slab_from: number; slab_to: number; active_status: number;
}>) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  if (!fields) return getBandById(id);
  await db.execute(`UPDATE salary_band_master SET ${fields}, updated_at = NOW() WHERE id = ?`, [...Object.values(data), id]);
  return getBandById(id);
}

export async function deleteBand(id: string) {
  await updateBand(id, { active_status: 0 });
}

// ── PACKAGES ──────────────────────────────────────────────────────────────────

/**
 * DEAD as of 2026-08-12. Every field it reads (basic_amt, conveyance_type,
 * medical_amt, ...) is absent from both the request payload and
 * salary_package_master, so it returns NaN. Kept for reference while the
 * intended component/percentage model is decided; it must not be applied to
 * salary data until its inputs exist.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const esicEr   = gross <= 21000 ? gross * 0.0325 : 0; // 3.25% — kept as constant; CTC preview only
  const ctc      = gross + pfEr + esicEr;
  return { gross_monthly: Math.round(gross * 100) / 100, ctc_monthly: Math.round(ctc * 100) / 100 };
}

export async function listPackages(filters: {
  grade_id?: string; slab_id?: string; location_id?: string;
} = {}) {
  let sql = `
    SELECT spm.*
    FROM salary_package_master spm
    WHERE 1=1`;
  const params: unknown[] = [];
  sql += ' ORDER BY spm.created_at DESC';
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function getPackageById(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    /*
     * salary_package_master has neither grade_id nor slab_id. It is keyed by band_code ('A'..'E'),
     * so both joins raised ER_BAD_FIELD_ERROR and no salary package could be fetched by id.
     *
     * The grade link is real but stored with a prefix on one side: grade_band_master.band reads
     * 'Band A' where band_code reads 'A'. Measured against live data, that comparison matches 220
     * of 295 packages one-to-one with no fan-out, while gbm.band = band_code and
     * gbm.grade_code = band_code both match 0. LEFT, not INNER, so the 75 packages whose band_code
     * has no grade row still return - the point of this function is to fetch the package.
     *
     * There is no slab link at all. No column references salary_slab_master, and joining on
     * package_amount BETWEEN range_from AND range_to is not a substitute: it returns 847 rows for
     * 295 packages, so the slab ranges overlap and it would silently multiply every package.
     * slab_label is selected as NULL to keep the response shape rather than inventing a value.
     */
    `SELECT spm.*, gbm.grade_name, gbm.band, NULL AS slab_label
     FROM salary_package_master spm
     LEFT JOIN grade_band_master gbm ON gbm.band = CONCAT('Band ', spm.band_code)
     WHERE spm.id = ?`, [id]
  );
  return rows[0] ?? null;
}

/**
 * Money fields are optional on the wire; the column default is 0.00. Anything
 * unparseable becomes 0 rather than NaN, which MySQL would reject outright.
 */
function amt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The columns salary_package_master actually has, in the order the statements
 * below use them. branch_name, band_code and package_amount are NOT NULL with
 * no default, so they are required; every other money column defaults to 0.00.
 */
const PACKAGE_MONEY_COLUMNS = [
  "basic", "hra", "lta", "conveyance", "portfolio", "medical", "special_allowance",
  "other_allowance", "bonus", "pli", "gross", "epf_employee", "esic_employee",
  "professional_tax", "net_in_hand", "epf_employer", "esic_employer",
  "admin_charges", "ctc",
] as const;

function requirePackageKeys(data: Record<string, unknown>): void {
  const missing = ["branch_name", "band_code", "package_amount"].filter(
    (k) => data[k] === undefined || data[k] === null || data[k] === ""
  );
  if (missing.length) {
    throw Object.assign(
      new Error(`Missing required field(s): ${missing.join(", ")}`),
      { statusCode: 400, code: "PACKAGE_FIELDS_REQUIRED" }
    );
  }
}

/**
 * Create a salary package.
 *
 * This wrote grade_id, slab_id, location_id, cost_centre_id, basic_amt,
 * conveyance_type, gross_monthly, ctc_monthly and effective_from. Not one of
 * those columns exists. salary_package_master is keyed by branch_name +
 * cost_centre_code + band_code and stores the breakdown as basic/hra/conveyance
 * /... plus the statutory columns, so every create and update has always failed
 * with ER_BAD_FIELD_ERROR. The 295 rows in the table all carry
 * source_db = 'db_bill' and created_by NULL - nothing has ever been created
 * through this API.
 *
 * The UI was never the problem: NativeSalaryPackageAdmin posts branch_name,
 * cost_centre_code, band_code, package_amount and the real money columns, and
 * refuses to submit without the first three. The page and the database agreed
 * with each other; only this layer disagreed with both.
 *
 * Values are stored as supplied rather than recomputed. calcGrossAndCtc() below
 * derives gross and CTC from basic_amt/conveyance_type/... - fields no caller
 * sends and no column holds - so it yields NaN and is left unused rather than
 * applied to real salary data.
 */
export async function createPackage(data: any, createdBy: string) {
  requirePackageKeys(data);
  const id = randomUUID();
  const money = PACKAGE_MONEY_COLUMNS.map((c) => amt(data[c]));

  await db.execute(
    `INSERT INTO salary_package_master
       (id, branch_name, cost_centre_code, band_code, package_amount,
        ${PACKAGE_MONEY_COLUMNS.join(", ")}, active_status, source_db, created_by)
     VALUES (?, ?, ?, ?, ?, ${PACKAGE_MONEY_COLUMNS.map(() => "?").join(", ")}, ?, ?, ?)`,
    [
      id,
      data.branch_name,
      data.cost_centre_code ?? null,
      data.band_code,
      amt(data.package_amount),
      ...money,
      data.active_status ?? 1,
      // source_db defaults to 'db_bill'. Every one of the 295 existing rows came
      // from that import, and a package typed into the admin screen must not
      // claim the same provenance - the column exists to tell them apart.
      'hrms',
      createdBy || null,
    ]
  );
  return getPackageById(id);
}

/**
 * Update a salary package. Same column correction as createPackage above.
 *
 * Merged over the existing row so a partial payload cannot blank a money column
 * that the caller simply did not send.
 */
export async function updatePackage(id: string, data: any) {
  const existing = await getPackageById(id);
  if (!existing) return null;
  const merged = { ...existing, ...data };
  requirePackageKeys(merged);

  await db.execute(
    `UPDATE salary_package_master SET
       branch_name = ?, cost_centre_code = ?, band_code = ?, package_amount = ?,
       ${PACKAGE_MONEY_COLUMNS.map((c) => `${c} = ?`).join(", ")},
       active_status = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      merged.branch_name,
      merged.cost_centre_code ?? null,
      merged.band_code,
      amt(merged.package_amount),
      ...PACKAGE_MONEY_COLUMNS.map((c) => amt(merged[c])),
      merged.active_status ?? 1,
      id,
    ]
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
  let suggestedPackage: RowDataPacket | null = null;
  if (entry.band) {
    // Look up by band_code (strip the 'Band ' prefix grade_band_master stores).
    const bandCode = String(entry.band).replace(/^Band\s+/i, '').trim();
    const [pkgs] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM salary_package_master WHERE band_code=? AND active_status=1 ORDER BY package_amount ASC LIMIT 1`,
      [bandCode]
    );
    suggestedPackage = (pkgs as RowDataPacket[])[0] ?? null;
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
