import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import {
  resolveDashboardScope,
  type DashboardScope,
} from "../../shared/dashboardScope.js";
import type {
  DatasetMapping,
  PerformanceDataset,
  PerformanceSourceType,
} from "./performance-ingestion.types.js";

type DatasetInput = {
  id?: string;
  datasetKey: string;
  datasetName: string;
  sourceType: PerformanceSourceType;
  connectorKey?: string | null;
  sourceEntity?: string | null;
  processId?: string | null;
  branchId?: string | null;
  timezoneName?: string;
  config: Record<string, unknown>;
  mapping: DatasetMapping;
  activeStatus?: boolean;
};

type DatasetRow = RowDataPacket & {
  id: string;
  dataset_key: string;
  dataset_name: string;
  source_type: PerformanceSourceType;
  connector_key: string | null;
  source_entity: string | null;
  process_id: string | null;
  branch_id: string | null;
  timezone_name: string;
  config_json: string | Record<string, unknown>;
  mapping_json: string | DatasetMapping;
  approval_status: string;
  active_status: number;
  process_name?: string | null;
  branch_name?: string | null;
  mapping_version_count?: number | string | null;
  current_mapping_version?: number | string | null;
  current_effective_from?: string | null;
};

type ScopeSql = { sql: string; params: string[] };

type MappingResolutionInput = {
  action: "map_employee" | "map_process" | "resolve" | "ignore";
  notes?: string | null;
  employeeId?: string | null;
  processId?: string | null;
  branchId?: string | null;
  identifierType?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function pageNumber(value: unknown, fallback: number, maximum: number): number {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(maximum, number));
}

function forbidden(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 403 });
}

function conflict(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function notFound(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

export function buildDatasetScopeFilter(scope: DashboardScope, alias = "psd"): ScopeSql {
  if (scope.level === "ORG_ALL") return { sql: "1 = 1", params: [] };

  if (scope.level === "PROCESS_ALL") {
    if (!scope.processIds.length) return { sql: "1 = 0", params: [] };
    return {
      sql: `${alias}.process_id IN (${placeholders(scope.processIds)})`,
      params: [...scope.processIds],
    };
  }

  if (scope.level === "BRANCH_ALL") {
    if (!scope.branchIds.length) return { sql: "1 = 0", params: [] };
    return {
      sql: `(
        ${alias}.branch_id IN (${placeholders(scope.branchIds)})
        OR (
          ${alias}.branch_id IS NULL
          AND ${alias}.process_id IN (
            SELECT DISTINCT e.process_id
              FROM employees e
             WHERE e.branch_id IN (${placeholders(scope.branchIds)})
               AND e.process_id IS NOT NULL
               AND e.active_status = 1
          )
        )
      )`,
      params: [...scope.branchIds, ...scope.branchIds],
    };
  }

  if (scope.level === "CUSTOM_SCOPE") {
    const conditions: string[] = [];
    const params: string[] = [];
    if (scope.branchIds.length) {
      conditions.push(`${alias}.branch_id IN (${placeholders(scope.branchIds)})`);
      params.push(...scope.branchIds);
    }
    if (scope.processIds.length) {
      conditions.push(`${alias}.process_id IN (${placeholders(scope.processIds)})`);
      params.push(...scope.processIds);
    }
    return conditions.length
      ? { sql: conditions.join(" AND "), params }
      : { sql: "1 = 0", params: [] };
  }

  return { sql: "1 = 0", params: [] };
}

function buildEmployeeScopeFilter(scope: DashboardScope, alias = "e"): ScopeSql {
  if (scope.level === "ORG_ALL") return { sql: "1 = 1", params: [] };
  if (scope.level === "BRANCH_ALL" && scope.branchIds.length) {
    return {
      sql: `${alias}.branch_id IN (${placeholders(scope.branchIds)})`,
      params: [...scope.branchIds],
    };
  }
  if (scope.level === "PROCESS_ALL" && scope.processIds.length) {
    return {
      sql: `${alias}.process_id IN (${placeholders(scope.processIds)})`,
      params: [...scope.processIds],
    };
  }
  if (scope.level === "CUSTOM_SCOPE") {
    const conditions: string[] = [];
    const params: string[] = [];
    if (scope.branchIds.length) {
      conditions.push(`${alias}.branch_id IN (${placeholders(scope.branchIds)})`);
      params.push(...scope.branchIds);
    }
    if (scope.processIds.length) {
      conditions.push(`${alias}.process_id IN (${placeholders(scope.processIds)})`);
      params.push(...scope.processIds);
    }
    return conditions.length
      ? { sql: conditions.join(" AND "), params }
      : { sql: "1 = 0", params: [] };
  }
  return { sql: "1 = 0", params: [] };
}

function mapDataset(row: DatasetRow) {
  return {
    id: String(row.id),
    datasetKey: String(row.dataset_key),
    datasetName: String(row.dataset_name),
    sourceType: row.source_type,
    connectorKey: row.connector_key ? String(row.connector_key) : null,
    sourceEntity: row.source_entity ? String(row.source_entity) : null,
    processId: row.process_id ? String(row.process_id) : null,
    branchId: row.branch_id ? String(row.branch_id) : null,
    processName: row.process_name ? String(row.process_name) : null,
    branchName: row.branch_name ? String(row.branch_name) : null,
    timezoneName: String(row.timezone_name ?? "Asia/Kolkata"),
    config: parseJson<Record<string, unknown>>(row.config_json, {}),
    mapping: parseJson<DatasetMapping>(row.mapping_json, {
      employeeIdentifierField: "employee_code",
      eventDateField: "performance_date",
      metrics: [],
    }),
    approvalStatus: String(row.approval_status ?? "draft"),
    activeStatus: Number(row.active_status ?? 0) === 1,
    mappingVersionCount: Number(row.mapping_version_count ?? 0),
    currentMappingVersion: row.current_mapping_version === null || row.current_mapping_version === undefined
      ? null
      : Number(row.current_mapping_version),
    currentEffectiveFrom: row.current_effective_from ? String(row.current_effective_from) : null,
  };
}

async function scopeFor(userId: string): Promise<DashboardScope> {
  return resolveDashboardScope(userId, "");
}

async function datasetRowForUser(
  userId: string,
  idOrKey: string,
  connection: Pick<PoolConnection, "execute"> | typeof db = db,
  lock = false,
): Promise<DatasetRow> {
  const scope = await scopeFor(userId);
  const scoped = buildDatasetScopeFilter(scope, "psd");
  const [rows] = await connection.execute<DatasetRow[]>(
    `SELECT psd.*, pm.process_name, bm.branch_name
       FROM performance_source_dataset psd
       LEFT JOIN process_master pm ON pm.id = psd.process_id
       LEFT JOIN branch_master bm ON bm.id = psd.branch_id
      WHERE (psd.id = ? OR psd.dataset_key = ?)
        AND ${scoped.sql}
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [idOrKey, idOrKey, ...scoped.params],
  );
  if (!rows[0]) throw notFound("Performance dataset was not found in your assigned scope");
  return rows[0];
}

async function ensureDatasetAssignmentAllowed(
  scope: DashboardScope,
  processId: string | null,
  branchId: string | null,
  connection: Pick<PoolConnection, "execute"> | typeof db = db,
): Promise<void> {
  if (scope.level === "ORG_ALL") return;

  if (scope.level === "PROCESS_ALL") {
    if (!processId || !scope.processIds.includes(processId)) {
      throw forbidden("The selected process is outside your assigned scope");
    }
    if (branchId && scope.branchIds.length && !scope.branchIds.includes(branchId)) {
      throw forbidden("The selected branch is outside your assigned scope");
    }
    return;
  }

  if (scope.level === "BRANCH_ALL") {
    if (!branchId || !scope.branchIds.includes(branchId)) {
      throw forbidden("Branch-scoped source owners must select an assigned branch");
    }
    if (processId) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT 1
           FROM employees
          WHERE process_id = ?
            AND branch_id = ?
            AND active_status = 1
          LIMIT 1`,
        [processId, branchId],
      );
      if (!rows.length) {
        throw forbidden("The selected process is not active in the selected branch");
      }
    }
    return;
  }

  throw forbidden("Your HRMS scope cannot administer performance sources");
}

async function ensureEmployeeAllowed(
  connection: Pick<PoolConnection, "execute"> | typeof db,
  scope: DashboardScope,
  employeeId: string,
): Promise<void> {
  const scoped = buildEmployeeScopeFilter(scope, "e");
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT e.id
       FROM employees e
      WHERE e.id = ?
        AND e.active_status = 1
        AND ${scoped.sql}
      LIMIT 1`,
    [employeeId, ...scoped.params],
  );
  if (!rows.length) throw forbidden("The selected employee is outside your assigned scope");
}

async function ensureProcessAllowed(
  connection: Pick<PoolConnection, "execute"> | typeof db,
  scope: DashboardScope,
  processId: string,
  branchId: string | null,
): Promise<void> {
  await ensureDatasetAssignmentAllowed(scope, processId, branchId, connection);
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE id = ? AND active_status = 1 LIMIT 1`,
    [processId],
  );
  if (!rows.length) throw notFound("The selected process is not active");
}

export const performanceGovernanceService = {
  async listDatasets(userId: string) {
    const scope = await scopeFor(userId);
    const scoped = buildDatasetScopeFilter(scope, "psd");
    const [rows] = await db.execute<DatasetRow[]>(
      `SELECT
         psd.*,
         pm.process_name,
         bm.branch_name,
         (SELECT COUNT(*) FROM performance_mapping_version pmv
           WHERE pmv.dataset_id = psd.id AND pmv.status = 'active') AS mapping_version_count,
         (SELECT pmv.version_no FROM performance_mapping_version pmv
           WHERE pmv.dataset_id = psd.id AND pmv.status = 'active' AND pmv.effective_to IS NULL
           ORDER BY pmv.version_no DESC LIMIT 1) AS current_mapping_version,
         (SELECT DATE_FORMAT(pmv.effective_from, '%Y-%m-%d') FROM performance_mapping_version pmv
           WHERE pmv.dataset_id = psd.id AND pmv.status = 'active' AND pmv.effective_to IS NULL
           ORDER BY pmv.version_no DESC LIMIT 1) AS current_effective_from
       FROM performance_source_dataset psd
       LEFT JOIN process_master pm ON pm.id = psd.process_id
       LEFT JOIN branch_master bm ON bm.id = psd.branch_id
      WHERE ${scoped.sql}
      ORDER BY psd.active_status DESC, psd.dataset_name ASC`,
      scoped.params,
    );
    return rows.map(mapDataset);
  },

  async getDataset(userId: string, idOrKey: string) {
    const row = await datasetRowForUser(userId, idOrKey);
    const [versions] = await db.execute<RowDataPacket[]>(
      `SELECT id, version_no, mapping_json,
              DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
              DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to,
              status, approved_by, approved_at, created_at
         FROM performance_mapping_version
        WHERE dataset_id = ?
        ORDER BY version_no DESC`,
      [row.id],
    );
    return {
      dataset: mapDataset(row),
      mappingVersions: versions.map((version) => ({
        id: String(version.id),
        versionNo: Number(version.version_no),
        mapping: parseJson(version.mapping_json, {}),
        effectiveFrom: String(version.effective_from),
        effectiveTo: version.effective_to ? String(version.effective_to) : null,
        status: String(version.status),
        approvedBy: version.approved_by ? String(version.approved_by) : null,
        approvedAt: version.approved_at ? new Date(version.approved_at).toISOString() : null,
        createdAt: new Date(version.created_at).toISOString(),
      })),
    };
  },

  async saveDataset(userId: string, input: DatasetInput): Promise<string> {
    const scope = await scopeFor(userId);
    const processId = input.processId?.trim() || null;
    const branchId = input.branchId?.trim() || null;
    await ensureDatasetAssignmentAllowed(scope, processId, branchId);

    const id = input.id?.trim() || randomUUID();
    if (input.id) {
      await datasetRowForUser(userId, input.id);
      await db.execute(
        `UPDATE performance_source_dataset
            SET dataset_key = ?, dataset_name = ?, source_type = ?, connector_key = ?,
                source_entity = ?, process_id = ?, branch_id = ?, timezone_name = ?,
                config_json = ?, mapping_json = ?, active_status = ?,
                approval_status = 'draft', approved_by = NULL, approved_at = NULL,
                updated_at = NOW()
          WHERE id = ?`,
        [
          input.datasetKey.trim(),
          input.datasetName.trim(),
          input.sourceType,
          input.connectorKey?.trim() || null,
          input.sourceEntity?.trim() || null,
          processId,
          branchId,
          input.timezoneName?.trim() || "Asia/Kolkata",
          JSON.stringify(input.config ?? {}),
          JSON.stringify(input.mapping),
          input.activeStatus === false ? 0 : 1,
          id,
        ],
      );
      return id;
    }

    await db.execute(
      `INSERT INTO performance_source_dataset
         (id, dataset_key, dataset_name, source_type, connector_key, source_entity,
          process_id, branch_id, timezone_name, config_json, mapping_json,
          approval_status, active_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        id,
        input.datasetKey.trim(),
        input.datasetName.trim(),
        input.sourceType,
        input.connectorKey?.trim() || null,
        input.sourceEntity?.trim() || null,
        processId,
        branchId,
        input.timezoneName?.trim() || "Asia/Kolkata",
        JSON.stringify(input.config ?? {}),
        JSON.stringify(input.mapping),
        input.activeStatus === false ? 0 : 1,
        userId,
      ],
    );
    return id;
  },

  async setDatasetActive(userId: string, idOrKey: string, activeStatus: boolean): Promise<void> {
    const dataset = await datasetRowForUser(userId, idOrKey);
    await db.execute(
      `UPDATE performance_source_dataset SET active_status = ?, updated_at = NOW() WHERE id = ?`,
      [activeStatus ? 1 : 0, dataset.id],
    );
  },

  async approveDataset(
    userId: string,
    idOrKey: string,
    effectiveFrom: string,
  ): Promise<{ versionNo: number; effectiveFrom: string }> {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const dataset = await datasetRowForUser(userId, idOrKey, connection, true);
      if (Number(dataset.active_status) !== 1) throw conflict("Inactive datasets cannot be approved");

      const [versions] = await connection.execute<RowDataPacket[]>(
        `SELECT version_no, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from
           FROM performance_mapping_version
          WHERE dataset_id = ?
          ORDER BY effective_from DESC, version_no DESC
          LIMIT 1
          FOR UPDATE`,
        [dataset.id],
      );
      const latest = versions[0];
      if (latest?.effective_from && effectiveFrom <= String(latest.effective_from)) {
        throw conflict(`The new mapping effective date must be after ${String(latest.effective_from)}`);
      }

      const versionNo = Number(latest?.version_no ?? 0) + 1;
      await connection.execute(
        `UPDATE performance_mapping_version
            SET effective_to = DATE_SUB(?, INTERVAL 1 DAY)
          WHERE dataset_id = ?
            AND status = 'active'
            AND effective_to IS NULL`,
        [effectiveFrom, dataset.id],
      );
      await connection.execute(
        `INSERT INTO performance_mapping_version
           (id, dataset_id, version_no, mapping_json, effective_from, status,
            approved_by, approved_at, created_by)
         VALUES (UUID(), ?, ?, ?, ?, 'active', ?, NOW(), ?)`,
        [dataset.id, versionNo, JSON.stringify(parseJson(dataset.mapping_json, {})), effectiveFrom, userId, userId],
      );
      await connection.execute(
        `UPDATE performance_source_dataset
            SET approval_status = 'active', approved_by = ?, approved_at = NOW(), updated_at = NOW()
          WHERE id = ?`,
        [userId, dataset.id],
      );
      await connection.commit();
      return { versionNo, effectiveFrom };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  },

  async assertDatasetAccess(userId: string, idOrKey: string): Promise<PerformanceDataset> {
    const row = await datasetRowForUser(userId, idOrKey);
    return mapDataset(row) as PerformanceDataset;
  },

  async listRuns(userId: string, datasetId: string, page = 1, pageSize = 25) {
    const dataset = await datasetRowForUser(userId, datasetId);
    const safePage = pageNumber(page, 1, 100000);
    const safePageSize = pageNumber(pageSize, 25, 100);
    const offset = (safePage - 1) * safePageSize;
    const [[countRows], [rows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM performance_ingestion_run WHERE dataset_id = ?`,
        [dataset.id],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT id, run_mode, trigger_type, status,
                DATE_FORMAT(window_from, '%Y-%m-%d') AS window_from,
                DATE_FORMAT(window_to, '%Y-%m-%d') AS window_to,
                source_file_name, source_row_count, staged_row_count, mapped_row_count,
                invalid_row_count, published_fact_count, error_count, error_summary,
                started_at, finished_at, created_at
           FROM performance_ingestion_run
          WHERE dataset_id = ?
          ORDER BY created_at DESC
          LIMIT ${safePageSize} OFFSET ${offset}`,
        [dataset.id],
      ),
    ]);
    return {
      rows: rows.map((row) => ({
        id: String(row.id),
        mode: String(row.run_mode),
        triggerType: String(row.trigger_type),
        status: String(row.status),
        windowFrom: row.window_from ? String(row.window_from) : null,
        windowTo: row.window_to ? String(row.window_to) : null,
        sourceFileName: row.source_file_name ? String(row.source_file_name) : null,
        sourceRows: Number(row.source_row_count ?? 0),
        stagedRows: Number(row.staged_row_count ?? 0),
        mappedRows: Number(row.mapped_row_count ?? 0),
        invalidRows: Number(row.invalid_row_count ?? 0),
        publishedFacts: Number(row.published_fact_count ?? 0),
        errorCount: Number(row.error_count ?? 0),
        errorSummary: row.error_summary ? String(row.error_summary) : null,
        startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
        finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      total: Number(countRows[0]?.total ?? 0),
      page: safePage,
      pageSize: safePageSize,
    };
  },

  async runDetail(userId: string, runId: string) {
    const scope = await scopeFor(userId);
    const scoped = buildDatasetScopeFilter(scope, "psd");
    const [runs] = await db.execute<RowDataPacket[]>(
      `SELECT pir.*, psd.dataset_key, psd.dataset_name
         FROM performance_ingestion_run pir
         JOIN performance_source_dataset psd ON psd.id = pir.dataset_id
        WHERE pir.id = ?
          AND ${scoped.sql}
        LIMIT 1`,
      [runId, ...scoped.params],
    );
    if (!runs[0]) throw notFound("Ingestion run was not found in your assigned scope");

    const [[validations], [reconciliations], [exceptions], [publications]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT * FROM performance_validation_result
          WHERE run_id = ? ORDER BY severity DESC, id ASC LIMIT 500`,
        [runId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT * FROM performance_reconciliation_result
          WHERE run_id = ? ORDER BY reconciliation_code`,
        [runId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT * FROM integration_mapping_exception
          WHERE integration_run_id = ? ORDER BY created_at ASC LIMIT 500`,
        [runId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT * FROM performance_publication_batch WHERE run_id = ? LIMIT 1`,
        [runId],
      ),
    ]);
    return {
      run: runs[0],
      validations,
      reconciliations,
      mappingExceptions: exceptions,
      publication: publications[0] ?? null,
    };
  },

  async listMappingExceptions(userId: string, input: {
    status?: string;
    datasetId?: string | null;
    page?: number;
    pageSize?: number;
  }) {
    const scope = await scopeFor(userId);
    const scoped = buildDatasetScopeFilter(scope, "psd");
    const status = String(input.status ?? "open").trim().toLowerCase();
    const safePage = pageNumber(input.page, 1, 100000);
    const safePageSize = pageNumber(input.pageSize, 25, 100);
    const offset = (safePage - 1) * safePageSize;
    const conditions = [`ime.status = ?`, scoped.sql];
    const params: string[] = [status, ...scoped.params];
    if (input.datasetId) {
      conditions.push("psd.id = ?");
      params.push(input.datasetId);
    }

    const [[countRows], [rows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
           FROM integration_mapping_exception ime
           JOIN performance_source_dataset psd ON psd.dataset_key = ime.source_system
          WHERE ${conditions.join(" AND ")}`,
        params,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT ime.*, psd.id AS dataset_id, psd.dataset_name
           FROM integration_mapping_exception ime
           JOIN performance_source_dataset psd ON psd.dataset_key = ime.source_system
          WHERE ${conditions.join(" AND ")}
          ORDER BY ime.created_at DESC
          LIMIT ${safePageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((row) => ({
        id: String(row.id),
        runId: row.integration_run_id ? String(row.integration_run_id) : null,
        datasetId: String(row.dataset_id),
        datasetName: String(row.dataset_name),
        sourceSystem: String(row.source_system),
        sourceEntity: row.source_entity ? String(row.source_entity) : null,
        externalIdentifier: String(row.external_identifier ?? ""),
        exceptionType: String(row.exception_type),
        detail: String(row.exception_detail ?? ""),
        status: String(row.status),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      })),
      total: Number(countRows[0]?.total ?? 0),
      page: safePage,
      pageSize: safePageSize,
    };
  },

  async resolveMappingException(
    userId: string,
    exceptionId: string,
    input: MappingResolutionInput,
  ): Promise<void> {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const scope = await scopeFor(userId);
      const scoped = buildDatasetScopeFilter(scope, "psd");
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT ime.*, psd.id AS dataset_id, psd.dataset_key, psd.process_id, psd.branch_id
           FROM integration_mapping_exception ime
           JOIN performance_source_dataset psd ON psd.dataset_key = ime.source_system
          WHERE ime.id = ?
            AND ${scoped.sql}
          LIMIT 1
          FOR UPDATE`,
        [exceptionId, ...scoped.params],
      );
      const exception = rows[0];
      if (!exception) throw notFound("Mapping exception was not found in your assigned scope");
      if (String(exception.status).toLowerCase() !== "open") {
        throw conflict("This mapping exception is already closed");
      }

      const effectiveFrom = input.effectiveFrom?.trim() || new Date().toISOString().slice(0, 10);
      const effectiveTo = input.effectiveTo?.trim() || null;
      if (effectiveTo && effectiveTo < effectiveFrom) {
        throw conflict("The mapping effective-to date cannot be before effective-from");
      }

      if (input.action === "map_employee") {
        if (!input.employeeId) throw conflict("An HRMS employee is required to resolve this exception");
        await ensureEmployeeAllowed(connection, scope, input.employeeId);
        await connection.execute(
          `INSERT INTO performance_identity_map
             (id, source_key, external_identifier, identifier_type, employee_id, process_id,
              mapping_method, mapping_status, effective_from, effective_to, verified_by, verified_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, 'manual', 'verified', ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             employee_id = VALUES(employee_id), process_id = VALUES(process_id),
             identifier_type = VALUES(identifier_type), effective_to = VALUES(effective_to),
             mapping_status = 'verified', verified_by = VALUES(verified_by),
             verified_at = NOW(), updated_at = NOW()`,
          [
            String(exception.dataset_key),
            String(exception.external_identifier),
            input.identifierType?.trim() || "client_login",
            input.employeeId,
            input.processId?.trim() || exception.process_id || null,
            effectiveFrom,
            effectiveTo,
            userId,
          ],
        );
      }

      if (input.action === "map_process") {
        if (!input.processId) throw conflict("An HRMS process is required to resolve this exception");
        const branchId = input.branchId?.trim() || exception.branch_id || null;
        await ensureProcessAllowed(connection, scope, input.processId, branchId);
        await connection.execute(
          `INSERT INTO performance_process_map
             (id, source_key, external_process, process_id, branch_id, effective_from,
              effective_to, mapping_status, verified_by, verified_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'verified', ?, NOW())
           ON DUPLICATE KEY UPDATE
             process_id = VALUES(process_id), branch_id = VALUES(branch_id),
             effective_to = VALUES(effective_to), mapping_status = 'verified',
             verified_by = VALUES(verified_by), verified_at = NOW(), updated_at = NOW()`,
          [
            String(exception.dataset_key),
            String(exception.external_identifier),
            input.processId,
            branchId,
            effectiveFrom,
            effectiveTo,
            userId,
          ],
        );
      }

      const closedStatus = input.action === "ignore" ? "ignored" : "resolved";
      const resolutionText = [
        String(exception.exception_detail ?? ""),
        `Resolution action: ${input.action}`,
        input.notes?.trim() ? `Resolution notes: ${input.notes.trim()}` : null,
        `Resolved by: ${userId}`,
      ].filter(Boolean).join("\n").slice(0, 4000);
      await connection.execute(
        `UPDATE integration_mapping_exception
            SET status = ?, exception_detail = ?, updated_at = NOW()
          WHERE id = ?`,
        [closedStatus, resolutionText, exceptionId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  },

  async saveIdentityMap(userId: string, input: {
    sourceKey: string;
    externalIdentifier: string;
    identifierType: string;
    employeeId: string;
    processId?: string | null;
    effectiveFrom: string;
    effectiveTo?: string | null;
  }): Promise<void> {
    await datasetRowForUser(userId, input.sourceKey);
    const scope = await scopeFor(userId);
    await ensureEmployeeAllowed(db, scope, input.employeeId);
    await db.execute(
      `INSERT INTO performance_identity_map
         (id, source_key, external_identifier, identifier_type, employee_id, process_id,
          mapping_method, mapping_status, effective_from, effective_to, verified_by, verified_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, 'manual', 'verified', ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         employee_id = VALUES(employee_id), process_id = VALUES(process_id),
         identifier_type = VALUES(identifier_type), effective_to = VALUES(effective_to),
         mapping_status = 'verified', verified_by = VALUES(verified_by),
         verified_at = NOW(), updated_at = NOW()`,
      [
        input.sourceKey,
        input.externalIdentifier,
        input.identifierType,
        input.employeeId,
        input.processId ?? null,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        userId,
      ],
    );
  },

  async saveProcessMap(userId: string, input: {
    sourceKey: string;
    externalProcess: string;
    processId: string;
    branchId?: string | null;
    effectiveFrom: string;
    effectiveTo?: string | null;
  }): Promise<void> {
    await datasetRowForUser(userId, input.sourceKey);
    const scope = await scopeFor(userId);
    await ensureProcessAllowed(db, scope, input.processId, input.branchId ?? null);
    await db.execute(
      `INSERT INTO performance_process_map
         (id, source_key, external_process, process_id, branch_id, effective_from,
          effective_to, mapping_status, verified_by, verified_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'verified', ?, NOW())
       ON DUPLICATE KEY UPDATE
         process_id = VALUES(process_id), branch_id = VALUES(branch_id),
         effective_to = VALUES(effective_to), mapping_status = 'verified',
         verified_by = VALUES(verified_by), verified_at = NOW(), updated_at = NOW()`,
      [
        input.sourceKey,
        input.externalProcess,
        input.processId,
        input.branchId ?? null,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        userId,
      ],
    );
  },

  async referenceData(userId: string, search = "") {
    const scope = await scopeFor(userId);
    const employeeScope = buildEmployeeScopeFilter(scope, "e");
    const term = search.trim();
    const searchSql = term
      ? `AND (e.employee_code LIKE ? OR e.full_name LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ?)`
      : "";
    const searchParams = term ? Array(4).fill(`%${term}%`) : [];

    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code,
              COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
              e.process_id, e.branch_id, pm.process_name, bm.branch_name
         FROM employees e
         LEFT JOIN process_master pm ON pm.id = e.process_id
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE e.active_status = 1
          AND ${employeeScope.sql}
          ${searchSql}
        ORDER BY employee_name ASC, e.employee_code ASC
        LIMIT 200`,
      [...employeeScope.params, ...searchParams],
    );

    const [processes] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT pm.id, pm.process_name
         FROM process_master pm
         JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
        WHERE pm.active_status = 1
          AND ${employeeScope.sql}
        ORDER BY pm.process_name ASC`,
      employeeScope.params,
    );

    const [branches] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT bm.id, bm.branch_name
         FROM branch_master bm
         JOIN employees e ON e.branch_id = bm.id AND e.active_status = 1
        WHERE bm.active_status = 1
          AND ${employeeScope.sql}
        ORDER BY bm.branch_name ASC`,
      employeeScope.params,
    );

    const [metrics] = await db.execute<RowDataPacket[]>(
      `SELECT id, metric_code, metric_name, unit, direction,
              COALESCE(aggregation_method, 'average') AS aggregation_method
         FROM kpi_metric_master
        WHERE active_status = 1
        ORDER BY COALESCE(display_order, 100), metric_name, metric_code`,
    );

    return {
      employees: employees.map((row) => ({
        id: String(row.id),
        employeeCode: String(row.employee_code ?? ""),
        employeeName: String(row.employee_name ?? row.employee_code ?? "Employee"),
        processId: row.process_id ? String(row.process_id) : null,
        branchId: row.branch_id ? String(row.branch_id) : null,
        processName: row.process_name ? String(row.process_name) : null,
        branchName: row.branch_name ? String(row.branch_name) : null,
      })),
      processes: processes.map((row) => ({
        id: String(row.id),
        name: String(row.process_name),
      })),
      branches: branches.map((row) => ({
        id: String(row.id),
        name: String(row.branch_name),
      })),
      metrics: metrics.map((row) => ({
        id: String(row.id),
        code: String(row.metric_code),
        name: String(row.metric_name ?? row.metric_code),
        unit: String(row.unit ?? "count"),
        direction: String(row.direction ?? "higher_is_better"),
        aggregation: String(row.aggregation_method ?? "average"),
      })),
    };
  },
};
