import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type PerformanceCertificationCheck = {
  code: string;
  label: string;
  passed: boolean;
  expected?: number | string | null;
  actual?: number | string | null;
  detail: string;
};

export type PerformanceRunCertification = {
  runId: string;
  datasetId: string;
  datasetKey: string;
  datasetName: string;
  mode: string;
  status: string;
  certified: boolean;
  checkedAt: string;
  checks: PerformanceCertificationCheck[];
  counts: {
    sourceRows: number;
    stagedRows: number;
    rawRows: number;
    mappedRows: number;
    invalidRows: number;
    invalidRawRows: number;
    validationIssues: number;
    publishedFacts: number;
    lineageRows: number;
    currentLineageRows: number;
    canonicalRows: number;
    reconciliationRows: number;
    failedReconciliations: number;
  };
};

type CertificationInput = {
  runId: string;
  datasetId: string;
  datasetKey: string;
  datasetName: string;
  mode: string;
  status: string;
  sourceRows: number;
  stagedRows: number;
  rawRows: number;
  mappedRows: number;
  invalidRows: number;
  invalidRawRows: number;
  validationIssues: number;
  publishedFacts: number;
  lineageRows: number;
  currentLineageRows: number;
  canonicalRows: number;
  reconciliationRows: number;
  failedReconciliations: number;
  publicationStatus: string | null;
  publicationFactCount: number | null;
};

function check(input: Omit<PerformanceCertificationCheck, "passed"> & { passed: boolean }): PerformanceCertificationCheck {
  return input;
}

export function evaluatePerformanceRunCertification(
  input: CertificationInput,
): PerformanceRunCertification {
  const terminal = ["preview_complete", "published"].includes(input.status);
  const published = input.mode === "publish";
  const checks: PerformanceCertificationCheck[] = [
    check({
      code: "RUN_TERMINAL",
      label: "Run completed successfully",
      passed: terminal,
      expected: "preview_complete or published",
      actual: input.status,
      detail: terminal ? "The run reached a successful terminal state." : "The run is failed, queued, or still running.",
    }),
    check({
      code: "SOURCE_TO_RAW",
      label: "Source rows equal raw staged records",
      passed: input.sourceRows === input.rawRows,
      expected: input.sourceRows,
      actual: input.rawRows,
      detail: "Every extracted source row must have exactly one raw evidence record.",
    }),
    check({
      code: "STAGING_TO_RAW",
      label: "Staged count equals raw evidence",
      passed: input.stagedRows === input.rawRows,
      expected: input.stagedRows,
      actual: input.rawRows,
      detail: "The persisted run counters and raw evidence table must reconcile.",
    }),
    check({
      code: "ROW_CLASSIFICATION",
      label: "Mapped and invalid rows classify every staged row",
      passed: input.mappedRows + input.invalidRows === input.stagedRows,
      expected: input.stagedRows,
      actual: input.mappedRows + input.invalidRows,
      detail: "No staged row may disappear between validation and classification.",
    }),
    check({
      code: "INVALID_ROW_EVIDENCE",
      label: "Invalid row counter has validation evidence",
      passed: input.invalidRows === input.invalidRawRows,
      expected: input.invalidRows,
      actual: input.invalidRawRows,
      detail: "Every invalid row must be represented by at least one error-level validation record.",
    }),
    check({
      code: "NO_INVALID_ROWS",
      label: "No unresolved invalid rows",
      passed: input.invalidRows === 0,
      expected: 0,
      actual: input.invalidRows,
      detail: input.invalidRows === 0
        ? "All rows passed identity, process, date, and metric validation."
        : "Resolve validation and mapping exceptions before certification.",
    }),
    check({
      code: "RECONCILIATIONS_PRESENT",
      label: "Reconciliation controls executed",
      passed: input.reconciliationRows >= (published ? 3 : 2),
      expected: published ? 3 : 2,
      actual: input.reconciliationRows,
      detail: "Preview requires source/staging and staging/classification controls; publish also requires fact publication reconciliation.",
    }),
    check({
      code: "RECONCILIATIONS_PASSED",
      label: "All reconciliation controls passed",
      passed: input.failedReconciliations === 0,
      expected: 0,
      actual: input.failedReconciliations,
      detail: "Any failed reconciliation blocks certification.",
    }),
  ];

  if (published) {
    checks.push(
      check({
        code: "PUBLICATION_BATCH",
        label: "Publication batch completed",
        passed: input.publicationStatus === "published",
        expected: "published",
        actual: input.publicationStatus,
        detail: "The transactional publication batch must be committed.",
      }),
      check({
        code: "PUBLISHED_TO_BATCH",
        label: "Run and publication batch fact counts match",
        passed: input.publicationFactCount === input.publishedFacts,
        expected: input.publishedFacts,
        actual: input.publicationFactCount,
        detail: "The run counter must match the committed publication batch.",
      }),
      check({
        code: "PUBLISHED_TO_LINEAGE",
        label: "Published facts have lineage rows",
        passed: input.lineageRows === input.publishedFacts,
        expected: input.publishedFacts,
        actual: input.lineageRows,
        detail: "Every published fact must retain source-specific lineage evidence.",
      }),
      check({
        code: "PUBLISHED_TO_CANONICAL",
        label: "Published facts reached canonical KPI facts",
        passed: input.canonicalRows === input.publishedFacts,
        expected: input.publishedFacts,
        actual: input.canonicalRows,
        detail: "Each aggregated fact must be visible in the canonical daily KPI table for this run.",
      }),
    );
  }

  return {
    runId: input.runId,
    datasetId: input.datasetId,
    datasetKey: input.datasetKey,
    datasetName: input.datasetName,
    mode: input.mode,
    status: input.status,
    certified: checks.every((item) => item.passed),
    checkedAt: new Date().toISOString(),
    checks,
    counts: {
      sourceRows: input.sourceRows,
      stagedRows: input.stagedRows,
      rawRows: input.rawRows,
      mappedRows: input.mappedRows,
      invalidRows: input.invalidRows,
      invalidRawRows: input.invalidRawRows,
      validationIssues: input.validationIssues,
      publishedFacts: input.publishedFacts,
      lineageRows: input.lineageRows,
      currentLineageRows: input.currentLineageRows,
      canonicalRows: input.canonicalRows,
      reconciliationRows: input.reconciliationRows,
      failedReconciliations: input.failedReconciliations,
    },
  };
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function verifyPerformanceRun(runId: string): Promise<PerformanceRunCertification> {
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id,
            r.dataset_id,
            r.run_mode,
            r.status,
            r.source_row_count,
            r.staged_row_count,
            r.mapped_row_count,
            r.invalid_row_count,
            r.published_fact_count,
            d.dataset_key,
            d.dataset_name
       FROM performance_ingestion_run r
       JOIN performance_source_dataset d ON d.id = r.dataset_id
      WHERE r.id = ?
      LIMIT 1`,
    [runId],
  );
  const run = runRows[0];
  if (!run) {
    throw Object.assign(new Error("Performance ingestion run not found"), { statusCode: 404 });
  }

  const [[raw], [validation], [lineage], [canonical], [reconciliation], [publication]] = await Promise.all([
    db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS raw_rows FROM performance_raw_record WHERE run_id = ?",
      [runId],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS validation_issues,
              COUNT(DISTINCT CASE WHEN severity = 'error' THEN raw_record_id END) AS invalid_raw_rows
         FROM performance_validation_result
        WHERE run_id = ?`,
      [runId],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS lineage_rows,
              SUM(CASE WHEN lineage_status = 'current' THEN 1 ELSE 0 END) AS current_lineage_rows
         FROM performance_fact_lineage
        WHERE run_id = ?`,
      [runId],
    ),
    db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS canonical_rows FROM kpi_daily_actual WHERE integration_run_id = ?",
      [runId],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS reconciliation_rows,
              SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) AS failed_reconciliations
         FROM performance_reconciliation_result
        WHERE run_id = ?`,
      [runId],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT status, published_fact_count
         FROM performance_publication_batch
        WHERE run_id = ?
        LIMIT 1`,
      [runId],
    ),
  ]);

  return evaluatePerformanceRunCertification({
    runId: String(run.id),
    datasetId: String(run.dataset_id),
    datasetKey: String(run.dataset_key),
    datasetName: String(run.dataset_name),
    mode: String(run.run_mode),
    status: String(run.status),
    sourceRows: number(run.source_row_count),
    stagedRows: number(run.staged_row_count),
    rawRows: number(raw[0]?.raw_rows),
    mappedRows: number(run.mapped_row_count),
    invalidRows: number(run.invalid_row_count),
    invalidRawRows: number(validation[0]?.invalid_raw_rows),
    validationIssues: number(validation[0]?.validation_issues),
    publishedFacts: number(run.published_fact_count),
    lineageRows: number(lineage[0]?.lineage_rows),
    currentLineageRows: number(lineage[0]?.current_lineage_rows),
    canonicalRows: number(canonical[0]?.canonical_rows),
    reconciliationRows: number(reconciliation[0]?.reconciliation_rows),
    failedReconciliations: number(reconciliation[0]?.failed_reconciliations),
    publicationStatus: publication[0]?.status ? String(publication[0].status) : null,
    publicationFactCount: publication[0]?.published_fact_count === undefined
      ? null
      : number(publication[0].published_fact_count),
  });
}
