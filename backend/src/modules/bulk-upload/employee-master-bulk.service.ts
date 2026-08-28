import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { provisionLmsIdentityForEmployee } from "../lms/lms-provisioning.service.js";
import { toStoredName, toStoredNameRequired } from "../../shared/nameFormat.js";
import { normalizeDate } from "./bulk-approval.service.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

interface CodeRow extends RowDataPacket {
  id: string;
  code: string;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  mobile: string | null;
  email: string | null;
  gender: string | null;
  doj: string | null;
  dob: string | null;
  employmentType: string | null;
  branchCode: string | null;
  departmentCode: string | null;
  designationCode: string | null;
  costCentreCode: string | null;
  processCode: string | null;
  lobCode: string | null;
}

const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Bulk-fetch a lookup table's id for every distinct code referenced in the batch. */
async function bulkLookup(sql: string, codes: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (codes.size === 0) return map;
  const codeList = Array.from(codes);
  const [rows] = await db.execute<CodeRow[]>(
    `${sql} IN (${codeList.map(() => "?").join(",")})`,
    codeList
  );
  for (const r of rows) map.set(r.code, r.id);
  return map;
}

export async function importEmployeeMasterBatch(
  batchId: string,
  importedByUserId: string
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId]
  );

  if (batchRows.length === 0) {
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];
  let errorRows = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const branchCodes = new Set<string>();
  const departmentCodes = new Set<string>();
  const designationCodes = new Set<string>();
  const costCentreCodes = new Set<string>();
  const processCodes = new Set<string>();
  const lobCodes = new Set<string>();

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : (row.normalized_data ?? {});

    const employeeCode = String(data.employee_code ?? "").trim();
    const firstName = String(data.first_name ?? "").trim();
    const lastName = String(data.last_name ?? "").trim();
    const doj = String(data.date_of_joining ?? "").trim();

    // The template declares employee_code, first_name, last_name and
    // date_of_joining all required — this used to enforce only the first two.
    // last_name is nullable on the live table, so a missing one silently wrote
    // NULL with no error. date_of_joining is NOT NULL with no default, so a
    // missing one previously reached the INSERT and failed there with a raw
    // MySQL error instead of this row-level message; the outcome (row rejected,
    // batch continues) is unchanged, only the message is now legible.
    if (!employeeCode || !firstName || !lastName || !doj) {
      const msg = `Row ${row.row_no}: employee_code, first_name, last_name and date_of_joining are required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    // The template's own guide says "date_of_joining and date_of_birth must be
    // DD-MM-YYYY", but this used to just String(...).slice(0, 10) the raw cell —
    // no DD-MM-YYYY -> YYYY-MM-DD conversion at all. A date entered exactly as
    // instructed (e.g. "23-08-2026") reached the INSERT unchanged and MySQL
    // rejected it: "Incorrect date value '23-08-2026' for column
    // 'date_of_joining'" (ER_TRUNCATED_WRONG_VALUE) — live-reproduced by calling
    // importEmployeeMasterBatch directly. Only a date already typed as ISO
    // (YYYY-MM-DD) slipped through by accident. normalizeDate is the same
    // DD-MM-YYYY/ISO/Excel-serial parser leave and regularization bulk uploads
    // already trust (bulk-approval.service.ts) — reused here instead of a second
    // ad hoc parser.
    const normalizedDoj = normalizeDate(doj);
    if (!normalizedDoj) {
      const msg = `Row ${row.row_no}: date_of_joining "${doj}" is not a valid date (use DD-MM-YYYY)`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    if (employeeCode.startsWith("IDC")) {
      const msg = `Row ${row.row_no}: IDC employees are not allowed`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const branchCode = data.branch_code ? String(data.branch_code) : null;
    const departmentCode = data.department_code ? String(data.department_code) : null;
    const designationCode = data.designation_code ? String(data.designation_code) : null;
    const costCentreCode = data.cost_centre_code ? String(data.cost_centre_code).trim() : null;
    const processCode = data.process_code ? String(data.process_code).trim() : null;
    const lobCode = data.lob_code ? String(data.lob_code).trim() : null;

    if (branchCode) branchCodes.add(branchCode);
    if (departmentCode) departmentCodes.add(departmentCode);
    if (designationCode) designationCodes.add(designationCode);
    if (costCentreCode) costCentreCodes.add(costCentreCode);
    if (processCode) processCodes.add(processCode);
    if (lobCode) lobCodes.add(lobCode);

    parsed.push({
      rowId: row.id, rowNo: row.row_no, employeeCode, firstName,
      lastName: data.last_name ? String(data.last_name).trim() : null,
      mobile: data.mobile ? String(data.mobile).trim() : null,
      email: data.email ? String(data.email).trim() : null,
      gender: data.gender ? String(data.gender).trim() : null,
      doj: normalizedDoj,
      // date_of_birth is an optional template column ("date_of_joining and
      // date_of_birth must be DD-MM-YYYY" per the template guide) that this
      // service never read at all — not mis-parsed, simply absent from the
      // parsed row, so it silently vanished on every upload regardless of
      // format. Parsed the same way as date_of_joining, but — being optional —
      // an unparseable value is left null rather than rejecting the row,
      // matching this file's existing leniency for other optional fields
      // (see the employmentType comment above).
      dob: data.date_of_birth ? normalizeDate(String(data.date_of_birth).trim()) : null,
      // No fabricated default. 'PERMANENT' never existed among live employment_type
      // values (ONROLL, MGMT. TRAINEE, Full Time, HARYANA, OffRoll — varchar, not an
      // enum) and statutory/PF reporting hard-filters on employment_type = 'ONROLL'
      // (statutory.executor.ts, pf-creation.service.ts) — every bulk-created employee
      // that left this blank was silently invisible to PF/ESIC reporting. NULL is
      // honest about "not classified"; asserting a specific wrong classification is
      // worse, the same reasoning this file already applies to unresolved master codes.
      employmentType: data.employment_type ? String(data.employment_type).trim() : null,
      branchCode, departmentCode, designationCode, costCentreCode, processCode, lobCode,
    });
  }

  // Six bulk lookups (one per referenced master table) instead of up to six
  // SELECTs per row. cost_centre_code and process_code/lob_code are also
  // restricted to active_status = 1, same as the original per-row queries.
  const [branchIds, departmentIds, designationIds, costCentreIds, processIds, lobIds] = await Promise.all([
    bulkLookup(`SELECT id, branch_code AS code FROM branch_master WHERE branch_code`, branchCodes),
    bulkLookup(`SELECT id, dept_code AS code FROM department_master WHERE dept_code`, departmentCodes),
    bulkLookup(`SELECT id, designation_code AS code FROM designation_master WHERE designation_code`, designationCodes),
    bulkLookup(`SELECT id, cost_centre_code AS code FROM cost_centre_master WHERE active_status = 1 AND cost_centre_code`, costCentreCodes),
    bulkLookup(`SELECT id, process_code AS code FROM process_master WHERE active_status = 1 AND process_code`, processCodes),
    bulkLookup(`SELECT id, lob_code AS code FROM lob_master WHERE active_status = 1 AND lob_code`, lobCodes),
  ]);

  /*
   * Reject rows whose masters did not resolve, instead of importing a silent NULL.
   *
   * Two separate failures were possible here, and both were silent:
   *
   *   1. process_code absent -> process_id NULL. On 2026-08-19 a single bulk batch created
   *      60 active employees with no process at all; by 2026-08-26 that was 61 of the 128
   *      people who joined in August (48%), against 0 for every month Jan-Jun. 62 of the 63
   *      are OPERATIONS staff, i.e. client-facing. An employee with no process joins to no
   *      client, so they are invisible to process/client headcount, to P&L allocation by
   *      process, and to the client portal's own headcount and attrition figures.
   *
   *   2. A code that was SUPPLIED but matched no master row was mapped through
   *      `?? null` and dropped. That is worse than a blank: somebody typed a value, the
   *      import reported success, and the value was thrown away. The same pattern is why
   *      cost_centre_id is empty on so much of this table.
   *
   * process is required because every employee has one — the internal functions (HR
   * Operations, IT, Finance-Corporate) exist as process_master rows in their own right, so
   * "back-office staff have no process" is not a real case.
   *
   * For the other five masters a blank stays allowed, exactly as before; only a supplied
   * value that does not resolve is now an error. This deliberately turns some previously
   * "successful" imports into reported errors — that is the point, and the row is named so
   * it can be corrected and re-uploaded rather than silently landing wrong.
   *
   * Note the lookups for cost_centre/process/lob are restricted to active_status = 1, so a
   * code that exists but is inactive is reported here too.
   */
  const RESOLVERS: Array<{ label: string; code: (r: ParsedRow) => string | null; map: Map<string, string> }> = [
    { label: "branch_code",      code: (r) => r.branchCode,      map: branchIds },
    { label: "department_code",  code: (r) => r.departmentCode,  map: departmentIds },
    { label: "designation_code", code: (r) => r.designationCode, map: designationIds },
    { label: "cost_centre_code", code: (r) => r.costCentreCode,  map: costCentreIds },
    { label: "lob_code",         code: (r) => r.lobCode,         map: lobIds },
  ];

  const importable: ParsedRow[] = [];
  for (const r of parsed) {
    const problems: string[] = [];

    if (!r.processCode) {
      problems.push("process_code is required");
    } else if (!processIds.has(r.processCode)) {
      problems.push(`process_code "${r.processCode}" does not match any active process`);
    }
    for (const res of RESOLVERS) {
      const code = res.code(r);
      if (code && !res.map.has(code)) {
        problems.push(`${res.label} "${code}" does not match any active record`);
      }
    }

    if (problems.length) {
      const msg = `Row ${r.rowNo}: ${problems.join("; ")}`;
      errors.push(msg);
      errorUpdates.push({ rowId: r.rowId, message: msg.slice(0, 500) });
      errorRows++;
      continue;
    }
    importable.push(r);
  }

  let importedRows = 0;
  const importedRowIds: string[] = [];
  const provisionQueue: string[] = [];

  // Chunked multi-row upsert instead of one INSERT per row. If a chunk's
  // statement fails (a constraint violation on one of its rows), that chunk
  // alone is retried row-by-row so only the actually-bad row ends up marked
  // as an error — every other row in the batch still lands, matching the
  // original per-row loop's error isolation.
  const buildParams = (r: ParsedRow) => [
    r.employeeCode, toStoredNameRequired(r.firstName), toStoredName(r.lastName), r.mobile, r.email,
    r.gender, r.doj, r.dob,
    r.branchCode ? branchIds.get(r.branchCode) ?? null : null,
    r.departmentCode ? departmentIds.get(r.departmentCode) ?? null : null,
    r.designationCode ? designationIds.get(r.designationCode) ?? null : null,
    r.costCentreCode ? costCentreIds.get(r.costCentreCode) ?? null : null,
    r.processCode ? processIds.get(r.processCode) ?? null : null,
    r.lobCode ? lobIds.get(r.lobCode) ?? null : null,
    r.employmentType,
  ];

  const insertSql = (placeholders: string) => `
    INSERT INTO employees
       (employee_code, first_name, last_name, mobile, official_email,
        gender, date_of_joining, date_of_birth, branch_id, department_id, designation_id,
        cost_centre_id, process_id, lob_id, employment_type, active_status,
        employment_status)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       first_name = VALUES(first_name),
       last_name = VALUES(last_name),
       mobile = COALESCE(VALUES(mobile), mobile),
       official_email = COALESCE(VALUES(official_email), official_email),
       gender = COALESCE(VALUES(gender), gender),
       date_of_joining = COALESCE(VALUES(date_of_joining), date_of_joining),
       date_of_birth = COALESCE(VALUES(date_of_birth), date_of_birth),
       branch_id = COALESCE(VALUES(branch_id), branch_id),
       department_id = COALESCE(VALUES(department_id), department_id),
       designation_id = COALESCE(VALUES(designation_id), designation_id),
       cost_centre_id = COALESCE(VALUES(cost_centre_id), cost_centre_id),
       process_id = COALESCE(VALUES(process_id), process_id),
       lob_id = COALESCE(VALUES(lob_id), lob_id),
       employment_type = VALUES(employment_type)`;

  for (const rowsInChunk of chunk(importable, CHUNK_SIZE)) {
    const placeholders = rowsInChunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active')").join(", ");
    const params = rowsInChunk.flatMap(buildParams);

    try {
      await db.execute(insertSql(placeholders), params);
      for (const r of rowsInChunk) {
        importedRowIds.push(r.rowId);
        provisionQueue.push(r.employeeCode);
        importedRows++;
      }
    } catch {
      for (const r of rowsInChunk) {
        try {
          await db.execute(insertSql("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active')"), buildParams(r));
          importedRowIds.push(r.rowId);
          provisionQueue.push(r.employeeCode);
          importedRows++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Row ${r.rowNo}: ${msg}`);
          errorUpdates.push({ rowId: r.rowId, message: msg.slice(0, 500) });
          errorRows++;
        }
      }
    }
  }

  if (importedRowIds.length > 0) {
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported'
       WHERE id IN (${importedRowIds.map(() => "?").join(",")})`,
      importedRowIds
    );
  }
  if (errorUpdates.length > 0) {
    const cases = errorUpdates.map(() => "WHEN ? THEN ?").join(" ");
    const caseParams = errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]);
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...caseParams, ...ids]
    );
  }

  // Best-effort per-employee LMS provisioning, exactly as before: failures are
  // logged and never turn a successfully imported row into an error.
  for (const employeeCode of provisionQueue) {
    try {
      const lmsResult = await provisionLmsIdentityForEmployee({ employeeCode, createdBy: importedByUserId });
      if (lmsResult.message) {
        console.warn(`[Bulk Import] LMS provisioning for ${employeeCode}: ${lmsResult.message}`);
      }
    } catch (err) {
      console.error(`[Bulk Import] LMS provisioning failed for ${employeeCode}:`, err instanceof Error ? err.message : String(err));
    }
  }

  const finalStatus =
    errorRows === 0
      ? "imported"
      : importedRows === 0
      ? "validation_failed"
      : "imported_with_errors";

  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId]
  );

  return { importedRows, errorRows, errors };
}
