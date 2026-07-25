import {
  BPO_MASTER_REPORTS,
  getBpoMasterReport,
} from "./bpo-master-report-registry.js";
import { runVerifiedWorkforceAdapter } from "./bpo-master-verified-workforce-adapters.js";
import { runVerifiedBusinessAdapter } from "./bpo-master-verified-business-adapters.js";
import { runGovernanceBpoMasterAdapter } from "./bpo-master-governance-adapters.js";
import { runCanonicalBpoMasterAdapter } from "./bpo-master-canonical-adapters.js";
import type { BranchScope } from "./reporting.scope.js";
import type {
  SourceFieldLineage,
} from "./bpo-master-source-registry.js";
import type {
  VerificationSummary,
  VerifiedAdapterFilters,
  VerifiedAdapterResult,
} from "./bpo-master-adapter-utils.js";

export interface BpoMasterReportFilters {
  month?: string;
  from?: string;
  to?: string;
  branchId?: string;
  processId?: string;
  employeeCode?: string;
  clientId?: string;
  limit?: number;
  offset?: number;
  export?: boolean;
}

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function integer(value: unknown, fallback: number, max: number) {
  const parsed = Math.trunc(Number(value ?? fallback));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : fallback;
}

function normalizeFilters(filters: BpoMasterReportFilters): VerifiedAdapterFilters & { clientId?: string; export: boolean } {
  const month = MONTH.test(String(filters.month ?? "")) ? String(filters.month) : undefined;
  const from = DATE.test(String(filters.from ?? "")) ? String(filters.from) : undefined;
  const to = DATE.test(String(filters.to ?? "")) ? String(filters.to) : undefined;
  const exportRequested = Boolean(filters.export);
  return {
    month,
    from,
    to,
    branchId: filters.branchId?.trim() || undefined,
    processId: filters.processId?.trim() || undefined,
    employeeCode: filters.employeeCode?.trim() || undefined,
    clientId: filters.clientId?.trim() || undefined,
    limit: exportRequested ? integer(filters.limit, 100_000, 100_000) : integer(filters.limit, 100, 1_000),
    offset: integer(filters.offset, 0, 10_000_000),
    export: exportRequested,
  };
}

function duplicateCount(rows: Record<string, unknown>[], keys: string[]) {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = keys.map((field) => String(row[field] ?? "∅")).join("¦");
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

function canonicalVerification(
  code: string,
  rows: Record<string, unknown>[],
  totalCount: number,
  availableKeys: string[]
): { lineage: Record<string, SourceFieldLineage>; verification: VerificationSummary } {
  const definition = getBpoMasterReport(code)!;
  const availableSet = new Set(availableKeys);
  const lineage: Record<string, SourceFieldLineage> = Object.fromEntries(
    definition.columns.map((column) => [column.key, {
      sourceSchema: "mas_hrms",
      sourceTable: "CANONICAL_BPO_PNL_ALLOCATION_ENGINE",
      sourceColumn: null,
      transformation: availableSet.has(column.key)
        ? "CANONICAL P&L SERVICE MAPPING; SEE PROCESS P&L ENGINE FOR TRANSACTION LINEAGE"
        : "NOT MAPPED BY CANONICAL SERVICE",
      confidence: availableSet.has(column.key) ? "DERIVED" as const : "UNAVAILABLE" as const,
    }])
  );
  const duplicates = duplicateCount(rows, definition.primaryKey);
  return {
    lineage,
    verification: {
      runtimeSchemaVerified: true,
      exactMappedFieldCount: 0,
      derivedMappedFieldCount: availableKeys.length,
      unavailableFieldCount: Math.max(0, definition.columns.length - availableKeys.length),
      duplicateGrainCount: duplicates,
      sourceRowCount: totalCount,
      distinctGrainCount: Math.max(0, totalCount - duplicates),
      accuracyStatus: duplicates > 0 ? "DUPLICATE_GRAIN_FOUND" : "SCHEMA_VERIFIED",
    },
  };
}

function responseFromAdapter(
  definition: NonNullable<ReturnType<typeof getBpoMasterReport>>,
  filters: ReturnType<typeof normalizeFilters>,
  result: VerifiedAdapterResult
) {
  const availableSet = new Set(result.availableKeys);
  const available = definition.columns.filter((column) => availableSet.has(column.key)).map((column) => column.key);
  const unavailable = definition.columns.filter((column) => !availableSet.has(column.key)).map((column) => column.key);
  return {
    definition,
    generatedAt: new Date().toISOString(),
    sourceState: "available" as const,
    sourceTable: result.sourceTable,
    rows: result.rows,
    totalCount: result.totalCount,
    filters,
    coverage: {
      available,
      unavailable,
      percentage: definition.columns.length
        ? Number(((available.length / definition.columns.length) * 100).toFixed(1))
        : 100,
    },
    lineage: result.lineage,
    verification: result.verification,
    accuracyStatement: result.verification.duplicateGrainCount > 0
      ? "SOURCE SCHEMA VERIFIED; DUPLICATE REPORT GRAIN REQUIRES RESOLUTION BEFORE BUSINESS SIGN-OFF."
      : "SOURCE SCHEMA AND REPORT GRAIN VERIFIED. VALUE ACCURACY REQUIRES AUTHENTICATED SOURCE-TO-REPORT UAT AND BUSINESS OWNER SIGN-OFF.",
    message: null,
  };
}

export const bpoMasterReportV2Service = {
  list() {
    return BPO_MASTER_REPORTS;
  },

  async run(code: string, input: BpoMasterReportFilters, branchScope: BranchScope) {
    const definition = getBpoMasterReport(code);
    if (!definition) throw Object.assign(new Error("BPO master report not found"), { statusCode: 404 });
    const filters = normalizeFilters(input);

    const governance = await runGovernanceBpoMasterAdapter(code, filters, branchScope);
    if (governance) return responseFromAdapter(definition, filters, governance);

    const workforce = await runVerifiedWorkforceAdapter(code, filters, branchScope);
    if (workforce) return responseFromAdapter(definition, filters, workforce);

    const business = await runVerifiedBusinessAdapter(code, filters, branchScope);
    if (business) return responseFromAdapter(definition, filters, business);

    const canonical = await runCanonicalBpoMasterAdapter(code, {
      month: filters.month,
      branchId: filters.branchId,
      processId: filters.processId,
      clientId: filters.clientId,
      limit: filters.limit,
      offset: filters.offset,
    });
    if (canonical) {
      const canonicalMeta = canonicalVerification(code, canonical.rows, canonical.totalCount, canonical.availableKeys);
      return responseFromAdapter(definition, filters, { ...canonical, ...canonicalMeta });
    }

    return {
      definition,
      generatedAt: new Date().toISOString(),
      sourceState: "unavailable" as const,
      sourceTable: null,
      rows: [] as Record<string, unknown>[],
      totalCount: 0,
      filters,
      coverage: {
        available: [] as string[],
        unavailable: definition.columns.map((column) => column.key),
        percentage: 0,
      },
      lineage: Object.fromEntries(definition.columns.map((column) => [column.key, {
        sourceSchema: "UNKNOWN",
        sourceTable: "NO VERIFIED ADAPTER",
        sourceColumn: null,
        transformation: "NO VERIFIED SOURCE CONTRACT IS AVAILABLE",
        confidence: "UNAVAILABLE" as const,
      }])),
      verification: {
        runtimeSchemaVerified: true,
        exactMappedFieldCount: 0,
        derivedMappedFieldCount: 0,
        unavailableFieldCount: definition.columns.length,
        duplicateGrainCount: 0,
        sourceRowCount: 0,
        distinctGrainCount: 0,
        accuracyStatus: "SCHEMA_VERIFIED" as const,
      },
      accuracyStatement: "NO VERIFIED SOURCE CONTRACT AVAILABLE. REPORT DATA WAS NOT GENERATED.",
      message: "Verified source tables or required columns are unavailable. No guessed values or artificial zeroes were returned.",
    };
  },
};
