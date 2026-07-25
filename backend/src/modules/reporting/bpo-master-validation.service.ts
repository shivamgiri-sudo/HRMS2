import { BPO_MASTER_REPORTS } from "./bpo-master-report-registry.js";
import { bpoMasterReportV2Service, type BpoMasterReportFilters } from "./bpo-master-report-v2.service.js";
import type { BranchScope } from "./reporting.scope.js";

export interface MasterReportValidationResult {
  reportCode: string;
  reportName: string;
  sourceState: "available" | "unavailable" | "failed";
  validationStatus: "PASS" | "WARNING" | "FAIL";
  sourceTable: string | null;
  sourceRowCount: number;
  distinctGrainCount: number;
  duplicateGrainCount: number;
  coveragePercentage: number;
  exactMappedFieldCount: number;
  derivedMappedFieldCount: number;
  unavailableFieldCount: number;
  runtimeSchemaVerified: boolean;
  sourceAccuracyStatus: string;
  uatStatus: "PENDING";
  error: string | null;
}

export async function validateAllBpoMasterReports(
  filters: BpoMasterReportFilters,
  branchScope: BranchScope
) {
  const results: MasterReportValidationResult[] = [];
  for (const report of BPO_MASTER_REPORTS) {
    try {
      const result = await bpoMasterReportV2Service.run(report.code, {
        ...filters,
        limit: 1,
        offset: 0,
        export: false,
      }, branchScope);
      const verification = result.verification;
      const sourceState = result.sourceState;
      const hasDuplicate = verification.duplicateGrainCount > 0;
      const noSource = sourceState === "unavailable";
      const noRows = verification.sourceRowCount === 0;
      const validationStatus: MasterReportValidationResult["validationStatus"] = noSource || hasDuplicate
        ? "FAIL"
        : noRows || verification.unavailableFieldCount > 0
          ? "WARNING"
          : "PASS";
      results.push({
        reportCode: report.code,
        reportName: report.name,
        sourceState,
        validationStatus,
        sourceTable: result.sourceTable,
        sourceRowCount: verification.sourceRowCount,
        distinctGrainCount: verification.distinctGrainCount,
        duplicateGrainCount: verification.duplicateGrainCount,
        coveragePercentage: result.coverage.percentage,
        exactMappedFieldCount: verification.exactMappedFieldCount,
        derivedMappedFieldCount: verification.derivedMappedFieldCount,
        unavailableFieldCount: verification.unavailableFieldCount,
        runtimeSchemaVerified: verification.runtimeSchemaVerified,
        sourceAccuracyStatus: noSource
          ? "NO VERIFIED SOURCE"
          : hasDuplicate
            ? "DUPLICATE GRAIN"
            : noRows
              ? "SCHEMA VALID; NO MATCHING DATA FOR FILTER"
              : "SCHEMA/GRAIN VALID; VALUE RECONCILIATION PENDING",
        uatStatus: "PENDING",
        error: null,
      });
    } catch (error) {
      results.push({
        reportCode: report.code,
        reportName: report.name,
        sourceState: "failed",
        validationStatus: "FAIL",
        sourceTable: null,
        sourceRowCount: 0,
        distinctGrainCount: 0,
        duplicateGrainCount: 0,
        coveragePercentage: 0,
        exactMappedFieldCount: 0,
        derivedMappedFieldCount: 0,
        unavailableFieldCount: report.columns.length,
        runtimeSchemaVerified: false,
        sourceAccuracyStatus: "RUNTIME QUERY FAILED",
        uatStatus: "PENDING",
        error: error instanceof Error ? error.message : "Unknown report validation error",
      });
    }
  }

  const summary = {
    totalReports: results.length,
    passed: results.filter((item) => item.validationStatus === "PASS").length,
    warnings: results.filter((item) => item.validationStatus === "WARNING").length,
    failed: results.filter((item) => item.validationStatus === "FAIL").length,
    sourceAvailable: results.filter((item) => item.sourceState === "available").length,
    duplicateGrainReports: results.filter((item) => item.duplicateGrainCount > 0).length,
    runtimeQueryFailures: results.filter((item) => item.sourceState === "failed").length,
    allRuntimeChecksPassed: results.every((item) => item.validationStatus !== "FAIL"),
    valueAccuracyCertified: false,
    certificationReason: "Value accuracy requires authenticated source totals, report totals and business-owner sign-off for the selected reporting period.",
  };

  return {
    generatedAt: new Date().toISOString(),
    filters,
    summary,
    results,
    mandatoryNextStep: "Run this validation on staging/production-like data, reconcile totals and complete business-owner UAT before marking the report suite certified.",
  };
}
