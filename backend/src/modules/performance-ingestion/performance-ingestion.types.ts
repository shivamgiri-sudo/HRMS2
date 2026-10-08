export type PerformanceSourceType = "mysql" | "mssql" | "excel" | "csv" | "google_sheet";
export type PerformanceRunMode = "preview" | "publish";
export type PerformanceAggregation = "sum" | "average" | "weighted_average" | "ratio" | "latest";

export interface DatasetMetricBinding {
  metricCode: string;
  valueField?: string;
  numeratorField?: string;
  denominatorField?: string;
  aggregation?: PerformanceAggregation;
  ratioMultiplier?: number;
  sourceRecordCountField?: string;
}

export interface DatasetMapping {
  employeeIdentifierField: string;
  employeeIdentifierType?: string;
  eventDateField: string;
  sourceRecordKeyField?: string;
  sourceEventTimestampField?: string;
  externalProcessField?: string;
  branchField?: string;
  metrics: DatasetMetricBinding[];
}

export interface DatabaseDatasetConfig {
  queryMysql?: string;
  queryMssql?: string;
  queryParams?: Array<"from" | "to" | "checkpoint">;
  maxRows?: number;
  checkpointField?: string;
}

export interface GoogleSheetDatasetConfig {
  csvUrl: string;
  maxRows?: number;
}

export type DatasetConfig = DatabaseDatasetConfig | GoogleSheetDatasetConfig | Record<string, unknown>;

export interface PerformanceDataset {
  id: string;
  datasetKey: string;
  datasetName: string;
  sourceType: PerformanceSourceType;
  connectorKey: string | null;
  sourceEntity: string | null;
  processId: string | null;
  branchId: string | null;
  timezoneName: string;
  config: DatasetConfig;
  mapping: DatasetMapping;
  approvalStatus: string;
  activeStatus: boolean;
}

export interface SourceRow {
  [key: string]: unknown;
}

export interface NormalisedMetricFact {
  employeeId: string;
  metricId: string;
  metricCode: string;
  scoreDate: string;
  mappingVersionId?: string | null;
  actualValue: number;
  numeratorValue: number | null;
  denominatorValue: number | null;
  calculationMultiplier: number | null;
  sourceEventTimestamp: string | null;
  sourceRecordCount: number | null;
  sourceRecordKey: string | null;
  rawRecordId: number | null;
  processIdAtEvent: string | null;
  branchIdAtEvent: string | null;
}

export interface ValidationIssue {
  rawRecordId?: number | null;
  code: string;
  severity: "warning" | "error";
  fieldName?: string | null;
  invalidValue?: unknown;
  message: string;
}

export interface IngestionRunResult {
  runId: string;
  mode: PerformanceRunMode;
  status: "preview_complete" | "published" | "failed";
  sourceRows: number;
  stagedRows: number;
  mappedRows: number;
  invalidRows: number;
  publishedFacts: number;
  errors: string[];
  issues: ValidationIssue[];
  sample: SourceRow[];
}
