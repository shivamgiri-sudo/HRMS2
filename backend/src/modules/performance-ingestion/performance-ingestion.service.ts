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

type IngestionTrigger = "manual" | "schedule" | "retry";

type MetricDefinition = {
  id: string;
  aggregation: PerformanceAggregation;
};

type Accumulator = {
  template: NormalisedMetricFact;
  aggregation: PerformanceAggregation;
  sum: number;
  weightedSum: number;
  count: number;
  numerator: number;
  denominator: number;
  recordCount: number;
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
  return createHash("sha256")
    .update(JSON.stringify(stableValue(row)))
    .digest("hex");
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function timestampIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function field(row: SourceRow, name?: string): unknown {
  if (!name) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const target = name.trim().toLowerCase();
  const found = Object.keys(row).find((key) => key.trim().toLowerCase() === target);
  return found ? row[found] : undefined;
}

function configFlag(dataset: PerformanceDataset, key: string): boolean {
  return (dataset.config as Record<string, unknown>)[key] === true;
}

async function loadDataset(
  idOrKey: string,
  requireApproved = false,
): Promise<PerformanceDataset> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *
       FROM performance_source_dataset
      WHERE (id = ? OR dataset_key = ?)
        AND active_status = 1
      LIMIT 1`,
    [idOrKey, idOrKey],
  );
  if (!rows[0]) {
    throw Object.assign(new Error("Performance dataset not found or inactive"), {
      statusCode: 404,
    });
  }

  const dataset = datasetFromRow(rows[0]);
  if (requireApproved && dataset.approvalStatus !== "active") {
    throw Object.assign(new Error("Dataset must be approved before publishing"), {
      statusCode: 409,
    });
  }
  if (!dataset.mapping.metrics?.length) {
    throw Object.assign(new Error("Dataset has no metric bindings"), {
      statusCode: 409,
    });
  }
  return dataset;
}

async function activeMappingVersion(
  datasetId: string,
  eventDate: string,
): Promise<string | null> {
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
): Promise<{
  employeeId: string;
  processId: string | null;
  branchId: string | null;
} | null> {
  const [mapped] = await db.execute<RowDataPacket[]>(
    `SELECT pim.employee_id,
            COALESCE(pim.process_id, e.process_id) AS process_id,
            e.branch_id
       FROM performance_identity_map pim
       JOIN employees e
         ON e.id = pim.employee_id
        AND e.active_status = 1
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
        AND (
          UPPER(TRIM(employee_code)) = UPPER(TRIM(?))
          OR UPPER(TRIM(COALESCE(biometric_code, ''))) = UPPER(TRIM(?))
        )
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

async function metricMap(
  bindings: DatasetMetricBinding[],
): Promise<Map<string, MetricDefinition>> {
  const codes = [
    ...new Set(
      bindings
        .map((binding) => text(binding.metricCode).toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (!codes.length) return new Map();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id,
            metric_code,
            COALESCE(aggregation_method, 'average') AS aggregation_method
       FROM kpi_metric_master
      WHERE active_status = 1
        AND metric_code IN (${codes.map(() => "?").join(",")})`,
    codes,
  );
  return new Map(
    rows.map((row) => [
      String(row.metric_code).toUpperCase(),
      {
        id: String(row.id),
        aggregation: String(
          row.aggregation_method ?? "average",
        ) as PerformanceAggregation,
      },
    ]),
  );
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
       (run_id, source_record_key, source_event_date,
        external_employee_identifier, external_process_identifier,
        source_row_json, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      runId,
      sourceRecordKey,
      eventDate,
      externalIdentifier || null,
      externalProcess || null,
      JSON.stringify(row),
      rowHash(row),
    ],
  );
  return Number(result.insertId);
}

async function recordIssue(
  runId: string,
  issue: ValidationIssue,
): Promise<void> {
  await db.execute(
    `INSERT INTO performance_validation_result
       (run_id, raw_record_id, validation_code, severity,
        field_name, invalid_value, validation_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      issue.rawRecordId ?? null,
      issue.code,
      issue.severity,
      issue.fieldName ?? null,
      issue.invalidValue === undefined
        ? null
        : text(issue.invalidValue).slice(0, 1000),
      issue.message.slice(0, 1000),
    ],
  );
}

async function recordIssues(
  runId: string,
  issues: ValidationIssue[],
  destination: ValidationIssue[],
): Promise<void> {
  for (const issue of issues) {
    destination.push(issue);
    await recordIssue(runId, issue);
  }
}

async function recordMappingException(input: {
  runId: string;
  dataset: PerformanceDataset;
  externalIdentifier: string;
  exceptionType:
    | "employee_unmapped"
    | "process_unmapped"
    | "metric_unmapped"
    | "invalid_value";
  detail: string;
}): Promise<void> {
  await db.execute(
    `INSERT INTO integration_mapping_exception
       (id, integration_run_id, source_system, source_entity,
        external_identifier, exception_type, exception_detail, status)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'open')
     ON DUPLICATE KEY UPDATE
       exception_detail = VALUES(exception_detail),
       updated_at = NOW()`,
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
    weightedSum: 0,
    count: 0,
    numerator: 0,
    denominator: 0,
    recordCount: 0,
  };
  if (aggregation === "latest") {
    const currentKey = [
      current.template.scoreDate,
      current.template.sourceEventTimestamp ?? "",
      current.template.sourceRecordKey ?? "",
      current.template.rawRecordId ?? 0,
    ].join("|");
    const nextKey = [
      fact.scoreDate,
      fact.sourceEventTimestamp ?? "",
      fact.sourceRecordKey ?? "",
      fact.rawRecordId ?? 0,
    ].join("|");
    current.template = nextKey >= currentKey ? fact : current.template;
  }
  current.sum += fact.actualValue;
  current.weightedSum += fact.actualValue * Math.max(0, fact.sourceRecordCount ?? 1);
  current.count += 1;
  current.numerator += fact.numeratorValue ?? 0;
  current.denominator += fact.denominatorValue ?? 0;
  current.recordCount += Math.max(0, fact.sourceRecordCount ?? 1);
  accumulator.set(key, current);
}

function finalFacts(
  accumulator: Map<string, Accumulator>,
  bindings: DatasetMetricBinding[],
): NormalisedMetricFact[] {
  const multiplierByMetric = new Map(
    bindings.map((binding) => [
      text(binding.metricCode).toUpperCase(),
      Number(binding.ratioMultiplier ?? 100),
    ]),
  );

  return [...accumulator.values()].map((item) => {
    let actual = item.template.actualValue;
    if (item.aggregation === "sum") actual = item.sum;
    if (item.aggregation === "average") {
      actual = item.count ? item.sum / item.count : 0;
    }
    if (item.aggregation === "weighted_average") {
      actual = item.recordCount > 0
        ? item.weightedSum / item.recordCount
        : item.count
          ? item.sum / item.count
          : 0;
    }
    if (item.aggregation === "ratio") {
      actual = item.denominator > 0
        ? (item.numerator / item.denominator) *
          (multiplierByMetric.get(item.template.metricCode) ?? 100)
        : item.count
          ? item.sum / item.count
          : 0;
    }

    return {
      ...item.template,
      actualValue: Math.round(actual * 1_000_000) / 1_000_000,
      numeratorValue:
        item.aggregation === "ratio"
          ? item.numerator
          : item.template.numeratorValue,
      denominatorValue:
        item.aggregation === "ratio"
          ? item.denominator
          : item.template.denominatorValue,
      calculationMultiplier:
        item.aggregation === "ratio"
          ? multiplierByMetric.get(item.template.metricCode) ?? 100
          : item.template.calculationMultiplier,
      sourceRecordCount: item.recordCount,
    };
  });
}

async function saveReconciliation(
  runId: string,
  code: string,
  expected: number,
  actual: number,
): Promise<void> {
  const variance = actual - expected;
  await db.execute(
    `INSERT INTO performance_reconciliation_result
       (id, run_id, reconciliation_code, expected_value,
        actual_value, variance_value, tolerance_value, passed)
     VALUES (UUID(), ?, ?, ?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE
       expected_value = VALUES(expected_value),
       actual_value = VALUES(actual_value),
       variance_value = VALUES(variance_value),
       passed = VALUES(passed)`,
    [runId, code, expected, actual, variance, variance === 0 ? 1 : 0],
  );
}

async function updateRun(
  runId: string,
  result: Omit<
    IngestionRunResult,
    "runId" | "mode" | "sample" | "issues"
  >,
): Promise<void> {
  await db.execute(
    `UPDATE performance_ingestion_run
        SET status = ?,
            source_row_count = ?,
            staged_row_count = ?,
            mapped_row_count = ?,
            invalid_row_count = ?,
            published_fact_count = ?,
            error_count = ?,
            error_summary = ?,
            finished_at = NOW()
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

async function ensureNoActiveRun(datasetId: string): Promise<void> {
  await db.execute(
    `UPDATE performance_ingestion_run
        SET status = 'failed',
            error_count = GREATEST(error_count, 1),
            error_summary = COALESCE(
              error_summary,
              'Run automatically closed after exceeding the two-hour safety window'
            ),
            finished_at = COALESCE(finished_at, NOW())
      WHERE dataset_id = ?
        AND status = 'running'
        AND started_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)`,
    [datasetId],
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM performance_ingestion_run
      WHERE dataset_id = ?
        AND status = 'running'
      LIMIT 1`,
    [datasetId],
  );
  if (rows.length) {
    throw Object.assign(
      new Error("Another ingestion run is already active for this dataset"),
      { statusCode: 409 },
    );
  }
}

function publicationBlockedError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export const performanceIngestionService = {
  async run(input: {
    datasetId: string;
    mode: PerformanceRunMode;
    from: string;
    to: string;
    triggerType?: IngestionTrigger;
    requestedBy?: string | null;
    uploadBuffer?: Buffer | null;
    sourceFileName?: string | null;
  }): Promise<IngestionRunResult> {
    if (input.from > input.to) {
      throw Object.assign(new Error("from must be on or before to"), {
        statusCode: 400,
      });
    }

    const dataset = await loadDataset(
      input.datasetId,
      input.mode === "publish",
    );
    await ensureNoActiveRun(dataset.id);

    const runId = randomUUID();
    const sourceFileHash = input.uploadBuffer
      ? createHash("sha256").update(input.uploadBuffer).digest("hex")
      : null;

    if (input.mode === "publish" && sourceFileHash) {
      const [duplicate] = await db.execute<RowDataPacket[]>(
        `SELECT id
           FROM performance_ingestion_run
          WHERE dataset_id = ?
            AND source_file_hash = ?
            AND status = 'published'
          LIMIT 1`,
        [dataset.id, sourceFileHash],
      );
      if (duplicate[0]) {
        throw Object.assign(
          new Error(
            "This file has already been published for the selected dataset",
          ),
          { statusCode: 409 },
        );
      }
    }

    await db.execute(
      `INSERT INTO performance_ingestion_run
         (id, dataset_id, run_mode, trigger_type, status,
          window_from, window_to, source_file_name, source_file_hash,
          requested_by, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, NOW())`,
      [
        runId,
        dataset.id,
        input.mode,
        input.triggerType ?? "manual",
        input.from,
        input.to,
        input.sourceFileName ?? null,
        sourceFileHash,
        input.requestedBy ?? null,
      ],
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
        `SELECT checkpoint_value
           FROM performance_ingestion_checkpoint
          WHERE dataset_id = ?`,
        [dataset.id],
      );
      const checkpoint = checkpoints[0]?.checkpoint_value
        ? String(checkpoints[0].checkpoint_value)
        : null;

      const rows = await readPerformanceSourceRows(dataset, {
        from: input.from,
        to: input.to,
        checkpoint,
        uploadBuffer: input.uploadBuffer,
        sourceFileName: input.sourceFileName,
      });
      sourceRows = rows.length;
      sample = rows.slice(0, 20);

      const metrics = await metricMap(dataset.mapping.metrics);
      const accumulator = new Map<string, Accumulator>();
      const mappingVersionCache = new Map<string, string | null>();

      for (const row of rows) {
        const eventDate = dateOnly(
          field(row, dataset.mapping.eventDateField),
        );
        const sourceEventTimestamp = timestampIso(
          field(row, dataset.mapping.sourceEventTimestampField),
        );
        const rawRecordId = await insertRawRecord(
          runId,
          row,
          dataset.mapping,
          eventDate,
        );
        stagedRows += 1;

        const rowIssues: ValidationIssue[] = [];
        const externalIdentifier = text(
          field(row, dataset.mapping.employeeIdentifierField),
        );
        const externalProcess = text(
          field(row, dataset.mapping.externalProcessField),
        );

        if (!eventDate) {
          rowIssues.push({
            rawRecordId,
            code: "INVALID_EVENT_DATE",
            severity: "error",
            fieldName: dataset.mapping.eventDateField,
            invalidValue: field(row, dataset.mapping.eventDateField),
            message: "A valid performance event date is required",
          });
        } else if (eventDate < input.from || eventDate > input.to) {
          rowIssues.push({
            rawRecordId,
            code: "EVENT_DATE_OUTSIDE_WINDOW",
            severity: "error",
            fieldName: dataset.mapping.eventDateField,
            invalidValue: eventDate,
            message: `Performance date must be between ${input.from} and ${input.to}`,
          });
        }

        if (!externalIdentifier) {
          rowIssues.push({
            rawRecordId,
            code: "MISSING_EMPLOYEE_IDENTIFIER",
            severity: "error",
            fieldName: dataset.mapping.employeeIdentifierField,
            message: "Employee identifier is blank",
          });
        }

        if (rowIssues.length) {
          invalidRows += 1;
          await recordIssues(runId, rowIssues, issues);
          continue;
        }

        let mappingVersionId = mappingVersionCache.get(eventDate!);
        if (mappingVersionId === undefined) {
          mappingVersionId = await activeMappingVersion(dataset.id, eventDate!);
          mappingVersionCache.set(eventDate!, mappingVersionId);
        }
        if (input.mode === "publish" && !mappingVersionId) {
          const issue: ValidationIssue = {
            rawRecordId,
            code: "MAPPING_VERSION_MISSING",
            severity: "error",
            fieldName: dataset.mapping.eventDateField,
            invalidValue: eventDate,
            message:
              "No approved dataset mapping is effective for this performance date",
          };
          invalidRows += 1;
          await recordIssues(runId, [issue], issues);
          continue;
        }

        const employee = await mapEmployee(
          dataset.datasetKey,
          externalIdentifier,
          eventDate!,
        );
        if (!employee) {
          const issue: ValidationIssue = {
            rawRecordId,
            code: "EMPLOYEE_UNMAPPED",
            severity: "error",
            fieldName: dataset.mapping.employeeIdentifierField,
            invalidValue: externalIdentifier,
            message:
              "External employee identifier is not mapped to one active HRMS employee",
          };
          invalidRows += 1;
          await recordIssues(runId, [issue], issues);
          await recordMappingException({
            runId,
            dataset,
            externalIdentifier,
            exceptionType: "employee_unmapped",
            detail: issue.message,
          });
          continue;
        }

        let processId = dataset.processId ?? employee.processId;
        let branchId = dataset.branchId ?? employee.branchId;
        if (externalProcess) {
          const process = await mapProcess(
            dataset.datasetKey,
            externalProcess,
            eventDate!,
          );
          if (!process && !processId) {
            const issue: ValidationIssue = {
              rawRecordId,
              code: "PROCESS_UNMAPPED",
              severity: "error",
              fieldName: dataset.mapping.externalProcessField,
              invalidValue: externalProcess,
              message:
                "External process is not mapped to an HRMS process",
            };
            invalidRows += 1;
            await recordIssues(runId, [issue], issues);
            await recordMappingException({
              runId,
              dataset,
              externalIdentifier: externalProcess,
              exceptionType: "process_unmapped",
              detail: issue.message,
            });
            continue;
          }
          if (process) {
            processId = process.processId;
            branchId = process.branchId ?? branchId;
          }
        }

        if (!processId) {
          const issue: ValidationIssue = {
            rawRecordId,
            code: "PROCESS_CONTEXT_MISSING",
            severity: "error",
            fieldName: dataset.mapping.externalProcessField ?? null,
            invalidValue: externalProcess || null,
            message:
              "No effective HRMS process is available for this employee performance row",
          };
          invalidRows += 1;
          await recordIssues(runId, [issue], issues);
          continue;
        }

        const metricIssues: ValidationIssue[] = [];
        const rowFacts: Array<{
          fact: NormalisedMetricFact;
          aggregation: PerformanceAggregation;
        }> = [];

        for (const binding of dataset.mapping.metrics) {
          const metricCode = text(binding.metricCode).toUpperCase();
          const metric = metrics.get(metricCode);
          if (!metric) {
            const issue: ValidationIssue = {
              rawRecordId,
              code: "METRIC_UNMAPPED",
              severity: "error",
              invalidValue: metricCode,
              message: `Metric ${metricCode} is not active in KPI master`,
            };
            metricIssues.push(issue);
            await recordMappingException({
              runId,
              dataset,
              externalIdentifier: metricCode,
              exceptionType: "metric_unmapped",
              detail: issue.message,
            });
            continue;
          }

          const value = numberOrNull(field(row, binding.valueField));
          const numerator = numberOrNull(field(row, binding.numeratorField));
          const denominator = numberOrNull(field(row, binding.denominatorField));
          const aggregation = binding.aggregation ?? metric.aggregation;
          const ratioMultiplier = Number(binding.ratioMultiplier ?? 100);
          const derived =
            aggregation === "ratio" &&
            numerator !== null &&
            denominator !== null &&
            denominator > 0
              ? (numerator / denominator) * ratioMultiplier
              : value;

          if (derived === null) {
            metricIssues.push({
              rawRecordId,
              code: "INVALID_METRIC_VALUE",
              severity: "error",
              fieldName:
                binding.valueField ?? binding.numeratorField ?? metricCode,
              invalidValue: field(row, binding.valueField),
              message: `No valid numeric value is available for ${metricCode}`,
            });
            continue;
          }

          rowFacts.push({
            aggregation,
            fact: {
              employeeId: employee.employeeId,
              metricId: metric.id,
              metricCode,
              scoreDate: eventDate!,
              mappingVersionId,
              actualValue: derived,
              numeratorValue: numerator,
              denominatorValue: denominator,
              calculationMultiplier:
                aggregation === "ratio" ? ratioMultiplier : null,
              sourceEventTimestamp,
              sourceRecordCount:
                numberOrNull(field(row, binding.sourceRecordCountField)) ?? 1,
              sourceRecordKey:
                text(field(row, dataset.mapping.sourceRecordKeyField)) ||
                rowHash(row),
              rawRecordId,
              processIdAtEvent: processId,
              branchIdAtEvent: branchId,
            },
          });
        }

        if (metricIssues.length || !rowFacts.length) {
          invalidRows += 1;
          if (!metricIssues.length) {
            metricIssues.push({
              rawRecordId,
              code: "NO_PUBLISHABLE_METRICS",
              severity: "error",
              message: "No publishable metric was generated for this row",
            });
          }
          await recordIssues(runId, metricIssues, issues);
          continue;
        }

        for (const rowFact of rowFacts) {
          addFact(accumulator, rowFact.fact, rowFact.aggregation);
        }
        mappedRows += 1;
      }

      const facts = finalFacts(accumulator, dataset.mapping.metrics);
      await saveReconciliation(
        runId,
        "SOURCE_TO_STAGING_ROWS",
        sourceRows,
        stagedRows,
      );
      await saveReconciliation(
        runId,
        "STAGING_TO_CLASSIFIED_ROWS",
        stagedRows,
        mappedRows + invalidRows,
      );

      if (input.mode === "publish") {
        const allowPartial = configFlag(dataset, "allowPartialPublication");
        const allowEmpty = configFlag(dataset, "allowEmptyPublication");

        if (invalidRows > 0 && !allowPartial) {
          throw publicationBlockedError(
            `Publication blocked because ${invalidRows} source row(s) failed validation or mapping`,
          );
        }
        if ((sourceRows === 0 || facts.length === 0) && !allowEmpty) {
          throw publicationBlockedError(
            "Publication blocked because the source produced no publishable facts. Enable allowEmptyPublication only for an intentional data withdrawal.",
          );
        }

        publishedFacts = await publishPerformanceFacts({
          dataset,
          runId,
          requestedBy: input.requestedBy ?? null,
          windowFrom: input.from,
          windowTo: input.to,
          facts,
        });
        await saveReconciliation(
          runId,
          "AGGREGATED_TO_PUBLISHED_FACTS",
          facts.length,
          publishedFacts,
        );
      }

      const status =
        input.mode === "publish" ? "published" : "preview_complete";
      await updateRun(runId, {
        status,
        sourceRows,
        stagedRows,
        mappedRows,
        invalidRows,
        publishedFacts,
        errors,
      });

      if (input.mode === "publish") {
        await db.execute(
          `INSERT INTO performance_ingestion_checkpoint
             (dataset_id, checkpoint_value, last_successful_run_id)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE
             checkpoint_value = VALUES(checkpoint_value),
             last_successful_run_id = VALUES(last_successful_run_id),
             updated_at = NOW()`,
          [dataset.id, input.to, runId],
        );
      }

      return {
        runId,
        mode: input.mode,
        status,
        sourceRows,
        stagedRows,
        mappedRows,
        invalidRows,
        publishedFacts,
        errors,
        issues: issues.slice(0, 200),
        sample,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      await updateRun(runId, {
        status: "failed",
        sourceRows,
        stagedRows,
        mappedRows,
        invalidRows,
        publishedFacts,
        errors,
      });
      throw error;
    }
  },
};
