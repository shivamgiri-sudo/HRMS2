import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addDays, type OpsCtx } from "./ops-command.context.js";
import { loadView } from "./ops-command.dim.js";
import { computeEmployeeDetail } from "./ops-command.records.js";
import { computeRiskScores } from "./ops-command.risk.js";
import { computeRows, type MetricValues } from "./ops-command.service.js";

const PEER_KEYS = [
  "attendance_pct",
  "absent_pct",
  "late_pct",
  "shrinkage_pct",
  "missing_punch_pct",
  "roster_adherence_pct",
  "qa_score_pct",
  "avg_login_hours",
] as const;

export interface PeerBlock {
  label: string;
  size: number | null;
  values: Record<string, number | null>;
}

const pick = (m: MetricValues | undefined): Record<string, number | null> =>
  Object.fromEntries(PEER_KEYS.map((k) => [k, m?.[k] ?? null]));

/**
 * Agent 360 = row-scope-checked detail + retention risk + how this person compares with their own team and the whole scope
 * (same formulas as the tables, from the same cached facts) + their most recent audited calls.
 */
export async function computeEmployee360(ctx: OpsCtx, employeeId: string) {
  const detail = await computeEmployeeDetail(ctx, employeeId);
  if (!detail) return null;
  const view = await loadView(ctx);
  const me = view.byId.get(employeeId);

  const [risk, own, org, team] = await Promise.all([
    computeRiskScores(ctx, view).then((m) => m.get(employeeId) ?? null),
    computeRows(ctx, "employee", view).then((r) => r.rows.get(employeeId)),
    computeRows(ctx, "all", view).then((r) => r.rows.get("all")),
    me?.mgr
      ? loadView({ ...ctx, f: { ...ctx.f, managerId: me.mgr } }).then((v) =>
          computeRows(
            { ...ctx, f: { ...ctx.f, managerId: me.mgr! } },
            "all",
            v,
          ).then((r) => r.rows.get("all")),
        )
      : Promise.resolve(undefined),
  ]);

  let recentCalls: Array<{ at: string; score: number | null }> | null = null;
  const code = String(detail.profile.employee_code ?? "");
  if (code) {
    try {
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 6000),
      );
      const [rows] = await Promise.race([
        db.execute<RowDataPacket[]>(
          `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d %H:%i') AS at, quality_percentage AS q FROM db_audit.call_quality_assessment
            WHERE User = ? AND CallDate >= ? ORDER BY CallDate DESC LIMIT 20`,
          [code, addDays(ctx.f.to, -60)],
        ),
        timeout,
      ]);
      recentCalls = rows.map((r) => ({
        at: String(r.at),
        score: r.q === null ? null : Number(r.q),
      }));
    } catch (err) {
      logger.warn(
        `[ops-command] agent360 recent audits unavailable: ${(err as Error).message}`,
      );
    }
  }

  return {
    ...detail,
    risk,
    recentCalls,
    peers: {
      agent: {
        label: "This agent",
        size: null,
        values: pick(own),
      } as PeerBlock,
      team: me?.mgr
        ? ({
            label: `Team (${String(detail.profile.manager_name ?? "manager")})`,
            size: team?.hc_closing ?? null,
            values: pick(team),
          } as PeerBlock)
        : null,
      scope: {
        label: "All in scope",
        size: org?.hc_closing ?? null,
        values: pick(org),
      } as PeerBlock,
    },
  };
}
