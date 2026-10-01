import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { REQUEST_KINDS, type RequestKind } from "./roster-requests.types.js";

type Exec = { execute: (sql: string, params?: unknown[]) => Promise<any> };

export interface AutoRule {
  enabled: boolean;
  maxCoverageDrop: number;
  requireCounterpartAccept: boolean;
}

export interface AutoRuleInput {
  processId: string;
  kind: string;
  enabled: boolean;
  maxCoverageDrop: number;
  requireCounterpartAccept: boolean;
}

const UUID_ISH = /^[0-9a-fA-F-]{8,36}$/;

export const DISABLED_AUTO_RULE: AutoRule = { enabled: false, maxCoverageDrop: 0, requireCounterpartAccept: true };

export async function getAutoRule(processId: string, kind: RequestKind, exec: Exec = db): Promise<AutoRule> {
  const [rows] = await exec.execute(
    `SELECT enabled, max_coverage_drop, require_counterpart_accept
       FROM roster_request_auto_rule WHERE process_id = ? AND kind = ? LIMIT 1`,
    [processId, kind],
  );
  const r = (rows as RowDataPacket[])[0];
  if (!r) return { ...DISABLED_AUTO_RULE };
  return {
    enabled: !!Number(r.enabled),
    maxCoverageDrop: Number(r.max_coverage_drop),
    requireCounterpartAccept: !!Number(r.require_counterpart_accept),
  };
}

export async function listAutoRules(scope: string[] | "all", exec: Exec = db): Promise<RowDataPacket[]> {
  if (scope === "all") {
    const [rows] = await exec.execute(
      `SELECT id, process_id, kind, enabled, max_coverage_drop, require_counterpart_accept, updated_by, updated_at
         FROM roster_request_auto_rule ORDER BY process_id, kind`,
    );
    return rows as RowDataPacket[];
  }
  if (scope.length === 0) return [];
  const [rows] = await exec.execute(
    `SELECT id, process_id, kind, enabled, max_coverage_drop, require_counterpart_accept, updated_by, updated_at
       FROM roster_request_auto_rule WHERE process_id IN (${scope.map(() => "?").join(",")})
      ORDER BY process_id, kind`,
    scope,
  );
  return rows as RowDataPacket[];
}

export async function upsertAutoRule(input: AutoRuleInput, userId: string | null, exec: Exec = db): Promise<void> {
  if (!input.processId || !UUID_ISH.test(input.processId)) throw new Error("Invalid processId");
  if (!(REQUEST_KINDS as readonly string[]).includes(input.kind)) throw new Error("Invalid request kind");
  if (!Number.isInteger(input.maxCoverageDrop) || input.maxCoverageDrop < 0) {
    throw new Error("maxCoverageDrop must be an integer >= 0");
  }
  await exec.execute(
    `INSERT INTO roster_request_auto_rule
       (id, process_id, kind, enabled, max_coverage_drop, require_counterpart_accept, updated_by)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), max_coverage_drop = VALUES(max_coverage_drop),
       require_counterpart_accept = VALUES(require_counterpart_accept), updated_by = VALUES(updated_by)`,
    [input.processId, input.kind, input.enabled ? 1 : 0, input.maxCoverageDrop, input.requireCounterpartAccept ? 1 : 0, userId],
  );
}
