import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveDashboardScope } from "../../shared/dashboardScope.js";
import { buildDatasetScopeFilter } from "./performance-governance.service.js";

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(maximum, parsed));
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export const performanceGovernanceAuditService = {
  async list(userId: string, input: {
    datasetId?: string | null;
    actionCode?: string | null;
    page?: number;
    pageSize?: number;
  }) {
    const scope = await resolveDashboardScope(userId, "");
    const scoped = buildDatasetScopeFilter(scope, "psd");
    const page = positiveInteger(input.page, 1, 100000);
    const pageSize = positiveInteger(input.pageSize, 50, 100);
    const offset = (page - 1) * pageSize;
    const conditions: string[] = [];
    const params: string[] = [];

    if (scope.level === "ORG_ALL") {
      conditions.push("1 = 1");
    } else {
      conditions.push("pga.dataset_id IS NOT NULL", scoped.sql);
      params.push(...scoped.params);
    }

    if (input.datasetId) {
      conditions.push("pga.dataset_id = ?");
      params.push(input.datasetId);
    }
    if (input.actionCode) {
      conditions.push("pga.action_code = ?");
      params.push(input.actionCode);
    }

    const where = conditions.join(" AND ");
    const [[countRows], [rows], [actions]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
           FROM performance_governance_audit pga
           LEFT JOIN performance_source_dataset psd ON psd.id = pga.dataset_id
          WHERE ${where}`,
        params,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           pga.id,
           pga.actor_user_id,
           pga.action_code,
           pga.entity_type,
           pga.entity_id,
           pga.dataset_id,
           pga.before_json,
           pga.after_json,
           pga.metadata_json,
           pga.created_at,
           psd.dataset_key,
           psd.dataset_name,
           pm.process_name,
           bm.branch_name
         FROM performance_governance_audit pga
         LEFT JOIN performance_source_dataset psd ON psd.id = pga.dataset_id
         LEFT JOIN process_master pm ON pm.id = psd.process_id
         LEFT JOIN branch_master bm ON bm.id = psd.branch_id
        WHERE ${where}
        ORDER BY pga.created_at DESC, pga.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT DISTINCT pga.action_code
           FROM performance_governance_audit pga
           LEFT JOIN performance_source_dataset psd ON psd.id = pga.dataset_id
          WHERE ${scope.level === "ORG_ALL" ? "1 = 1" : `pga.dataset_id IS NOT NULL AND ${scoped.sql}`}
          ORDER BY pga.action_code ASC`,
        scope.level === "ORG_ALL" ? [] : scoped.params,
      ),
    ]);

    return {
      rows: rows.map((row) => ({
        id: String(row.id),
        actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
        actionCode: String(row.action_code),
        entityType: String(row.entity_type),
        entityId: row.entity_id ? String(row.entity_id) : null,
        datasetId: row.dataset_id ? String(row.dataset_id) : null,
        datasetKey: row.dataset_key ? String(row.dataset_key) : null,
        datasetName: row.dataset_name ? String(row.dataset_name) : null,
        processName: row.process_name ? String(row.process_name) : null,
        branchName: row.branch_name ? String(row.branch_name) : null,
        before: parseJson(row.before_json),
        after: parseJson(row.after_json),
        metadata: parseJson(row.metadata_json),
        createdAt: new Date(row.created_at).toISOString(),
      })),
      actions: actions.map((row) => String(row.action_code)),
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    };
  },
};
