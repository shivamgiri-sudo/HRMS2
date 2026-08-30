//
// Orchestrates Phase 3's pure parser and DB-backed validation helpers into one per-file preview
// pass (requirements.md Requirement 17, design.md's "Validation order": mapping check -> parse
// -> employee resolution -> duplicate check). No writes — this is the dry-run half of criterion
// 17.14's preview-then-commit flow; Task 3's commitUploadBatch() is the write half.

import {
  checkMappingCoversMandatoryFields,
  parseUploadRow,
} from './productivity-upload-parser.js';
import {
  resolveEmployeeIdByCode,
  isDuplicateContribution,
} from './productivity-upload-validation.service.js';

export interface PreviewAcceptedRow {
  rowNumber: number;
  employeeId: string;
  employeeCode: string;
  reportDate: string;
  loginMinutes: number;
  callsHandled?: number;
  ahtSeconds?: number;
  bioMinutes?: number;
  lunchMinutes?: number;
  qaMinutes?: number;
  trainingMinutes?: number;
}

export interface PreviewRejectedRow {
  rowNumber: number;
  employeeCode: string;
  reason: string;
}

export interface UploadPreviewResult {
  accepted: PreviewAcceptedRow[];
  rejected: PreviewRejectedRow[];
  mappingError?: { missingFields: string[] };
}

export async function buildUploadPreview(
  rawRows: Array<{ rowNumber: number; data: Record<string, string> }>,
  columnMappings: Record<string, string>,
  diallerSourceId: string,
): Promise<UploadPreviewResult> {
  const mappingCheck = checkMappingCoversMandatoryFields(columnMappings);
  if (!mappingCheck.ok) {
    return { accepted: [], rejected: [], mappingError: { missingFields: mappingCheck.missingFields } };
  }

  const accepted: PreviewAcceptedRow[] = [];
  const rejected: PreviewRejectedRow[] = [];

  for (const { rowNumber, data } of rawRows) {
    const parsed = parseUploadRow(data, columnMappings);
    if (!parsed.ok) {
      // employee_code may itself be the field that failed to parse (blank/whitespace) — best
      // effort to still name it in the rejection for the uploader's benefit, empty if unknown.
      const employeeCode = data[Object.keys(columnMappings).find(
        (h) => columnMappings[h] === 'employee_code',
      ) ?? ''] ?? '';
      rejected.push({ rowNumber, employeeCode, reason: parsed.reason });
      continue;
    }

    const employeeId = await resolveEmployeeIdByCode(parsed.row.employee_code);
    if (employeeId === null) {
      rejected.push({
        rowNumber,
        employeeCode: parsed.row.employee_code,
        reason: `employee code ${parsed.row.employee_code} does not resolve to any employee`,
      });
      continue;
    }

    const duplicate = await isDuplicateContribution(diallerSourceId, employeeId, parsed.row.report_date);
    if (duplicate.isDuplicate) {
      rejected.push({
        rowNumber,
        employeeCode: parsed.row.employee_code,
        reason: `duplicate submission: already accepted in batch ${duplicate.priorBatchId}`,
      });
      continue;
    }

    accepted.push({
      rowNumber,
      employeeId,
      employeeCode: parsed.row.employee_code,
      reportDate: parsed.row.report_date,
      loginMinutes: parsed.row.login_minutes,
      callsHandled: parsed.row.calls_handled,
      ahtSeconds: parsed.row.aht_seconds,
      bioMinutes: parsed.row.bio_minutes,
      lunchMinutes: parsed.row.lunch_minutes,
      qaMinutes: parsed.row.qa_minutes,
      trainingMinutes: parsed.row.training_minutes,
    });
  }

  return { accepted, rejected };
}
