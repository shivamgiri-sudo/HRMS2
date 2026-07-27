import { createHash, randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { readPerformanceSourceRows } from "./performance-source-adapters.js";
import { publishPerformanceFacts } from "./performance-publication.service.js";
import type {
  DatasetMapping,
  DatasetMetricBinding,
  IngestionRunResult,
  NormalisedMetricFact,
  PerformanceAggregation,
  PerformanceDataset,
  PerformanceRunMode,
  SourceRow,
  ValidationIssue,
} from "./performance-ingestion.types.js";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function datasetFromRow(row: RowDataPacket): PerformanceDataset {
  return {
    id: String(row.id),
    datasetKey: String(row.dataset_key),
    datasetName: String(row.dataset_name),
    sourceType: row.source_type,
    connectorKey: row.connector_key ? String(row.connector_key) : null,
    sourceEntity: row.source_entity ? String(row.source_entity) : null,
    processId: row.process_id ? String(row.process_id) : null,
    branchId: row.branch_id ? String(row.branch_id) : null,
    timezoneName: String(row.timezone_name ?? "Asia/Kolkata"),
    config: parseJson(row.config_json, {}),
    mapping: parseJson<DatasetMapping>(row.mapping_json, {
      employeeIdentifierField: "employee_code",
      eventDateField: "date",
      metrics: [],
    }),
    approvalStatus: String(row.approval_status ?? "draft"),
    activeStatus: Number(row.active_status ?? 0) === 1,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function rowHash(row: SourceRow): string {
  return createHash("sha256").update(JSON.stringify(stableValue(row))).digest("hex");
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const normalised = value.replace(/,/g, "").replace(/%$/, "").trim();
    if (!normalised) return null;
    const parsed = Number(normalised);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function field(row: SourceRow, name?: string): unknown {
  if (!name) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const target = name.trim().toLowerCase();
  const found = Object.keys(row).find((key) => key.trim().toLowerCase() === target);
  return found ? row[found] : undefined;
}

async function loadDataset(idOrKey: string, requireApproved = false): Promise<PerformanceDataset> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM performance_source_dataset
      WHERE (id = ? OR dataset_key = ?) AND active_status = 1
      LIMIT 1`,
    [idOrKey, idOrKey],
  );
  if (!rows[0]) throw Object.assign(new Error("Performance dataset not found"), { statusCode: 404 });
  const dataset = datasetFromRow(rows[0]);
  if (requireApproved && dataset.approvalStatus !== "active") {
    throw Object.assign(new Error("Dataset must be approved before publishing"), { statusCode: 409 });
  }
  if (!dataset.mapping.metrics?.length) {
    throw Object.assign(new Error("Dataset has no metric bindings"), { statusCode: 409 });
  }
  return dataset;
}

async function activeMappingVersion(datasetId: string, eventDate: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM performance_mapping_version
      WHERE dataset_id = ?
        AND status = 'active'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY version_no DESC
      LIMIT 1`,
    [datasetId, eventDate, eventDate],
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function mapEmployee(
  sourceKey: string,
  externalIdentifier: string,
  eventDate: string,
): Promise<{ employeeId: string; processId: string | null; branchId: string | null } | null> {
  const [mapped] = await db.execute<RowDataPacket[]>(
    `SELECT pim.employee_id, COALESCE(pim.process_id, e.process_id) AS process_id, e.branch_id
       FROM performance_identity_map pim
       JOIN employees e ON e.id = pim.employee_id AND e.active_status = 1
      WHERE pim.source_key = ?
        AND UPPER(TRIM(pim.external_identifier)) = UPPER(TRIM(?))
        AND pim.mapping_status = 'verified'
        AND pim.effective_from <= ?
        AND (pim.effective_to IS NULL OR pim.effective_to >= ?)
      ORDER BY pim.effective_from DESC
      LIMIT 1`,
    [sourceKey, externalIdentifier, eventDate, eventDate],
  );
  if (mapped[0]) {
    return {
      employeeId: String(mapped[0].employee_id),
      processId: mapped[0].process_id ? String(mapped[0].process_id) : null,
      branchId: mapped[0].branch_id ? String(mapped[0].branch_id) : null,
    };
  }

  const [fallback] = await db.execute<RowDataPacket[]>(
    `SELECT id AS employee_id, process_id, branch_id
       FROM employees
      WHERE active_status = 1
        AND (UPPER(TRIM(employee_code)) = UPPER(TRIM(?))
          OR UPPER(TRIM(COALESCE(biometric_code, ''))) = UPPER(TRIM(?)))
      ORDER BY updated_at DESC
      LIMIT 2`,
    [externalIdentifier, externalIdentifier],
  );
  if (fallback.length !== 1) return null;
  return {
    employeeId: String(fallback[0].employee_id),
    processId: fallback[0].process_id ? String(fallback[0].process_id) : null,
    branchId: fallback[0].branch_id ? String(fallback[0].branch_id) : null,
  };
}

async function mapProcess(
  sourceKey: string,
  externalProcess: string,
  eventDate: string,
): Promise<{ processId: string; branchId: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, branch_id
       FROM performance_process_map
      WHERE source_key = ?
        AND UPPER(TRIM(external_process)) = UPPER(TRIM(?))
        AND mapping_status = 'verified'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [sourceKey, externalProcess, eventDate, eventDate],
  );
  if (!rows[0]) return null;
  return {
    processId: String(rows[0].process_id),
    branchId: rows[0].branch_id ? String(rows[0].branch_id) : null,
  };
}

async function metricMap(bindings: DatasetMetricBinding[]): Promise<Map<string, { id: string; aggregation: PerformanceAggregation }>> {
  const codes = [...new Set(bindings.map((binding) => text(binding.metricCode).toUpperCase()).filter(Boolean))];
  if (!codes.length) return new Map();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, metric_code, COALESCE(aggregation_method, 'average') AS aggregation_method
       FROM kpi_metric_master
      WHERE active_status = 1 AND metric_code IN (${codes.map(() => "?").join(",")})`,
    codes,
  );
  return new Map(rows.map((row) => [String(row.metric_code).toUpperCase(), {
    id: String(row.id),
    aggregation: String(row.aggregation_method ?? "average") as PerformanceAggregation,
  }]));
}

async function insertRawRecord(
  runId: string,
  row: SourceRow,
  mapping: DatasetMapping,
  eventDate: string | null,
): Promise<number> {
  const externalIdentifier = text(field(row, mapping.employeeIdentifierField));
  const externalProcess = text(field(row, mapping.externalProcessField));
  const sourceRecordKey = text(field(row, mapping.sourceRecordKeyField)) || null;
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO performance_raw_record
       (run_id, source_record_key, source_event_date, external_employee_identifier,
        external_process_identifier, source_row_json, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [runId, sourceRecordKey, eventDate, externalIdentifier || null, externalProcess || null, JSON.stringify(row), rowHash(row)],
  );
  return Number(result.insertId);
}

async function recordIssue(runId: string, issue: ValidationIssue): Promise<void> {
  await db.execute(
    `INSERT INTO performance_validation_result
       (run_id, raw_record_id, validation_code, severity, field_name, invalid_value, validation_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      issue.rawRecordId ?? null,
      issue.code,
      issue.severity,
      issue.fieldName ?? null,
      issue.invalidValue === undefined ? null : text(issue.invalidValue).slice(0, 1000),
      issue.message.slice(0, 1000),
    ],
  );
}

async function recordMappingException(input: {
  runId: string;
  dataset: PerformanceDataset;
  externalIdentifier: string;
  exceptionType: "employee_unmapped" | "process_unmapped" | "metric_unmapped" | "invalid_value";
  detail: string;
}): Promise<void> {
  await db.execute(
    `INSERT INTO integration_mapping_exception
       (id, integration_run_id, source_system, source_entity, external_identifier,
        exception_type, exception_detail, status)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'open')
     ON DUPLICATE KEY UPDATE exception_detail = VALUES(exception_detail), updated_at = NOW()`,
    [
      input.runId,
      input.dataset.datasetKey,
      input.dataset.sourceEntity ?? input.dataset.datasetName,
      input.externalIdentifier,
      input.exceptionType,
      input.detail.slice(0, 1000),
    ],
  ).catch(() => undefined);
}

type Accumulator = {
  template: NormalisedMetricFact;
  aggregation: PerformanceAggregation;
  sum: number;
  count: number;
  numerator: number;
  denominator: number;
  recordCount: number;
};

function addFact(
  accumulator: Map<string, Accumulator>,
  fact: NormalisedMetricFact,
  aggregation: PerformanceAggregation,
): void {
  const key = [fact.employeeId, fact.metricId, fact.scoreDate].join("|");
  const current = accumulator.get(key) ?? {
    template: fact,
    aggregation,
    sum: 0,
    count: 0,
    numerator: 0,
    denominator: 0,
    recordCount: 0,
  };
  current.template = aggregation === "latest" ? fact : current.template;
  current.sum += fact.actualValue;
  current.count += 1;
  current.numerator += fact.numeratorValue ?? 0;
  current.denominator += fact.denominatorValue ?? 0;
  current.recordCount += Math.max(0, fact.sourceRecordCount ?? 1);
  accumulator.set(key, current);
}

function finalFacts(accumulator: Map<string, Accumulator>, bindings: DatasetMetricBinding[]): NormalisedMetricFact[] {
  const multiplierByMetric = new Map(bindings.map((binding) => [text(binding.metricCode).toUpperCase(), Number(binding.ratioMultiplier ?? 100)]));
  return [...accumulator.values()].map((item) => {
    let actual = item.template.actualValue;
    if (item.aggregation === "sum") actual = item.sum;
    if (item.aggregation === "average") actual = item.count ? item.sum / item.count : 0;
    if (item.aggregation === "ratio") {
      actual = item.denominator > 0
        ? (item.numerator / item.denominator) * (multiplierByMetric.get(item.template.metricCode) ?? 100)
        : item.count ? item.sum / item.count : 0;
    }
    return {
      ...item.template,
      actualValue: Math.round(actual * 1_000_000) / 1_000_000,
      numeratorValue: item.aggregation === "ratio" ? item.numerator : item.template.numeratorValue,
      denominatorValue: item.aggregation === "ratio" ? item.denominator : item.template.denominatorValue,
      sourceRecordCount: item.recordCount,
    };
  });
}

async function saveReconciliation(runId: string, code: string, expected: number, actual: number): Promise<void> {
  const variance = actual - expected;
  await db.execute(
    `INSERT INTO performance_reconciliation_result
       (id, run_id, reconciliation_code, expected_value, actual_value, variance_value, tolerance_value, passed)
     VALUES (UUID(), ?, ?, ?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE expected_value = VALUES(expected_value), actual_value = VALUES(actual_value),
       variance_value = VALUES(variance_value), passed = VALUES(passed)`,
    [runId, code, expected, actual, variance, variance === 0 ? 1 : 0],
  );
}

async function updateRun(runId: string, result: Omit<IngestionRunResult, "runId" | "mode" | "sample" | "issues">): Promise<void> {
  await db.execute(
    `UPDATE performance_ingestion_run
        SET status = ?, source_row_count = ?, staged_row_count = ?, mapped_row_count = ?,
            invalid_row_count = ?, published_fact_count = ?, error_count = ?,
            error_summary = ?, finished_at = NOW()
      WHERE id = ?`,
    [
      result.status,
      result.sourceRows,
      result.stagedRows,
      result.mappedRows,
      result.invalidRows,
      result.publishedFacts,
      result.errors.length,
      result.errors.join("\n").slice(0, 65000) || null,
      runId,
    ],
  );
}

export const performanceIngestionService = {
  async listDatasets(): Promise<PerformanceDataset[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM performance_source_dataset ORDER BY active_status DESC, dataset_name ASC`,
    );
    return rows.map(datasetFromRow);
  },

  async getDataset(idOrKey: string): Promise<PerformanceDataset> {
    return loadDataset(idOrKey, false);
  },

  async saveDataset(input: {
    id?: string;
    datasetKey: string;
    datasetName: string;
    sourceType: string;
    connectorKey?: string | null;
    sourceEntity?: string | null;
    processId?: string | null;
    branchId?: string | null;
    timezoneName?: string;
    config: Record<string, unknown>;
    mapping: DatasetMapping;
    activeStatus?: boolean;
    userId?: string | null;
  }): Promise<string> {
    const id = input.id ?? randomUUID();
    await db.execute(
      `INSERT INTO performance_source_dataset
         (id, dataset_key, dataset_name, source_type, connector_key, source_entity,
          process_id, branch_id, timezone_name, config_json, mapping_json, active_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         dataset_name = VALUES(dataset_name), source_type = VALUES(source_type),
         connector_key = VALUES(connector_key), source_entity = VALUES(source_entity),
         process_id = VALUES(process_id), branch_id = VALUES(branch_id),
         timezone_name = VALUES(timezone_name), config_json = VALUES(config_json),
         mapping_json = VALUES(mapping_json), active_status = VALUES(active_status), updated_at = NOW()`,
      [
        id,
        input.datasetKey.trim(),
        input.datasetName.trim(),
        input.sourceType,
        input.connectorKey ?? null,
        input.sourceEntity ?? null,
        input.processId ?? null,
        input.branchId ?? null,
        input.timezoneName ?? "Asia/Kolkata",
        JSON.stringify(input.config ?? {}),
        JSON.stringify(input.mapping),
        input.activeStatus === false ? 0 : 1,
        input.userId ?? null,
      ],
    );
    return id;
  },

  async approveDataset(idOrKey: string, userId: string): Promise<void> {
    const dataset = await loadDataset(idOrKey, false);
    const [versions] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(version_no), 0) AS max_version FROM performance_mapping_version WHERE dataset_id = ?`,
      [dataset.id],
    );
    const version = Number(versions[0]?.max_version ?? 0) + 1;
    await db.execute(
      `INSERT INTO performance_mapping_version
         (id, dataset_id, version_no, mapping_json, effective_from, status, approved_by, approved_at, created_by)
       VALUES (UUID(), ?, ?, ?, CURDATE(), 'active', ?, NOW(), ?)`,
      [dataset.id, version, JSON.stringify(dataset.mapping), userId, userId],
    );
    await db.execute(
      `UPDATE performance_source_dataset
          SET approval_status = 'active', approved_by = ?, approved_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [userId, dataset.id],
    );
  },

  async run(input: {
    datasetId: string;
    mode: PerformanceRunMode;
    from: string;
    to: string;
    requestedBy?: string | null;
    uploadBuffer?: Buffer | null;
    sourceFileName?: string | null;
  }): Promise<IngestionRunResult> {
    const dataset = await loadDataset(input.datasetId, input.mode === "publish");
    const runId = randomUUID();
    const sourceFileHash = input.uploadBuffer
      ? createHash("sha256").update(input.uploadBuffer).digest("hex")
      : null;

    if (input.mode === "publish" && sourceFileHash) {
      const [duplicate] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM performance_ingestion_run
          WHERE dataset_id = ? AND source_file_hash = ? AND status = 'published'
          LIMIT 1`,
        [dataset.id, sourceFileHash],
      );
      if (duplicate[0]) {
        throw Object.assign(new Error("This file has already been published for the selected dataset"), { statusCode: 409 });
      }
    }

    await db.execute(
      `INSERT INTO performance_ingestion_run
         (id, dataset_id, run_mode, trigger_type, status, window_from, window_to,
          source_file_name, source_file_hash, requested_by, started_at)
       VALUES (?, ?, ?, 'manual', 'running', ?, ?, ?, ?, ?, NOW())`,
      [runId, dataset.id, input.mode, input.from, input.to, input.sourceFileName ?? null, sourceFileHash, input.requestedBy ?? null],
    );

    const issues: ValidationIssue[] = [];
    const errors: string[] = [];
    let sourceRows = 0;
    let stagedRows = 0;
    let mappedRows = 0;
    let invalidRows = 0;
    let publishedFacts = 0;
    let sample: SourceRow[] = [];

    try {
      const [checkpoints] = await db.execute<RowDataPacket[]>(
        `SELECT checkpoint_value FROM performance_ingestion_checkpoint WHERE dataset_id = ?`,
        [dataset.id],
      );
      const checkpoint = checkpoints[0]?.checkpoint_value ? String(checkpoints[0].checkpoint_value) : null;
      const rows = await readPerformanceSourceRows(dataset, {
        from: input.from,
        to: input.to,
        checkpoint,
        uploadBuffer: input.uploadBuffer,
      });
      sourceRows = rows.length;
      sample = rows.slice(0, 20);
      const metrics = await metricMap(dataset.mapping.metrics);
      const accumulator = new Map<string, Accumulator>();
      let mappingVersionId: string | null = null;

      for (const row of rows) {
        const eventDate = dateOnly(field(row, dataset.mapping.eventDateField));
        const rawRecordId = await insertRawRecord(runId, row, dataset.mapping, eventDate);
        stagedRows += 1;
        const rowIssues: ValidationIssue[] = [];
        const externalIdentifier = text(field(row, dataset.mapping.employeeIdentifierField));
        const externalProcess = text(field(row, dataset.mapping.externalProcessField));

        if (!eventDate) {
          rowIssues.push({ rawRecordId, code: "INVALID_EVENT_DATE", severity: "error", fieldName: dataset.mapping.eventDateField, invalidValue: field(row, dataset.mapping.eventDateField), message: "A valid performance event date is required" });
        }
        if (!externalIdentifier) {
          rowIssues.push({ rawRecordId, code: "MISSING_EMPLOYEE_IDENTIFIER", severity: "error", fieldName: dataset.mapping.employeeIdentifierField, message: "Employee identifier is blank" });
        }

        if (rowIssues.length) {
          invalidRows += 1;
          for (const issue of rowIssues) { issues.push(issue); await recordIssue(runId, issue); }
          continue;
        }

        mappingVersionId = mappingVersionId ?? await activeMappingVersion(dataset.id, eventDate!);
        const employee = await mapEmployee(dataset.datasetKey, externalIdentifier, eventDate!);
        if (!employee) {
          const issue: ValidationIssue = { rawRecordId, code: "EMPLOYEE_UNMAPPED", severity: "error", fieldName: dataset.mapping.employeeIdentifierField, invalidValue: externalIdentifier, message: "External employee identifier is not mapped to one active HRMS employee" };
          issues.push(issue); await recordIssue(runId, issue);
          await recordMappingException({ runId, dataset, externalIdentifier, exceptionType: "employee_unmapped", detail: issue.message });
          invalidRows += 1;
          continue;
        }

        let processId = dataset.processId ?? employee.processId;
        let branchId = dataset.branchId ?? employee.branchId;
        if (externalProcess) {
          const process = await mapProcess(dataset.datasetKey, externalProcess, eventDate!);
          if (!process && !processId) {
            const issue: ValidationIssue = { rawRecordId, code: "PROCESS_UNMAPPED", severity: "error", fieldName: dataset.mapping.externalProcessField, invalidValue: externalProcess, message: "External process is not mapped to an HRMS process" };
            issues.push(issue); await recordIssue(runId, issue);
            await recordMappingException({ runId, dataset, externalIdentifier: externalProcess, exceptionType: "process_unmapped", detail: issue.message });
            invalidRows += 1;
            continue;
          }
          if (process) { processId = process.processId; branchId = process.branchId ?? branchId; }
        }

        let factCountForRow = 0;
        for (const binding of dataset.mapping.metrics) {
          const metricCode = text(binding.metricCode).toUpperCase();
          const metric = metrics.get(metricCode);
          if (!metric) {
            const issue: ValidationIssue = { rawRecordId, code: "METRIC_UNMAPPED", severity: "error", invalidValue: metricCode, message: `Metric ${metricCode} is not active in KPI master` };
            issues.push(issue); await recordIssue(runId, issue);
            await recordMappingException({ runId, dataset, externalIdentifier: metricCode, exceptionType: "metric_unmapped", detail: issue.message });
            continue;
          }
          const value = numberOrNull(field(row, binding.valueField));
          const numerator = numberOrNull(field(row, binding.numeratorField));
          const denominator = numberOrNull(field(row, binding.denominatorField));
          const aggregation = binding.aggregation ?? metric.aggregation;
          const derived = aggregation === "ratio" && numerator !== null && denominator !== null && denominator > 0
            ? (numerator / denominator) * Number(binding.ratioMultiplier ?? 100)
            : value;
          if (derived === null) {
            const issue: ValidationIssue = { rawRecordId, code: "INVALID_METRIC_VALUE", severity: "error", fieldName: binding.valueField ?? binding.numeratorField ?? metricCode, invalidValue: field(row, binding.valueField), message: `No valid numeric value is available for ${metricCode}` };
            issues.push(issue); await recordIssue(runId, issue);
            continue;
          }
          addFact(accumulator, {
            employeeId: employee.employeeId,
            metricId: metric.id,
            metricCode,
            scoreDate: eventDate!,
            actualValue: derived,
            numeratorValue: numerator,
            denominatorValue: denominator,
            sourceRecordCount: numberOrNull(field(row, binding.sourceRecordCountField)) ?? 1,
            sourceRecordKey: text(field(row, dataset.mapping.sourceRecordKeyField)) || rowHash(row),
            rawRecordId,
            processIdAtEvent: processId,
            branchIdAtEvent: branchId,
          }, aggregation);
          factCountForRow += 1;
        }
        if (factCountForRow > 0) mappedRows += 1;
        else invalidRows += 1;
      }

      const facts = finalFacts(accumulator, dataset.mapping.metrics);
      if (input.mode === "publish") {
        publishedFacts = await publishPerformanceFacts({
          dataset,
          runId,
          mappingVersionId,
          requestedBy: input.requestedBy ?? null,
          windowFrom: input.from,
          windowTo: input.to,
          facts,
        });
      }

      await saveReconciliation(runId, "SOURCE_TO_STAGING_ROWS", sourceRows, stagedRows);
      await saveReconciliation(runId, "STAGING_TO_CLASSIFIED_ROWS", stagedRows, mappedRows + invalidRows);
      if (input.mode === "publish") await saveReconciliation(runId, "AGGREGATED_TO_PUBLISHED_FACTS", facts.length, publishedFacts);

      const status = input.mode === "publish" ? "published" : "preview_complete";
      await updateRun(runId, { status, sourceRows, stagedRows, mappedRows, invalidRows, publishedFacts, errors });
      if (input.mode === "publish") {
        await db.execute(
          `INSERT INTO performance_ingestion_checkpoint (dataset_id, checkpoint_value, last_successful_run_id)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE checkpoint_value = VALUES(checkpoint_value),
             last_successful_run_id = VALUES(last_successful_run_id), updated_at = NOW()`,
          [dataset.id, input.to, runId],
        );
      }
      return { runId, mode: input.mode, status, sourceRows, stagedRows, mappedRows, invalidRows, publishedFacts, errors, issues: issues.slice(0, 200), sample };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      await updateRun(runId, { status: "failed", sourceRows, stagedRows, mappedRows, invalidRows, publishedFacts, errors });
      throw error;
    }
  },

  async runDetail(runId: string): Promise<Record<string, unknown>> {
    const [[runs], [validations], [reconciliations], [exceptions]] = await Promise.all([
      db.execute<RowDataPacket[]>(`SELECT * FROM performance_ingestion_run WHERE id = ? LIMIT 1`, [runId]),
      db.execute<RowDataPacket[]>(`SELECT * FROM performance_validation_result WHERE run_id = ? ORDER BY severity DESC, id ASC LIMIT 500`, [runId]),
      db.execute<RowDataPacket[]>(`SELECT * FROM performance_reconciliation_result WHERE run_id = ? ORDER BY reconciliation_code`, [runId]),
      db.execute<RowDataPacket[]>(`SELECT * FROM integration_mapping_exception WHERE integration_run_id = ? ORDER BY created_at ASC LIMIT 500`, [runId]),
    ]);
    if (!runs[0]) throw Object.assign(new Error("Ingestion run not found"), { statusCode: 404 });
    return { run: runs[0], validations, reconciliations, mappingExceptions: exceptions };
  },
};
