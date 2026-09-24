/**
 * Task-type ("stage") quality columns for the Overview and Analyst Performance formats.
 *
 * Internal QC (onfido_doc_quality_raw) only extracted total_audits / total_error into real
 * columns; every per-stage NO/YES pair the export carries lives in the raw_data JSON under
 * the file's own header. In the export a "Yes" column is the error count for that stage and
 * a "No" column is the clean count (the same convention the external audit file documents in
 * onfido-report-configs.ts), so stage error % = Yes / (Yes + No).
 *
 * The sheets name the stages the way the WFM team does; the export names them by field:
 *   EWYS         <- "Raw.Ext."      (raw extraction)
 *   EWYS Address <- "Raw Add.Ext."  (raw additional extraction)
 *   Labelling    <- "Lab EWYS"
 * That mapping is an inference from the column names, called out in the report to WFM.
 */

export interface InternalStage { key: string; label: string; okHeader: string; errHeader: string }

export const INTERNAL_STAGES: readonly InternalStage[] = [
  { key: "classification", label: "Classification", okHeader: "Class. NO", errHeader: "Class. Yes" },
  { key: "extraction", label: "Extraction", okHeader: "Ext. NO", errHeader: "Ext. Yes" },
  { key: "ewys", label: "EWYS", okHeader: "Raw.Ext. No", errHeader: "Raw.Ext. Yes" },
  { key: "ewysAddress", label: "EWYS Address", okHeader: "Raw Add.Ext. No", errHeader: "Raw Add.Ext. Yes" },
  { key: "labelling", label: "Labelling", okHeader: "Lab EWYS NO", errHeader: "Lab EWYS YES" },
  { key: "consistency", label: "Consistency", okHeader: "Consistency NO", errHeader: "Consistency Yes" },
  { key: "validation", label: "Validation", okHeader: "Ext_Valid NO", errHeader: "Ext_Valid YES" },
  { key: "iqFail", label: "IQ Fail", okHeader: "Ext IQ. NO", errHeader: "Ext IQ. Yes" },
];

/** SUM-able numeric read of one JSON header from raw_data; blank / non-numeric reads as 0. */
export function jsonNumberExpr(header: string): string {
  if (/['"\\]/.test(header)) throw new Error(`Unsafe JSON header: ${header}`);
  return `COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."${header}"')), '') AS DECIMAL(14,2)), 0)`;
}

/** SELECT fragment: `SUM(...) AS s_<key>_err, SUM(...) AS s_<key>_ok` for the given stages. */
export function internalStageSelect(stages: readonly InternalStage[]): string {
  return stages
    .map((s) => `SUM(${jsonNumberExpr(s.errHeader)}) AS s_${s.key}_err, SUM(${jsonNumberExpr(s.okHeader)}) AS s_${s.key}_ok`)
    .join(", ");
}

export interface ExternalStage { key: string; label: string; flagColumn: string; totalColumn: string }

/** External audit (onfido_doc_external_audit_raw) stage flag + audited-total columns. */
export const EXTERNAL_STAGES: readonly ExternalStage[] = [
  { key: "classification", label: "Classification", flagColumn: "classification_flag", totalColumn: "classification_total" },
  { key: "extraction", label: "Extraction", flagColumn: "extraction_flag", totalColumn: "extraction_total" },
  { key: "ewys", label: "EWYS", flagColumn: "raw_extraction_flag", totalColumn: "raw_extraction_total" },
  { key: "ewysAddress", label: "EWYS Address", flagColumn: "add_extraction_flag", totalColumn: "add_extraction_total" },
];

export function externalStageSelect(): string {
  return EXTERNAL_STAGES
    .map((s) => `COALESCE(SUM(${s.flagColumn}), 0) AS x_${s.key}_err, COALESCE(SUM(${s.totalColumn}), 0) AS x_${s.key}_tot`)
    .join(", ");
}

export interface RateCell { errors: number; audits: number; errorPct: number | null }

export function rateCell(errors: number, audits: number): RateCell {
  return { errors, audits, errorPct: audits > 0 ? Math.round((errors / audits) * 1000) / 10 : null };
}
