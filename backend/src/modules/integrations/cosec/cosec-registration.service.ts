/**
 * COSEC employee registration service.
 *
 * When a candidate is converted to an employee in mas_hrms, this service
 * pushes a matching record into NCOSEC.dbo.Mx_UserMst so the employee can
 * badge in from day one without manual data entry in the COSEC console.
 *
 * Flow:
 *   1. Fetch employee row from mas_hrms (branch, department, designation, DOJ).
 *   2. Resolve COSEC FK IDs (BRCID, DPTID, DSGID) by name — insert master rows
 *      if the name is not found yet (new branch / department / designation).
 *   3. UPSERT into Mx_UserMst using employee_code as UserID.
 *   4. Record outcome in cosec_user_sync_queue (mas_hrms).
 */
import sql from "mssql";
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { openCosecConnection, cosecQuery } from "./cosec.client.js";
import { env } from "../../../config/env.js";

const COSEC_ORG_ID = 2; // MAS CALLNET INDIA PVT. LTD.
const DEFAULT_SHIFT_GROUP = 3;
const DEFAULT_CATEGORY = 1;
const DEFAULT_SECTION = 1;

export interface CosecRegistrationResult {
  success: boolean;
  cosecUserId: string;
  action: "inserted" | "updated" | "skipped";
  message: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function resolveOrInsertCosecMaster(
  pool: sql.ConnectionPool,
  table: string,
  idCol: string,
  nameCol: string,
  name: string,
  extra: Record<string, string | number> = {},
): Promise<number> {
  type Row = Record<string, number>;
  const rows = await cosecQuery<Row[]>(
    pool,
    `SELECT TOP 1 ${idCol} FROM ${table} WHERE ${nameCol} = @name`,
    { name: { type: sql.NVarChar(200), value: name } },
  );
  if (rows.length) return rows[0][idCol];

  // Insert a minimal master row and return the generated identity.
  const extraCols = Object.keys(extra).map((k) => k).join(", ");
  const extraVals = Object.keys(extra).map((k) => `@${k}`).join(", ");
  const colList = extraCols ? `, ${extraCols}` : "";
  const valList = extraVals ? `, ${extraVals}` : "";

  const req = pool.request();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inp2 = (n: string, t: any, v: unknown) => (req.input as any)(n, t, v);
  inp2("name", sql.NVarChar(200), name);
  for (const [k, v] of Object.entries(extra)) {
    inp2(k, typeof v === "number" ? sql.Int : sql.NVarChar(200), v);
  }

  const insertSql = `
    INSERT INTO ${table} (${nameCol}${colList})
    OUTPUT INSERTED.${idCol}
    VALUES (@name${valList})
  `;
  const insertResult = await req.query(insertSql);
  return insertResult.recordset[0][idCol] as number;
}

async function markQueue(
  employeeId: string,
  employeeCode: string,
  status: "success" | "failed",
  message: string,
  cosecUserId?: string,
) {
  await db
    .execute(
      `INSERT INTO cosec_user_sync_queue
         (employee_id, employee_code, cosec_user_id, status, message, attempted_at, completed_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         message = VALUES(message),
         cosec_user_id = COALESCE(VALUES(cosec_user_id), cosec_user_id),
         attempted_at = NOW(),
         completed_at = NOW(),
         retry_count = retry_count + 1`,
      [employeeId, employeeCode, cosecUserId ?? null, status, message],
    )
    .catch((err: unknown) => {
      console.warn("[CosecReg] queue update failed:", err);
    });
}

// ── public API ────────────────────────────────────────────────────────────────

export async function registerEmployeeInCosec(
  employeeId: string,
  employeeCode: string,
): Promise<CosecRegistrationResult> {
  if (env.NCOSEC_SYNC_ENABLED !== "true") {
    return { success: true, cosecUserId: employeeCode, action: "skipped", message: "COSEC sync disabled" };
  }

  // 1. Fetch employee data from mas_hrms
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id, e.employee_code, e.full_name, e.date_of_joining,
       b.name AS branch_name,
       d.name AS department_name,
       dsg.name AS designation_name
     FROM employees e
     LEFT JOIN branch_master b ON b.id = e.branch_id
     LEFT JOIN department_master d ON d.id = e.department_id
     LEFT JOIN designation_master dsg ON dsg.id = e.designation_id
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId],
  );

  if (!rows.length) {
    const msg = `Employee ${employeeCode} not found in mas_hrms`;
    await markQueue(employeeId, employeeCode, "failed", msg);
    return { success: false, cosecUserId: employeeCode, action: "skipped", message: msg };
  }

  const emp = rows[0] as RowDataPacket;
  const branchName: string = (emp.branch_name as string) ?? "HEAD OFFICE";
  const deptName: string = (emp.department_name as string) ?? "GENERAL";
  const desgName: string = (emp.designation_name as string) ?? "ASSOCIATE";
  const fullName: string = (emp.full_name as string) ?? employeeCode;
  const joinDt: Date = emp.date_of_joining ? new Date(emp.date_of_joining as string) : new Date();

  // 2. Connect to COSEC MSSQL
  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await openCosecConnection();

    // 3. Resolve FK master IDs (insert if missing)
    const [brcId, dptId, dsgId] = await Promise.all([
      resolveOrInsertCosecMaster(pool, "Mx_BranchMst", "BRCID", "Name", branchName, { ORGID: COSEC_ORG_ID }),
      resolveOrInsertCosecMaster(pool, "Mx_DepartmentMst", "DPTID", "Name", deptName, { ORGID: COSEC_ORG_ID }),
      resolveOrInsertCosecMaster(pool, "Mx_DesignationMst", "DSGID", "Name", desgName, { ORGID: COSEC_ORG_ID }),
    ]);

    // 4. Check if user already exists
    type UserRow = { UserID: string };
    const existing = await cosecQuery<UserRow[]>(
      pool,
      `SELECT TOP 1 UserID FROM Mx_UserMst WHERE UserID = @uid`,
      { uid: { type: sql.NVarChar(50), value: employeeCode } },
    );

    const action: "inserted" | "updated" = existing.length ? "updated" : "inserted";

    if (action === "inserted") {
      const req = pool.request();
      const inp = (n: string, t: unknown, v: unknown) =>
        (req.input as (n: string, t: unknown, v: unknown) => void)(n, t, v);

      inp("uid", sql.NVarChar(50), employeeCode);
      inp("name", sql.NVarChar(100), fullName.substring(0, 100));
      inp("fullName", sql.NVarChar(200), fullName.substring(0, 200));
      inp("firstName", sql.NVarChar(100), fullName.split(" ")[0].substring(0, 100));
      inp("lastName", sql.NVarChar(100), (fullName.split(" ").slice(1).join(" ") || "").substring(0, 100));
      inp("orgId", sql.Int, COSEC_ORG_ID);
      inp("brcId", sql.Int, brcId);
      inp("dptId", sql.Int, dptId);
      inp("dsgId", sql.Int, dsgId);
      inp("sgId", sql.Int, DEFAULT_SHIFT_GROUP);
      inp("ctgId", sql.Int, DEFAULT_CATEGORY);
      inp("secId", sql.Int, DEFAULT_SECTION);
      inp("joinDt", sql.DateTime, joinDt);
      inp("intRef", sql.NVarChar(50), employeeCode);

      await req.query(`
        INSERT INTO Mx_UserMst
          (UserID, Name, FullName, FirstName, LastName,
           ORGID, BRCID, DPTID, DSGID, SGID, CTGID, SECID,
           JoinDT, IntegrationRef, UserACTEnbl, dltdflg, CreationDT)
        VALUES
          (@uid, @name, @fullName, @firstName, @lastName,
           @orgId, @brcId, @dptId, @dsgId, @sgId, @ctgId, @secId,
           @joinDt, @intRef, 1, 0, GETDATE())
      `);
    } else {
      // Update name, branch, dept, designation on re-registration
      const req = pool.request();
      const inp = (n: string, t: unknown, v: unknown) =>
        (req.input as (n: string, t: unknown, v: unknown) => void)(n, t, v);

      inp("uid", sql.NVarChar(50), employeeCode);
      inp("name", sql.NVarChar(100), fullName.substring(0, 100));
      inp("fullName", sql.NVarChar(200), fullName.substring(0, 200));
      inp("brcId", sql.Int, brcId);
      inp("dptId", sql.Int, dptId);
      inp("dsgId", sql.Int, dsgId);

      await req.query(`
        UPDATE Mx_UserMst
        SET Name = @name, FullName = @fullName,
            BRCID = @brcId, DPTID = @dptId, DSGID = @dsgId
        WHERE UserID = @uid
      `);
    }

    // 5. Record enrollment in mas_hrms
    await db
      .execute(
        `INSERT INTO employee_biometric_enrollment
           (employee_id, cosec_user_id, cosec_user_name, enrolled_at, enrolled_by, is_active, last_sync_at)
         VALUES (?, ?, ?, NOW(), 'system', 1, NOW())
         ON DUPLICATE KEY UPDATE
           cosec_user_name = VALUES(cosec_user_name),
           is_active = 1,
           last_sync_at = NOW()`,
        [employeeId, employeeCode, fullName],
      )
      .catch((err: unknown) => {
        console.warn("[CosecReg] enrollment row update failed (non-blocking):", err);
      });

    const msg = `${action} UserID=${employeeCode} in COSEC`;
    await markQueue(employeeId, employeeCode, "success", msg, employeeCode);

    return { success: true, cosecUserId: employeeCode, action, message: msg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CosecReg] registration failed for ${employeeCode}:`, message);
    await markQueue(employeeId, employeeCode, "failed", message);
    return { success: false, cosecUserId: employeeCode, action: "skipped", message };
  } finally {
    pool?.close().catch(() => undefined);
  }
}