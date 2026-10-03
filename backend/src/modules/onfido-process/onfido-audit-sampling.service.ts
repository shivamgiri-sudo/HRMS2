/**
 * Audit Sampling — DOC Check (internal only) and POA.
 *
 * Tasks Received  : onfido_doc_raw (DOC) / onfido_poa_raw (POA), by client x document type x task type.
 * Audits / Errors : onfido_doc_quality_raw (DOC Check internal QC, total_audits / total_error) and
 *                   onfido_poa_quality_raw (POA internal QC, error_count + no_error_count / error_count).
 * The quality tables carry no client / document-type / task-type columns, so each audit row is
 * attributed through onfido_doc_raw / onfido_poa_raw on the shared ims_url (the same dedupe key on
 * every Onfido upload), falling back to the same fields kept in the quality row's raw_data JSON
 * (headers "IMS Client Name" / "Docupedia - Full Document Name" / "Task Type" for DOC and
 * "Client - IMS IMS Client Name" / "Document Classification Document Type Full Name" for POA).
 * External DOC audit data (onfido_doc_external_audit_raw) is deliberately NOT read here.
 */
import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import {
  buildTaskTypeRows,
  mergePeriods,
  mergeSampling,
  normKey,
  splitUntraceableDoc,
  type AuditCountRow,
  type AuditPeriodRow,
  type AuditSamplingRow,
  type TaskCountRow,
  type TaskTypeSamplingRow,
} from "./onfido-audit-sampling.pure.js";
import {
  bucketExpr,
  bucketLabel,
  DOC_TASK_TYPE_LABEL_EXPR,
  readFilters,
  type TrendGranularity,
} from "./onfido-process-dashboard.service.js";

export interface AuditSamplingResult {
  rows: AuditSamplingRow[];
  /** DOC Check task-type-wise analysis (valid source task types only). */
  taskTypes: TaskTypeSamplingRow[];
  /** Daily / weekly / monthly summary per queue. */
  periods: AuditPeriodRow[];
  /** DOC Check audits that could not be traced to a source task type (excluded from the tables). */
  untracedDocAudits: number;
}

export interface AuditSamplingFilters {
  from?: string;
  to?: string;
  tlName?: string;
  amName?: string;
  queue?: string;
  clientName?: string;
  documentType?: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const jsonOf = (alias: string, key: string) =>
  `NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${alias}.raw_data, '$."${key}"'))), '')`;

function tlAm(
  alias: string,
  tlName?: string,
  amName?: string,
): { clause: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (tlName) {
    parts.push(`${alias}.tl_name = ?`);
    params.push(tlName);
  }
  if (amName) {
    parts.push(`${alias}.am_name = ?`);
    params.push(amName);
  }
  return { clause: parts.length ? `AND ${parts.join(" AND ")}` : "", params };
}

async function poaRows(
  f: { from: string; to: string },
  tlName?: string,
  amName?: string,
): Promise<AuditSamplingRow[]> {
  const pool = await getOnfidoPool();
  const rawScope = tlAm("r", tlName, amName);
  const qScope = tlAm("q", tlName, amName);
  const [taskRows] = await pool.query<RowDataPacket[]>(
    `SELECT NULLIF(TRIM(r.ims_client_name), '') AS client, NULLIF(TRIM(r.document_name), '') AS doc, COUNT(*) AS n
       FROM onfido_poa_raw r
      WHERE r.report_completed_date BETWEEN ? AND ? ${rawScope.clause}
      GROUP BY client, doc`,
    [f.from, f.to, ...rawScope.params],
  );
  const [auditRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(r.ims_client_name), ''), ${jsonOf("q", "Client - IMS IMS Client Name")}) AS client,
            COALESCE(NULLIF(TRIM(r.document_name), ''), ${jsonOf("q", "Document Classification Document Type Full Name")}) AS doc,
            COALESCE(SUM(q.error_count), 0) + COALESCE(SUM(q.no_error_count), 0) AS audits,
            COALESCE(SUM(q.error_count), 0) AS errors
       FROM onfido_poa_quality_raw q
       LEFT JOIN onfido_poa_raw r ON r.ims_url = q.ims_url
      WHERE q.report_completed_date BETWEEN ? AND ? ${qScope.clause}
      GROUP BY client, doc`,
    [f.from, f.to, ...qScope.params],
  );
  const tasks: TaskCountRow[] = taskRows.map((r) => ({
    client: str(r.client),
    documentType: str(r.doc),
    taskType: "POA",
    tasks: num(r.n),
  }));
  const audits: AuditCountRow[] = auditRows.map((r) => ({
    client: str(r.client),
    documentType: str(r.doc),
    taskType: "POA",
    audits: num(r.audits),
    errors: num(r.errors),
  }));
  return mergeSampling("POA", tasks, audits);
}

async function docRows(
  f: { from: string; to: string },
  tlName?: string,
  amName?: string,
): Promise<AuditSamplingRow[]> {
  const pool = await getOnfidoPool();
  const rawScope = tlAm("r", tlName, amName);
  const qScope = tlAm("q", tlName, amName);
  const [taskRows] = await pool.query<RowDataPacket[]>(
    `SELECT NULLIF(TRIM(ims_client_name), '') AS client, NULLIF(TRIM(document_name), '') AS doc,
            ${DOC_TASK_TYPE_LABEL_EXPR} AS task_type, COUNT(*) AS n
       FROM onfido_doc_raw r
      WHERE report_date BETWEEN ? AND ? ${rawScope.clause}
      GROUP BY client, doc, task_type`,
    [f.from, f.to, ...rawScope.params],
  );
  const [auditRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(r.ims_client_name), ''), ${jsonOf("q", "IMS Client Name")}) AS client,
            COALESCE(NULLIF(TRIM(r.document_name), ''), ${jsonOf("q", "Docupedia - Full Document Name")}) AS doc,
            COALESCE(NULLIF(TRIM(r.doc_task_type_old), ''), ${jsonOf("r", "Task Type Short Name")}, ${jsonOf("q", "Task Type")}) AS task_type,
            COALESCE(SUM(q.total_audits), 0) AS audits, COALESCE(SUM(q.total_error), 0) AS errors
       FROM onfido_doc_quality_raw q
       LEFT JOIN onfido_doc_raw r ON r.ims_url = q.ims_url
      WHERE q.task_complete_date BETWEEN ? AND ? ${qScope.clause}
      GROUP BY client, doc, task_type`,
    [f.from, f.to, ...qScope.params],
  );
  return mergeSampling(
    "DOC",
    taskRows.map((r) => ({ client: str(r.client), documentType: str(r.doc), taskType: str(r.task_type), tasks: num(r.n) })),
    auditRows.map((r) => ({
      client: str(r.client),
      documentType: str(r.doc),
      taskType: str(r.task_type),
      audits: num(r.audits),
      errors: num(r.errors),
    })),
  );
}

async function periodRows(
  queue: "DOC" | "POA",
  f: { from: string; to: string },
  granularity: TrendGranularity,
  tlName?: string,
  amName?: string,
): Promise<AuditPeriodRow[]> {
  const pool = await getOnfidoPool();
  const s = tlAm("t", tlName, amName);
  const taskCol = queue === "DOC" ? "t.report_date" : "t.report_completed_date";
  const taskTable = queue === "DOC" ? "onfido_doc_raw" : "onfido_poa_raw";
  const auditCol = queue === "DOC" ? "t.task_complete_date" : "t.report_completed_date";
  const auditTable = queue === "DOC" ? "onfido_doc_quality_raw" : "onfido_poa_quality_raw";
  const auditSums =
    queue === "DOC"
      ? "COALESCE(SUM(t.total_audits),0) AS audits, COALESCE(SUM(t.total_error),0) AS errors"
      : "COALESCE(SUM(t.error_count),0) + COALESCE(SUM(t.no_error_count),0) AS audits, COALESCE(SUM(t.error_count),0) AS errors";
  const [taskRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr(taskCol, granularity)} AS bucket, COUNT(*) AS n
       FROM ${taskTable} t WHERE ${taskCol} BETWEEN ? AND ? ${s.clause} GROUP BY bucket`,
    [f.from, f.to, ...s.params],
  );
  const [auditRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr(auditCol, granularity)} AS bucket, ${auditSums}
       FROM ${auditTable} t WHERE ${auditCol} BETWEEN ? AND ? ${s.clause} GROUP BY bucket`,
    [f.from, f.to, ...s.params],
  );
  return mergePeriods(
    queue,
    taskRows.map((r) => ({ period: bucketLabel(r.bucket, granularity), tasks: num(r.n) })),
    auditRows.map((r) => ({ period: bucketLabel(r.bucket, granularity), audits: num(r.audits), errors: num(r.errors) })),
  );
}

export async function getAuditSamplingReport(
  raw: AuditSamplingFilters,
  granularity: TrendGranularity,
): Promise<AuditSamplingResult> {
  const f = readFilters(raw);
  const wantDoc = !raw.queue || raw.queue === "DOC";
  const wantPoa = !raw.queue || raw.queue === "POA";
  const [doc, poa, docPeriods, poaPeriods] = await Promise.all([
    wantDoc ? docRows(f, raw.tlName, raw.amName) : Promise.resolve([] as AuditSamplingRow[]),
    wantPoa ? poaRows(f, raw.tlName, raw.amName) : Promise.resolve([] as AuditSamplingRow[]),
    wantDoc ? periodRows("DOC", f, granularity, raw.tlName, raw.amName) : Promise.resolve([] as AuditPeriodRow[]),
    wantPoa ? periodRows("POA", f, granularity, raw.tlName, raw.amName) : Promise.resolve([] as AuditPeriodRow[]),
  ]);
  const { kept: docKept, droppedAudits } = splitUntraceableDoc(doc);
  const clientKey = raw.clientName ? normKey(raw.clientName) : null;
  const docTypeKey = raw.documentType ? normKey(raw.documentType) : null;
  const match = (r: AuditSamplingRow) =>
    (!clientKey || normKey(r.client) === clientKey) && (!docTypeKey || normKey(r.documentType) === docTypeKey);
  const docFiltered = docKept.filter(match);
  return {
    rows: [...docFiltered, ...poa.filter(match)],
    taskTypes: buildTaskTypeRows(docFiltered),
    periods: [...docPeriods, ...poaPeriods],
    untracedDocAudits: droppedAudits,
  };
}
