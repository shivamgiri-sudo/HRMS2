import type { Request } from "express";
import { db } from "../../db/mysql.js";

export type OrgChartActionType = "view" | "export" | "search" | "node_detail" | "rebuild_cache" | "data_quality_check";

export interface AuditLogEntry {
  userId: string;
  employeeId: string | null;
  scopeType: string | null;
  scopeId: string | null;
  actionType: OrgChartActionType;
  filtersApplied?: Record<string, unknown>;
  searchQuery?: string;
  exportFormat?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log org chart access to audit table.
 */
export async function logOrgChartAccess(entry: AuditLogEntry): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO org_chart_access_log
       (user_id, employee_id, scope_type, scope_id, action_type, filters_applied, search_query, export_format, ip_address, user_agent, accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        entry.userId,
        entry.employeeId,
        entry.scopeType,
        entry.scopeId,
        entry.actionType,
        entry.filtersApplied ? JSON.stringify(entry.filtersApplied) : null,
        entry.searchQuery ?? null,
        entry.exportFormat ?? null,
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
      ]
    );
  } catch (err) {
    // Non-blocking: audit failure should not break the feature
    console.error("[org-chart.audit] Failed to log access:", err);
  }
}

/**
 * Extract audit metadata from Express request.
 */
export function extractAuditMetadata(req: Request): Pick<AuditLogEntry, "ipAddress" | "userAgent"> {
  const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";
  const userAgent = req.headers["user-agent"] || "unknown";
  return { ipAddress, userAgent };
}

/**
 * Log org chart view.
 */
export async function logChartView(
  userId: string,
  employeeId: string | null,
  scopeType: string,
  scopeId: string | null,
  filters: Record<string, unknown>,
  req: Request
): Promise<void> {
  const { ipAddress, userAgent } = extractAuditMetadata(req);
  await logOrgChartAccess({
    userId,
    employeeId,
    scopeType,
    scopeId,
    actionType: "view",
    filtersApplied: filters,
    ipAddress,
    userAgent,
  });
}

/**
 * Log org chart export.
 */
export async function logChartExport(
  userId: string,
  employeeId: string | null,
  scopeType: string,
  scopeId: string | null,
  exportFormat: string,
  filters: Record<string, unknown>,
  req: Request
): Promise<void> {
  const { ipAddress, userAgent } = extractAuditMetadata(req);
  await logOrgChartAccess({
    userId,
    employeeId,
    scopeType,
    scopeId,
    actionType: "export",
    exportFormat,
    filtersApplied: filters,
    ipAddress,
    userAgent,
  });
}

/**
 * Log org chart search.
 */
export async function logChartSearch(
  userId: string,
  employeeId: string | null,
  scopeType: string,
  scopeId: string | null,
  searchQuery: string,
  req: Request
): Promise<void> {
  const { ipAddress, userAgent } = extractAuditMetadata(req);
  await logOrgChartAccess({
    userId,
    employeeId,
    scopeType,
    scopeId,
    actionType: "search",
    searchQuery,
    ipAddress,
    userAgent,
  });
}

/**
 * Log node detail view.
 */
export async function logNodeDetail(
  userId: string,
  employeeId: string | null,
  targetEmployeeId: string,
  req: Request
): Promise<void> {
  const { ipAddress, userAgent } = extractAuditMetadata(req);
  await logOrgChartAccess({
    userId,
    employeeId,
    scopeType: null,
    scopeId: targetEmployeeId,
    actionType: "node_detail",
    ipAddress,
    userAgent,
  });
}

/**
 * Log data quality check.
 */
export async function logDataQualityCheck(
  userId: string,
  employeeId: string | null,
  scopeType: string | null,
  scopeId: string | null,
  req: Request
): Promise<void> {
  const { ipAddress, userAgent } = extractAuditMetadata(req);
  await logOrgChartAccess({
    userId,
    employeeId,
    scopeType,
    scopeId,
    actionType: "data_quality_check",
    ipAddress,
    userAgent,
  });
}
