import { randomUUID } from "crypto";
import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

export const IDENTITY_SOURCE_SYSTEMS = [
  "MASBIOMETRIC_EMPLOYEE",
  "SHIVAMGIRI_EMPLOYEE",
  "SHIVAMGIRI_AGENT",
  "MASMIS_AGENT",
] as const;

export type IdentitySourceSystem = (typeof IDENTITY_SOURCE_SYSTEMS)[number];

export interface BuiltSql {
  sql: string;
  params: unknown[];
}

export interface SyncStatement extends BuiltSql {
  sourceSystem: IdentitySourceSystem;
}

export interface SnapshotReportQuery {
  sourceSystem?: unknown;
  matchStatus?: unknown;
}

export interface SnapshotSyncDb {
  execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

const employeeDisplayNameSql = "COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))";

function key(expr: string) {
  return `LOWER(TRIM(CONVERT(${expr} USING utf8mb4))) COLLATE utf8mb4_unicode_ci`;
}

function normalizeFilter(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function upsertSql(sourceSelect: string) {
  return `
INSERT INTO report_identity_source_snapshot (
  source_system,
  source_record_key,
  source_employee_code,
  source_agent_id,
  source_name,
  source_lob,
  source_role,
  source_designation,
  source_manager,
  source_status,
  match_key,
  matched_employee_id,
  matched_employee_code,
  match_status,
  snapshot_run_id,
  captured_at,
  source_updated_at
)
${sourceSelect}
ON DUPLICATE KEY UPDATE
  source_employee_code = VALUES(source_employee_code),
  source_agent_id = VALUES(source_agent_id),
  source_name = VALUES(source_name),
  source_lob = VALUES(source_lob),
  source_role = VALUES(source_role),
  source_designation = VALUES(source_designation),
  source_manager = VALUES(source_manager),
  source_status = VALUES(source_status),
  match_key = VALUES(match_key),
  matched_employee_id = VALUES(matched_employee_id),
  matched_employee_code = VALUES(matched_employee_code),
  match_status = VALUES(match_status),
  snapshot_run_id = VALUES(snapshot_run_id),
  captured_at = VALUES(captured_at),
  source_updated_at = VALUES(source_updated_at),
  updated_at = CURRENT_TIMESTAMP`;
}

export function buildIdentitySourceSnapshotSyncStatements(
  snapshotRunId = randomUUID(),
  capturedAt = new Date().toISOString().slice(0, 19).replace("T", " "),
): SyncStatement[] {
  return [
    {
      sourceSystem: "MASBIOMETRIC_EMPLOYEE",
      params: [snapshotRunId, capturedAt],
      sql: upsertSql(`
SELECT 'MASBIOMETRIC_EMPLOYEE' AS source_system,
       CAST(bm.EmpCode AS CHAR) AS source_record_key,
       CAST(bm.EmpCode AS CHAR) AS source_employee_code,
       NULL AS source_agent_id,
       bm.EmpName AS source_name,
       NULL AS source_lob,
       bm.Role AS source_role,
       bm.Designation AS source_designation,
       bm.assign_manager_id AS source_manager,
       NULL AS source_status,
       ${key("bm.EmpCode")} AS match_key,
       e.id AS matched_employee_id,
       e.employee_code AS matched_employee_code,
       CASE WHEN e.id IS NULL THEN 'unmatched' ELSE 'matched' END AS match_status,
       ? AS snapshot_run_id,
       ? AS captured_at,
       NULL AS source_updated_at
  FROM Masbiometric.EmployeeDetails bm
  LEFT JOIN employees e
    ON ${key("COALESCE(NULLIF(e.biometric_code,''), e.employee_code)")} = ${key("bm.EmpCode")}
 WHERE COALESCE(bm.EmpCode,'') <> ''`),
    },
    {
      sourceSystem: "SHIVAMGIRI_EMPLOYEE",
      params: [snapshotRunId, capturedAt],
      sql: upsertSql(`
SELECT 'SHIVAMGIRI_EMPLOYEE' AS source_system,
       CAST(se.EmpCode AS CHAR) AS source_record_key,
       CAST(se.EmpCode AS CHAR) AS source_employee_code,
       NULL AS source_agent_id,
       se.EmpName AS source_name,
       NULL AS source_lob,
       se.Role AS source_role,
       se.Designation AS source_designation,
       se.assign_manager_id AS source_manager,
       NULL AS source_status,
       ${key("se.EmpCode")} AS match_key,
       e.id AS matched_employee_id,
       e.employee_code AS matched_employee_code,
       CASE WHEN e.id IS NULL THEN 'unmatched' ELSE 'matched' END AS match_status,
       ? AS snapshot_run_id,
       ? AS captured_at,
       NULL AS source_updated_at
  FROM Shivamgiri.EmployeeDetails se
  LEFT JOIN employees e
    ON ${key("e.employee_code")} = ${key("se.EmpCode")}
 WHERE COALESCE(se.EmpCode,'') <> ''`),
    },
    {
      sourceSystem: "SHIVAMGIRI_AGENT",
      params: [snapshotRunId, capturedAt],
      sql: upsertSql(`
SELECT 'SHIVAMGIRI_AGENT' AS source_system,
       CAST(sa.MasId AS CHAR) AS source_record_key,
       NULL AS source_employee_code,
       CAST(sa.MasId AS CHAR) AS source_agent_id,
       sa.AgentName AS source_name,
       sa.Lob AS source_lob,
       NULL AS source_role,
       NULL AS source_designation,
       NULL AS source_manager,
       NULL AS source_status,
       ${key("sa.MasId")} AS match_key,
       e.id AS matched_employee_id,
       e.employee_code AS matched_employee_code,
       CASE WHEN e.id IS NULL THEN 'unmatched' ELSE 'matched' END AS match_status,
       ? AS snapshot_run_id,
       ? AS captured_at,
       sa.CreatedAt AS source_updated_at
  FROM Shivamgiri.AgentMaster sa
  LEFT JOIN employees e
    ON ${key("COALESCE(NULLIF(e.call_centre_code,''), e.employee_code)")} = ${key("sa.MasId")}
 WHERE COALESCE(sa.MasId,'') <> ''`),
    },
    {
      sourceSystem: "MASMIS_AGENT",
      params: [snapshotRunId, capturedAt],
      sql: upsertSql(`
SELECT 'MASMIS_AGENT' AS source_system,
       CAST(COALESCE(NULLIF(ma.emp_id,''), NULLIF(ma.daildesk_id,''), ma.id) AS CHAR) AS source_record_key,
       NULLIF(ma.emp_id,'') AS source_employee_code,
       NULLIF(ma.daildesk_id,'') AS source_agent_id,
       ma.name AS source_name,
       ma.lob AS source_lob,
       NULL AS source_role,
       NULL AS source_designation,
       ma.tl AS source_manager,
       ma.status AS source_status,
       ${key("COALESCE(NULLIF(ma.emp_id,''), NULLIF(ma.daildesk_id,''), ma.id)")} AS match_key,
       e.id AS matched_employee_id,
       e.employee_code AS matched_employee_code,
       CASE WHEN e.id IS NULL THEN 'unmatched' ELSE 'matched' END AS match_status,
       ? AS snapshot_run_id,
       ? AS captured_at,
       ma.updated_at AS source_updated_at
  FROM db_masmis.nms_Agent_Details ma
  LEFT JOIN employees e
    ON ${key("COALESCE(NULLIF(e.call_centre_code,''), e.employee_code)")}
       IN (${key("ma.emp_id")}, ${key("ma.daildesk_id")})
 WHERE COALESCE(ma.emp_id, ma.daildesk_id, '') <> ''`),
    },
  ];
}

export async function runIdentitySourceSnapshotSync(
  database: SnapshotSyncDb = db,
  snapshotRunId = randomUUID(),
  capturedAt = new Date().toISOString().slice(0, 19).replace("T", " "),
) {
  const statements = buildIdentitySourceSnapshotSyncStatements(snapshotRunId, capturedAt);
  const sources: Array<{ sourceSystem: IdentitySourceSystem; affectedRows: number }> = [];

  await database.execute(
    "UPDATE report_identity_source_snapshot SET is_current = 0 WHERE is_current = 1",
  );

  for (const statement of statements) {
    const [result] = await database.execute(statement.sql, statement.params);
    const affectedRows = Number((result as ResultSetHeader | undefined)?.affectedRows ?? 0);
    sources.push({ sourceSystem: statement.sourceSystem, affectedRows });
  }

  return {
    snapshotRunId,
    capturedAt,
    totalAffectedRows: sources.reduce((sum, row) => sum + row.affectedRows, 0),
    sources,
  };
}

export function buildIdentitySourceSnapshotReportSql(query: SnapshotReportQuery): BuiltSql {
  const clauses = ["ris.is_current = 1"];
  const params: unknown[] = [];

  const sourceSystem = normalizeFilter(query.sourceSystem);
  if (sourceSystem) {
    clauses.push("ris.source_system = ?");
    params.push(sourceSystem);
  }

  const matchStatus = normalizeFilter(query.matchStatus);
  if (matchStatus) {
    clauses.push("ris.match_status = ?");
    params.push(matchStatus);
  }

  return {
    sql: `SELECT ris.source_system,
                 ris.match_status,
                 ris.source_record_key,
                 ris.source_employee_code,
                 ris.source_agent_id,
                 ris.source_name,
                 ris.source_lob,
                 ris.source_role,
                 ris.source_designation,
                 ris.source_manager,
                 ris.source_status,
                 ris.matched_employee_code,
                 ${employeeDisplayNameSql} AS matched_employee_name,
                 b.branch_name,
                 p.process_name,
                 ris.captured_at,
                 ris.source_updated_at
            FROM report_identity_source_snapshot ris
            LEFT JOIN employees e ON e.id = ris.matched_employee_id
            LEFT JOIN branch_master b ON b.id = e.branch_id
            LEFT JOIN process_master p ON p.id = e.process_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY FIELD(ris.match_status, 'unmatched', 'ambiguous', 'matched'),
                    ris.source_system,
                    ris.source_name`,
    params,
  };
}
