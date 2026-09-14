import {
  BPO_MASTER_REPORTS as BASE_BPO_MASTER_REPORTS,
  type BpoMasterColumn,
  type BpoMasterFormat,
  type BpoMasterReportDefinition,
} from "./bpo-master-report-catalog.js";
import { BPO_MASTER_REPORT_EXTENSIONS } from "./bpo-master-report-extensions.js";

export type { BpoMasterColumn, BpoMasterFormat, BpoMasterReportDefinition };

export const BPO_MASTER_REPORTS: BpoMasterReportDefinition[] = [
  ...BASE_BPO_MASTER_REPORTS,
  ...BPO_MASTER_REPORT_EXTENSIONS,
];

export function getBpoMasterReport(code: string) {
  return BPO_MASTER_REPORTS.find((report) => report.code === code);
}

export function assertBpoMasterReportRegistry() {
  const codes = new Set<string>();
  for (const report of BPO_MASTER_REPORTS) {
    if (codes.has(report.code)) throw new Error(`Duplicate BPO master report code: ${report.code}`);
    codes.add(report.code);
    if (!report.columns.some((column) => column.key === "EMPLOYEE_CODE")) {
      throw new Error(`${report.code} is missing mandatory EMPLOYEE_CODE`);
    }
    if (!report.columns.some((column) => column.key === "REPORT_DATE")) {
      throw new Error(`${report.code} is missing mandatory REPORT_DATE`);
    }
    if (report.columns.length < 45) {
      throw new Error(`${report.code} is too shallow: ${report.columns.length} columns`);
    }
    if (report.sourceDomains.length < 7) {
      throw new Error(`${report.code} must cover at least seven source domains`);
    }
    const keys = new Set<string>();
    for (const column of report.columns) {
      if (keys.has(column.key)) throw new Error(`${report.code} contains duplicate header ${column.key}`);
      keys.add(column.key);
      if (column.key !== column.key.toUpperCase() || column.label !== column.label.toUpperCase()) {
        throw new Error(`${report.code} contains non-uppercase header ${column.key}`);
      }
    }
  }
}
