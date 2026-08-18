import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { provisionLmsIdentityForEmployee } from "../lms/lms-provisioning.service.js";
import { toStoredName, toStoredNameRequired } from "../../shared/nameFormat.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
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

  let importedRows = 0;
  let errorRows = 0;
  const errors: string[] = [];

  for (const row of batchRows) {
    try {
      const data =
        typeof row.normalized_data === "string"
          ? JSON.parse(row.normalized_data)
          : (row.normalized_data ?? {});

      const employeeCode = String(data.employee_code ?? "").trim();
      const firstName = String(data.first_name ?? "").trim();

      if (!employeeCode || !firstName) {
        throw new Error(`Row ${row.row_no}: employee_code and first_name are required`);
      }

      if (employeeCode.startsWith("IDC")) {
        throw new Error(`Row ${row.row_no}: IDC employees are not allowed`);
      }

      // Resolve branch
      let branchId: string | null = null;
      if (data.branch_code) {
        const [[br]] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM branch_master WHERE branch_code = ? LIMIT 1`,
          [String(data.branch_code)]
        );
        branchId = br?.id ?? null;
      }

      // Resolve department
      let departmentId: string | null = null;
      if (data.department_code) {
        const [[dep]] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM department_master WHERE dept_code = ? LIMIT 1`,
          [String(data.department_code)]
        );
        departmentId = dep?.id ?? null;
      }

      // Resolve designation
      let designationId: string | null = null;
      if (data.designation_code) {
        const [[des]] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM designation_master WHERE designation_code = ? LIMIT 1`,
          [String(data.designation_code)]
        );
        designationId = des?.id ?? null;
      }

      // Resolve cost centre.
      //
      // Added because this INSERT, like every other employee-creation path, omitted
      // cost_centre_id entirely — leaving the manual Edit Employee dialog as the column's
      // only writer in the backend and 185 active employees with no cost centre at all.
      // Restricted to active_status = 1 so a bulk sheet cannot attach staff to a closed
      // cost centre, and left NULL when the code does not match rather than failing the
      // row: an unknown cost centre should not stop an employee being loaded.
      let costCentreId: string | null = null;
      if (data.cost_centre_code) {
        const [[cc]] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM cost_centre_master WHERE cost_centre_code = ? AND active_status = 1 LIMIT 1`,
          [String(data.cost_centre_code).trim()]
        );
        costCentreId = cc?.id ?? null;
      }

      // Resolve process and LOB.
      //
      // The EMPLOYEE_MASTER template has advertised process_code and lob_code as accepted
      // columns all along, and this importer silently ignored both — so an operator filling
      // the sheet in good faith got an employee with no process, and no error to say why.
      // Same defect as the cost centre above, on columns the template already promises.
      let processId: string | null = null;
      if (data.process_code) {
        const [[pr]] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM process_master WHERE process_code = ? AND active_status = 1 LIMIT 1`,
          [String(data.process_code).trim()]
        );
        processId = pr?.id ?? null;
      }

      let lobId: string | null = null;
      if (data.lob_code) {
        const [[lb]] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM lob_master WHERE lob_code = ? AND active_status = 1 LIMIT 1`,
          [String(data.lob_code).trim()]
        );
        lobId = lb?.id ?? null;
      }

      const doj = data.date_of_joining
        ? String(data.date_of_joining).slice(0, 10)
        : null;
      const lastName = data.last_name ? String(data.last_name).trim() : null;
      const mobile = data.mobile ? String(data.mobile).trim() : null;
      const email = data.email ? String(data.email).trim() : null;
      const gender = data.gender ? String(data.gender).trim() : null;
      const employmentType = data.employment_type
        ? String(data.employment_type).trim()
        : "PERMANENT";

      await db.execute(
        `INSERT INTO employees
           (employee_code, first_name, last_name, mobile, official_email,
            gender, date_of_joining, branch_id, department_id, designation_id,
            cost_centre_id, process_id, lob_id, employment_type, active_status,
            employment_status, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active',?)
         ON DUPLICATE KEY UPDATE
           first_name = VALUES(first_name),
           last_name = VALUES(last_name),
           mobile = COALESCE(VALUES(mobile), mobile),
           official_email = COALESCE(VALUES(official_email), official_email),
           gender = COALESCE(VALUES(gender), gender),
           date_of_joining = COALESCE(VALUES(date_of_joining), date_of_joining),
           branch_id = COALESCE(VALUES(branch_id), branch_id),
           department_id = COALESCE(VALUES(department_id), department_id),
           designation_id = COALESCE(VALUES(designation_id), designation_id),
           -- COALESCE, matching every other org column here: a sheet that omits the
           -- cost centre column must not wipe a value already on the record. 184 of these
           -- were recovered by hand from db_bill, and a routine re-upload silently
           -- blanking them would undo that without anyone noticing.
           cost_centre_id = COALESCE(VALUES(cost_centre_id), cost_centre_id),
           process_id = COALESCE(VALUES(process_id), process_id),
           lob_id = COALESCE(VALUES(lob_id), lob_id),
           employment_type = VALUES(employment_type)`,
        [
          employeeCode, toStoredNameRequired(firstName), toStoredName(lastName), mobile, email,
          gender, doj, branchId, departmentId, designationId,
          costCentreId, processId, lobId, employmentType, importedByUserId,
        ]
      );

      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'imported' WHERE id = ?`,
        [row.id]
      );
      try {
        const lmsResult = await provisionLmsIdentityForEmployee({ employeeCode, createdBy: importedByUserId });
        if (lmsResult.message) {
          console.warn(`[Bulk Import] LMS provisioning for ${employeeCode}: ${lmsResult.message}`);
        }
      } catch (err) {
        console.error(`[Bulk Import] LMS provisioning failed for ${employeeCode}:`, err instanceof Error ? err.message : String(err));
      }
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      await db.execute(
        `UPDATE upload_batch_row SET row_status = 'error', error_messages = ? WHERE id = ?`,
        // error_messages, plural, and it is a JSON column holding an array of
        // strings - the same shape reporting-manager-bulk and roster-assignment-bulk
        // already write. The column named here was error_message, which does not
        // exist, so this UPDATE raised ER_BAD_FIELD_ERROR. It sits inside the per-row
        // catch, so the failure of one row made the handler itself throw and took the
        // whole import down with an error about a column instead of recording why the
        // row failed.
        [JSON.stringify([msg.slice(0, 500)]), row.id]
      );
      errorRows++;
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
