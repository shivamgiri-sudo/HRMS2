import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type {
  DatasetMapping,
  PerformanceDataset,
  SourceRow,
} from "./performance-ingestion.types.js";

const EXCEL_EXTENSIONS = new Set([".xlsx", ".xls"]);
const CSV_EXTENSIONS = new Set([".csv"]);

export type ManualUploadInspection = {
  fileName: string | null;
  fileHash: string;
  fileSize: number;
  sheetName: string;
  rowCount: number;
  maxRows: number;
  columns: string[];
  requiredColumns: string[];
  missingColumns: string[];
  duplicateColumns: string[];
  warnings: string[];
  rows: SourceRow[];
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function extension(fileName?: string | null): string {
  const raw = text(fileName).toLowerCase();
  const dot = raw.lastIndexOf(".");
  return dot >= 0 ? raw.slice(dot) : "";
}

function normaliseColumn(value: string): string {
  return value.trim().toLowerCase();
}

function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function isOleCompoundFile(buffer: Buffer): boolean {
  return buffer.length >= 8
    && buffer[0] === 0xd0
    && buffer[1] === 0xcf
    && buffer[2] === 0x11
    && buffer[3] === 0xe0;
}

function containsBinaryNull(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0x00);
}

export function performanceDatasetMaxRows(dataset: PerformanceDataset): number {
  const configured = Number((dataset.config as { maxRows?: number }).maxRows ?? 10_000);
  if (!Number.isFinite(configured)) return 10_000;
  return Math.max(1, Math.min(100_000, Math.trunc(configured)));
}

export function requiredColumnsForMapping(mapping: DatasetMapping): string[] {
  const values = [
    mapping.employeeIdentifierField,
    mapping.eventDateField,
    mapping.sourceRecordKeyField,
    mapping.sourceEventTimestampField,
    mapping.externalProcessField,
    mapping.branchField,
    ...mapping.metrics.flatMap((metric) => [
      metric.valueField,
      metric.numeratorField,
      metric.denominatorField,
      metric.sourceRecordCountField,
    ]),
  ];

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const column = text(value);
    if (!column) continue;
    const key = normaliseColumn(column);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(column);
  }
  return ordered;
}

function assertFileKind(
  dataset: PerformanceDataset,
  buffer: Buffer,
  fileName?: string | null,
): void {
  const ext = extension(fileName);
  const zip = isZip(buffer);
  const ole = isOleCompoundFile(buffer);

  if (dataset.sourceType === "csv") {
    if (ext && !CSV_EXTENSIONS.has(ext)) {
      throw Object.assign(new Error("CSV datasets only accept .csv files"), { statusCode: 400 });
    }
    if (zip || ole || containsBinaryNull(buffer)) {
      throw Object.assign(new Error("The selected file is not a plain-text CSV file"), { statusCode: 400 });
    }
    return;
  }

  if (dataset.sourceType === "excel") {
    if (ext && !EXCEL_EXTENSIONS.has(ext)) {
      throw Object.assign(new Error("Excel datasets only accept .xlsx or .xls files"), { statusCode: 400 });
    }
    if (!zip && !ole) {
      throw Object.assign(new Error("The selected file is not a valid Excel workbook"), { statusCode: 400 });
    }
    return;
  }

  throw Object.assign(
    new Error("Manual upload inspection is only available for Excel and CSV datasets"),
    { statusCode: 409 },
  );
}

function workbookSheetName(dataset: PerformanceDataset, workbook: XLSX.WorkBook): string {
  const configured = text((dataset.config as { sheetName?: string }).sheetName);
  if (configured) {
    const exact = workbook.SheetNames.find((name) => name === configured);
    if (!exact) {
      throw Object.assign(
        new Error(`Configured worksheet ${configured} was not found in the workbook`),
        { statusCode: 400 },
      );
    }
    return exact;
  }

  const first = workbook.SheetNames[0];
  if (!first) {
    throw Object.assign(new Error("The uploaded workbook has no worksheets"), { statusCode: 400 });
  }
  return first;
}

function workbookColumns(sheet: XLSX.WorkSheet): string[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false,
  });
  const header = Array.isArray(matrix[0]) ? matrix[0].map(text) : [];
  let lastPopulated = header.length - 1;
  while (lastPopulated >= 0 && !header[lastPopulated]) lastPopulated -= 1;
  const columns = header.slice(0, lastPopulated + 1);
  if (!columns.length) {
    throw Object.assign(new Error("The uploaded file has no header row"), { statusCode: 400 });
  }
  if (columns.some((column) => !column)) {
    throw Object.assign(
      new Error("The header row contains a blank column name between populated columns"),
      { statusCode: 400 },
    );
  }
  return columns;
}

function duplicateColumns(columns: string[]): string[] {
  const firstByKey = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const column of columns) {
    const key = normaliseColumn(column);
    if (firstByKey.has(key)) {
      duplicates.add(firstByKey.get(key) ?? column);
    } else {
      firstByKey.set(key, column);
    }
  }
  return [...duplicates];
}

export function assertRequiredColumns(
  dataset: Pick<PerformanceDataset, "mapping">,
  columns: string[],
): { requiredColumns: string[]; missingColumns: string[]; duplicateColumns: string[] } {
  const requiredColumns = requiredColumnsForMapping(dataset.mapping);
  const available = new Set(columns.map(normaliseColumn));
  const missingColumns = requiredColumns.filter((column) => !available.has(normaliseColumn(column)));
  const duplicates = duplicateColumns(columns);

  if (duplicates.length) {
    throw Object.assign(
      new Error(`Duplicate header columns are not allowed: ${duplicates.join(", ")}`),
      { statusCode: 400, details: { duplicateColumns: duplicates } },
    );
  }
  if (missingColumns.length) {
    throw Object.assign(
      new Error(`Required upload columns are missing: ${missingColumns.join(", ")}`),
      { statusCode: 400, details: { missingColumns, requiredColumns, columns } },
    );
  }

  return { requiredColumns, missingColumns, duplicateColumns: duplicates };
}

export function assertSourceRowColumns(
  dataset: Pick<PerformanceDataset, "mapping">,
  rows: SourceRow[],
): void {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  assertRequiredColumns(dataset, columns);
}

export function assertSourceRowLimit(rowCount: number, maxRows: number): void {
  if (rowCount > maxRows) {
    throw Object.assign(
      new Error(`Source returned ${rowCount} rows, exceeding the configured maximum of ${maxRows}`),
      { statusCode: 413, details: { rowCount, maxRows } },
    );
  }
}

export function inspectManualUploadFile(
  dataset: PerformanceDataset,
  buffer: Buffer,
  fileName?: string | null,
): ManualUploadInspection {
  if (!buffer.length) {
    throw Object.assign(new Error("The uploaded file is empty"), { statusCode: 400 });
  }
  assertFileKind(dataset, buffer, fileName);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  } catch {
    throw Object.assign(new Error("The uploaded file could not be parsed as a workbook or CSV"), {
      statusCode: 400,
    });
  }

  const sheetName = workbookSheetName(dataset, workbook);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw Object.assign(new Error(`Worksheet ${sheetName} could not be read`), { statusCode: 400 });
  }

  const columns = workbookColumns(sheet);
  const headerCheck = assertRequiredColumns(dataset, columns);
  const rows = XLSX.utils.sheet_to_json<SourceRow>(sheet, {
    defval: null,
    raw: true,
    blankrows: false,
  });
  const maxRows = performanceDatasetMaxRows(dataset);
  assertSourceRowLimit(rows.length, maxRows);

  return {
    fileName: fileName ? text(fileName) : null,
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    fileSize: buffer.length,
    sheetName,
    rowCount: rows.length,
    maxRows,
    columns,
    requiredColumns: headerCheck.requiredColumns,
    missingColumns: headerCheck.missingColumns,
    duplicateColumns: headerCheck.duplicateColumns,
    warnings: rows.length ? [] : ["The file contains headers but no data rows"],
    rows,
  };
}

function safeCsvCell(value: unknown): string {
  let raw = String(value ?? "");
  if (/^[=+\-@]/.test(raw)) raw = `'${raw}`;
  if (/[",\r\n]/.test(raw)) raw = `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(safeCsvCell).join(","))
    .join("\r\n") + "\r\n";
}

export function buildManualUploadTemplate(dataset: PerformanceDataset): string {
  return buildCsv(requiredColumnsForMapping(dataset.mapping), []);
}
