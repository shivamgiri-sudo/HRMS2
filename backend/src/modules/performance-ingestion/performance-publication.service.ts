import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type {
  NormalisedMetricFact,
  PerformanceDataset,
} from "./performance-ingestion.types.js";

type FactKey = Pick<
  NormalisedMetricFact,
  "employeeId" | "metricId" | "scoreDate" | "processIdAtEvent" | "branchIdAtEvent"
>;

type PreviousFactRow = RowDataPacket & {
  employee_id: string;
  metric_id: string;
  score_date: string;
  process_id_at_event: string | null;
  branch_id_at_event: string | null;
};

type CurrentLineageRow = RowDataPacket & {
  source_dataset_id: string | null;
  dataset_key: string | null;
  actual_value: number | string | null;
  numerator_value: number | string | null;
  denominator_value: number | string | null;
  source_record_count: number | string | null;
  process_id_at_event: string | null;
  branch_id_at_event: string | null;
  aggregation_method: string | null;
  unit: string | null;
  created_at: string;
};

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueNonBlank(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function factKey(fact: FactKey): string {
  return `${fact.employeeId}|${fact.metricId}|${fact.scoreDate}`;
}

function canonicalValue(rows: CurrentLineageRow[]): {
  actualValue: number;
  numeratorValue: number | null;
  denominatorValue: number | null;
  sourceRecordCount: number;
} {
  const method = String(rows[0]?.aggregation_method ?? "average").toLowerCase();
  const numerator = rows.reduce((sum, row) => sum + numeric(row.numerator_value), 0);
  const denominator = rows.reduce((sum, row) => sum + numeric(row.denominator_value), 0);
  const sourceRecordCount = rows.reduce(
    (sum, row) => sum + Math.max(0, numeric(row.source_record_count)),
    0,
  );

  let actualValue = 0;
  if (method === "sum") {
    actualValue = rows.reduce((sum, row) => sum + numeric(row.actual_value), 0);
  } else if (method === "ratio" && denominator > 0) {
    const multiplier = String(rows[0]?.unit ?? "").toLowerCase() === "percent" ? 100 : 1;
    actualValue = (numerator / denominator) * multiplier;
  } else if (method === "latest") {
    const latest = [...rows].sort((left, right) =>
      String(left.created_at).localeCompare(String(right.created_at))).at(-1);
    actualValue = numeric(latest?.actual_value);
  } else {
    const weightedRows = rows.filter((row) => numeric(row.source_record_count) > 0);
    actualValue = weightedRows.length
      ? weightedRows.reduce(
          (sum, row) => sum + numeric(row.actual_value) * numeric(row.source_record_count),
          0,
        ) / weightedRows.reduce((sum, row) => sum + numeric(row.source_record_count), 0)
      : rows.reduce((sum, row) => sum + numeric(row.actual_value), 0) / Math.max(rows.length, 1);
  }

  return {
    actualValue: Math.round(actualValue * 1_000_000) / 1_000_000,
    numeratorValue: method === "ratio" ? numerator : null,
    denominatorValue: method === "ratio" ? denominator : null,
    sourceRecordCount,
  };
}

async function currentLineage(
  connection: PoolConnection,
  fact: FactKey,
): Promise<CurrentLineageRow[]> {
  const [rows] = await connection.execute<CurrentLineageRow[]>(
    `SELECT
       pfl.source_dataset_id,
       psd.dataset_key,
       pfl.actual_value,
       pfl.numerator_value,
       pfl.denominator_value,
       pfl.source_record_count,
       pfl.process_id_at_event,
       pfl.branch_id_at_event,
       kmm.aggregation_method,
       kmm.unit,
       pfl.created_at
     FROM performance_fact_lineage pfl
     JOIN kpi_metric_master kmm ON kmm.id = pfl.metric_id
     LEFT JOIN performance_source_dataset psd ON psd.id = pfl.source_dataset_id
     WHERE pfl.employee_id = ?
       AND pfl.metric_id = ?
       AND pfl.score_date = ?
       AND pfl.lineage_status = 'current'
     ORDER BY pfl.created_at ASC, pfl.id ASC`,
    [fact.employeeId, fact.metricId, fact.scoreDate],
  );
  return rows;
}

async function removeCanonicalFact(
  connection: PoolConnection,
  fact: FactKey,
): Promise<void> {
  await connection.execute(
    `DELETE FROM kpi_daily_actual
      WHERE employee_id = ?
        AND metric_id = ?
        AND score_date = ?
        AND publication_batch_id IS NOT NULL`,
    [fact.employeeId, fact.metricId, fact.scoreDate],
  );
}

async function writeCanonicalFact(input: {
  connection: PoolConnection;
  dataset: PerformanceDataset;
  runId: string;
  mappingVersionId: string | null;
  publicationBatchId: string;
  fact: FactKey;
}): Promise<void> {
  const rows = await currentLineage(input.connection, input.fact);
  if (!rows.length) {
    await removeCanonicalFact(input.connection, input.fact);
    return;
  }

  const canonical = canonicalValue(rows);
  const datasetIds = uniqueNonBlank(rows.map((row) => row.source_dataset_id));
  const datasetKeys = uniqueNonBlank(rows.map((row) => row.dataset_key));
  const processIds = uniqueNonBlank(rows.map((row) => row.process_id_at_event));
  const branchIds = uniqueNonBlank(rows.map((row) => row.branch_id_at_event));
  const sourceSystem = datasetKeys.length === 1
    ? datasetKeys[0].slice(0, 50)
    : `performance_multi_source:${datasetKeys.length}`.slice(0, 50);
  const soleDatasetIsCurrent = datasetIds.length === 1 && datasetIds[0] === input.dataset.id;

  await input.connection.execute(
    `INSERT INTO kpi_daily_actual
       (employee_id, metric_id, score_date, actual_value, source,
        numerator_value, denominator_value, source_system, source_dataset_id,
        source_record_key, mapping_version_id, publication_batch_id,
        process_id_at_event, branch_id_at_event, source_record_count,
        formula_version_id, integration_run_id, computed_at, published_at)
     VALUES (?, ?, ?, ?, 'calculated', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?,
       (SELECT id FROM kpi_formula_version
         WHERE metric_code = (SELECT metric_code FROM kpi_metric_master WHERE id = ?)
           AND status = 'active'
         ORDER BY version_no DESC LIMIT 1),
       ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       actual_value = VALUES(actual_value),
       source = VALUES(source),
       numerator_value = VALUES(numerator_value),
       denominator_value = VALUES(denominator_value),
       source_system = VALUES(source_system),
       source_dataset_id = VALUES(source_dataset_id),
       source_record_key = NULL,
       mapping_version_id = VALUES(mapping_version_id),
       publication_batch_id = VALUES(publication_batch_id),
       process_id_at_event = VALUES(process_id_at_event),
       branch_id_at_event = VALUES(branch_id_at_event),
       source_record_count = VALUES(source_record_count),
       formula_version_id = VALUES(formula_version_id),
       integration_run_id = VALUES(integration_run_id),
       computed_at = VALUES(computed_at),
       published_at = VALUES(published_at)`,
    [
      input.fact.employeeId,
      input.fact.metricId,
      input.fact.scoreDate,
      canonical.actualValue,
      canonical.numeratorValue,
      canonical.denominatorValue,
      sourceSystem,
      datasetIds.length === 1 ? datasetIds[0] : null,
      soleDatasetIsCurrent ? input.mappingVersionId : null,
      input.publicationBatchId,
      processIds.length === 1 ? processIds[0] : input.fact.processIdAtEvent,
      branchIds.length === 1 ? branchIds[0] : input.fact.branchIdAtEvent,
      canonical.sourceRecordCount,
      input.fact.metricId,
      input.runId,
    ],
  );
}

export async function publishPerformanceFacts(input: {
  dataset: PerformanceDataset;
  runId: string;
  mappingVersionId: string | null;
  requestedBy: string | null;
  windowFrom: string;
  windowTo: string;
  facts: NormalisedMetricFact[];
}): Promise<number> {
  const publicationBatchId = randomUUID();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO performance_publication_batch (id, run_id, status, published_by)
       VALUES (?, ?, 'publishing', ?)`,
      [publicationBatchId, input.runId, input.requestedBy],
    );

    const [previousRows] = await connection.execute<PreviousFactRow[]>(
      `SELECT DISTINCT
         employee_id,
         metric_id,
         DATE_FORMAT(score_date, '%Y-%m-%d') AS score_date,
         process_id_at_event,
         branch_id_at_event
       FROM performance_fact_lineage
       WHERE source_dataset_id = ?
         AND score_date BETWEEN ? AND ?
         AND lineage_status = 'current'`,
      [input.dataset.id, input.windowFrom, input.windowTo],
    );

    const affected = new Map<string, FactKey>();
    for (const row of previousRows) {
      const key: FactKey = {
        employeeId: String(row.employee_id),
        metricId: String(row.metric_id),
        scoreDate: String(row.score_date),
        processIdAtEvent: row.process_id_at_event ? String(row.process_id_at_event) : null,
        branchIdAtEvent: row.branch_id_at_event ? String(row.branch_id_at_event) : null,
      };
      affected.set(factKey(key), key);
    }

    const [superseded] = await connection.execute<ResultSetHeader>(
      `UPDATE performance_fact_lineage
          SET lineage_status = 'superseded'
        WHERE source_dataset_id = ?
          AND score_date BETWEEN ? AND ?
          AND lineage_status = 'current'`,
      [input.dataset.id, input.windowFrom, input.windowTo],
    );

    for (const fact of input.facts) {
      await connection.execute(
        `INSERT INTO performance_fact_lineage
           (publication_batch_id, run_id, source_dataset_id, raw_record_id,
            employee_id, metric_id, score_date, source_record_key,
            actual_value, numerator_value, denominator_value, source_record_count,
            process_id_at_event, branch_id_at_event)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicationBatchId,
          input.runId,
          input.dataset.id,
          fact.rawRecordId,
          fact.employeeId,
          fact.metricId,
          fact.scoreDate,
          fact.sourceRecordKey,
          fact.actualValue,
          fact.numeratorValue,
          fact.denominatorValue,
          fact.sourceRecordCount,
          fact.processIdAtEvent,
          fact.branchIdAtEvent,
        ],
      );
      affected.set(factKey(fact), fact);
    }

    for (const fact of affected.values()) {
      await writeCanonicalFact({
        connection,
        dataset: input.dataset,
        runId: input.runId,
        mappingVersionId: input.mappingVersionId,
        publicationBatchId,
        fact,
      });
    }

    await connection.execute(
      `UPDATE performance_publication_batch
          SET status = 'published', published_fact_count = ?, superseded_fact_count = ?, published_at = NOW()
        WHERE id = ?`,
      [input.facts.length, Number(superseded.affectedRows ?? 0), publicationBatchId],
    );
    await connection.commit();
    return input.facts.length;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
