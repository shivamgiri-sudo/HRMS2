export type PerformanceSourceType = "mysql" | "mssql" | "excel" | "csv" | "google_sheet";
export type PerformanceAggregation = "sum" | "average" | "ratio" | "latest";

export type PerformanceMetricBinding = {
  metricCode: string;
  valueField?: string;
  numeratorField?: string;
  denominatorField?: string;
  aggregation?: PerformanceAggregation;
  ratioMultiplier?: number;
  sourceRecordCountField?: string;
};

export type PerformanceDatasetMapping = {
  employeeIdentifierField: string;
  employeeIdentifierType?: string;
  eventDateField: string;
  sourceRecordKeyField?: string;
  externalProcessField?: string;
  branchField?: string;
  metrics: PerformanceMetricBinding[];
};

export type PerformanceDataset = {
  id: string;
  datasetKey: string;
  datasetName: string;
  sourceType: PerformanceSourceType;
  connectorKey: string | null;
  sourceEntity: string | null;
  processId: string | null;
  branchId: string | null;
  processName: string | null;
  branchName: string | null;
  timezoneName: string;
  config: Record<string, unknown>;
  mapping: PerformanceDatasetMapping;
  approvalStatus: string;
  activeStatus: boolean;
  mappingVersionCount: number;
  currentMappingVersion: number | null;
  currentEffectiveFrom: string | null;
};

export type PerformanceMappingVersion = {
  id: string;
  versionNo: number;
  mapping: PerformanceDatasetMapping;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
};

export type PerformanceDatasetDetail = {
  dataset: PerformanceDataset;
  mappingVersions: PerformanceMappingVersion[];
};

export type PerformanceRunResult = {
  runId: string;
  mode: "preview" | "publish";
  status: string;
  sourceRows: number;
  stagedRows: number;
  mappedRows: number;
  invalidRows: number;
  publishedFacts: number;
  issues: Array<{ code: string; message: string; invalidValue?: unknown }>;
};

export type PerformanceRunSummary = {
  id: string;
  mode: string;
  triggerType: string;
  status: string;
  windowFrom: string | null;
  windowTo: string | null;
  sourceFileName: string | null;
  sourceRows: number;
  stagedRows: number;
  mappedRows: number;
  invalidRows: number;
  publishedFacts: number;
  errorCount: number;
  errorSummary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type PaginatedPerformanceRuns = {
  rows: PerformanceRunSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type PerformanceRunDetail = {
  run: Record<string, unknown>;
  validations: Array<Record<string, unknown>>;
  reconciliations: Array<Record<string, unknown>>;
  mappingExceptions: Array<Record<string, unknown>>;
  publication: Record<string, unknown> | null;
};

export type PerformanceMappingException = {
  id: string;
  runId: string | null;
  datasetId: string;
  datasetName: string;
  sourceSystem: string;
  sourceEntity: string | null;
  externalIdentifier: string;
  exceptionType: string;
  detail: string;
  status: string;
  createdAt: string;
  updatedAt: string | null;
};

export type PaginatedMappingExceptions = {
  rows: PerformanceMappingException[];
  total: number;
  page: number;
  pageSize: number;
};

export type PerformanceSchedule = {
  enabled: boolean;
  cronExpression: string | null;
  timezone: string;
  scheduleLookbackDays: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  automaticSourceSupported: boolean;
};

export type PerformanceReferenceData = {
  employees: Array<{
    id: string;
    employeeCode: string;
    employeeName: string;
    processId: string | null;
    branchId: string | null;
    processName: string | null;
    branchName: string | null;
  }>;
  processes: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  metrics: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    direction: string;
    aggregation: string;
  }>;
};

export type PerformanceManualUploadSchema = {
  datasetId: string;
  datasetKey: string;
  datasetName: string;
  sourceType: "excel" | "csv";
  acceptedExtensions: string[];
  maximumFileBytes: number;
  maxRows: number;
  sheetName: string | null;
  requiredColumns: string[];
  mapping: PerformanceDatasetMapping;
};

export type PerformanceManualUploadPreflight = {
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
  sample: Array<Record<string, unknown>>;
};

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
  counts: Record<string, number>;
};
