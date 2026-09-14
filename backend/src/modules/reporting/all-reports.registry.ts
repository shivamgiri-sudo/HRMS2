/**
 * Unified report code registry across all report families.
 *
 * ALL_ACTIVE_REPORTS is the single source of truth for coverage tests —
 * not any single catalog file. The suite catalog alone has 137 codes; BPO
 * master and module-specific codes are additional.
 *
 * Use this registry for:
 *   - Coverage tests (every active code has exactly one executor/adapter)
 *   - Worker dispatch family detection (isBpoMasterCode, isIdentityBuilderCode)
 *   - Deduplication guards
 */
import { REPORT_CATALOG } from "./report-catalog.js";
import { BPO_MASTER_REPORTS } from "./bpo-master-report-registry.js";
import { EXECUTOR_MAP } from "./executors/index.js";

// ── Normalised catalog entry shared by all families ──────────────────────────
export interface UnifiedReportEntry {
  code: string;
  name: string;
  family: "suite" | "bpo-master" | "identity-builder" | "module";
  category: string;
  availabilityStatus: string;
}

// ── Suite family (137 codes from report-catalog.ts) ──────────────────────────
const SUITE_ENTRIES: UnifiedReportEntry[] = REPORT_CATALOG.map(r => ({
  code:               r.code,
  name:               r.name,
  family:             "suite",
  category:           r.category,
  availabilityStatus: (r as any).availabilityStatus ?? "under_validation",
}));

// ── BPO master family (from bpo-master-report-registry.ts) ───────────────────
const BPO_ENTRIES: UnifiedReportEntry[] = BPO_MASTER_REPORTS.map(r => ({
  code:               r.code,
  name:               r.name,
  family:             "bpo-master",
  category:           r.domain,
  availabilityStatus: "under_validation",
}));

// ── Identity builder codes (subset of suite, but dispatched differently) ──────
const IDENTITY_BUILDER_CODES = new Set([
  "identity-source-snapshot",
  "identity-mapping-exceptions",
]);

// ── Module-specific codes (break reports, compliance timeline, etc.) ──────────
// These live in the suite catalog but are also accessible via legacy module routes.
// Listed here for documentation — they appear in SUITE_ENTRIES already.
const MODULE_SPECIFIC_CODES = new Set([
  "break-daily-summary",
  "payroll-cost-summary",
  "payroll-variance",
]);

// ── Combined active registry (no deprecated/disabled) ────────────────────────
const DEPRECATED_STATUSES = new Set(["deprecated", "disabled"]);

export const ALL_ACTIVE_REPORTS: UnifiedReportEntry[] = [
  ...SUITE_ENTRIES,
  ...BPO_ENTRIES,
  // Filter out dupes (BPO codes that also appear in suite catalog)
].filter((entry, index, arr) => {
  const firstIdx = arr.findIndex(e => e.code === entry.code);
  return firstIdx === index; // keep first occurrence only
}).filter(entry => !DEPRECATED_STATUSES.has(entry.availabilityStatus));

// ── Family classification helpers ────────────────────────────────────────────

export function isBpoMasterCode(code: string): boolean {
  return BPO_ENTRIES.some(e => e.code === code);
}

export function isIdentityBuilderCode(code: string): boolean {
  return IDENTITY_BUILDER_CODES.has(code);
}

export function isModuleSpecificCode(code: string): boolean {
  return MODULE_SPECIFIC_CODES.has(code);
}

// ── Coverage validation (run during CI / startup check) ──────────────────────
export interface CoverageResult {
  passed: boolean;
  errors: string[];
  stats: {
    totalActive:     number;
    suiteCount:      number;
    bpoCount:        number;
    identityCount:   number;
    withExecutor:    number;
    withoutExecutor: number;
  };
}

export function validateExecutorCoverage(): CoverageResult {
  const errors: string[] = [];
  const seen  = new Set<string>();
  let withExecutor = 0;

  for (const entry of ALL_ACTIVE_REPORTS) {
    // Duplicate registration check
    if (seen.has(entry.code)) {
      errors.push(`Duplicate code in ALL_ACTIVE_REPORTS: ${entry.code}`);
      continue;
    }
    seen.add(entry.code);

    // Every code must have a dispatch path
    const hasDispatch =
      isBpoMasterCode(entry.code)           ||
      isIdentityBuilderCode(entry.code)     ||
      EXECUTOR_MAP[entry.code] !== undefined;

    if (hasDispatch) {
      withExecutor++;
    } else {
      errors.push(`No executor/adapter registered for active code: ${entry.code}`);
    }
  }

  // Reverse check: every executor code must have a catalog entry
  for (const code of Object.keys(EXECUTOR_MAP)) {
    if (!seen.has(code)) {
      errors.push(`Executor exists for undocumented/inactive code: ${code}`);
    }
  }

  const suiteCount    = ALL_ACTIVE_REPORTS.filter(e => e.family === "suite").length;
  const bpoCount      = ALL_ACTIVE_REPORTS.filter(e => e.family === "bpo-master").length;
  const identityCount = Array.from(IDENTITY_BUILDER_CODES).length;

  return {
    passed: errors.length === 0,
    errors,
    stats: {
      totalActive:     ALL_ACTIVE_REPORTS.length,
      suiteCount,
      bpoCount,
      identityCount,
      withExecutor,
      withoutExecutor: ALL_ACTIVE_REPORTS.length - withExecutor,
    },
  };
}
