import { describe, expect, it } from "vitest";
import { evaluatePerformanceRunCertification } from "../performance-manual-upload-verification.service.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    datasetId: "dataset-1",
    datasetKey: "manual_quality",
    datasetName: "Manual quality",
    mode: "publish",
    status: "published",
    sourceRows: 10,
    stagedRows: 10,
    rawRows: 10,
    mappedRows: 10,
    invalidRows: 0,
    invalidRawRows: 0,
    validationIssues: 0,
    publishedFacts: 10,
    lineageRows: 10,
    currentLineageRows: 10,
    canonicalRows: 10,
    reconciliationRows: 3,
    failedReconciliations: 0,
    publicationStatus: "published",
    publicationFactCount: 10,
    ...overrides,
  };
}

describe("performance manual-upload certification", () => {
  it("certifies a fully reconciled publication", () => {
    const report = evaluatePerformanceRunCertification(input());
    expect(report.certified).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it("fails when a staged row disappears from classification", () => {
    const report = evaluatePerformanceRunCertification(input({ mappedRows: 8 }));
    expect(report.certified).toBe(false);
    expect(report.checks.find((check) => check.code === "ROW_CLASSIFICATION")?.passed)
      .toBe(false);
  });

  it("fails when invalid rows have no validation evidence", () => {
    const report = evaluatePerformanceRunCertification(input({
      mappedRows: 9,
      invalidRows: 1,
      invalidRawRows: 0,
    }));
    expect(report.certified).toBe(false);
    expect(report.checks.find((check) => check.code === "INVALID_ROW_EVIDENCE")?.passed)
      .toBe(false);
  });

  it("fails a publication with missing canonical facts", () => {
    const report = evaluatePerformanceRunCertification(input({ canonicalRows: 9 }));
    expect(report.certified).toBe(false);
    expect(report.checks.find((check) => check.code === "PUBLISHED_TO_CANONICAL")?.passed)
      .toBe(false);
  });

  it("certifies a clean preview without publication checks", () => {
    const report = evaluatePerformanceRunCertification(input({
      mode: "preview",
      status: "preview_complete",
      publishedFacts: 0,
      lineageRows: 0,
      currentLineageRows: 0,
      canonicalRows: 0,
      reconciliationRows: 2,
      publicationStatus: null,
      publicationFactCount: null,
    }));
    expect(report.certified).toBe(true);
    expect(report.checks.some((check) => check.code === "PUBLICATION_BATCH")).toBe(false);
  });
});
