import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AttritionData } from "./portal.types.js";

export const portalAttritionService = {
  async getAttrition(processId: string, period: string, allowedProcessIds?: string[]): Promise<AttritionData> {
    // Defence-in-depth: verify the caller is allowed to access this processId.
    // The controller already calls assertProcessAccess but this layer adds a second check.
    if (!processId) throw Object.assign(new Error("processId is required"), { statusCode: 400 });
    if (allowedProcessIds !== undefined && !allowedProcessIds.includes(processId)) {
      throw Object.assign(new Error("Process not in your access list"), { statusCode: 403 });
    }
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period format: ${period}`);

    if (processId === "p-demo-1") {
      return {
        period,
        attrition_pct: 2.15,
        voluntary_count: 3,
        involuntary_count: 1,
        headcount: 186,
        sanctioned_strength: 200,
        open_positions: 14,
        avg_tenure_months: 14,
        top_exit_reasons: [
          { reason: "Higher Education", count: 2 },
          { reason: "Better Career Opportunity", count: 1 },
          { reason: "Performance", count: 1 }
        ]
      };
    }

    const [hcRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS headcount,
              AVG(TIMESTAMPDIFF(MONTH, date_of_joining, CURDATE())) AS avg_tenure
       FROM employees WHERE process_id = ? AND LOWER(employment_status) = 'active'`,
      [processId]
    );
    const hc = (hcRows as RowDataPacket[])[0];

    // Real exits table is exit_request (joined via employees.process_id — exit_request
    // itself has no process_id column). This used to query a table named `exit_records`,
    // which has never existed in this schema; the resulting SQL error was silently
    // swallowed by a .catch() that returned zeros for every client, every period. That
    // is exactly the false-zero this codebase's other portal services are written to
    // avoid (see portal.overview.service.ts's "no_data" comments) — a client reading
    // "0 voluntary exits" had no way to tell that apart from a genuinely perfect month.
    // exit_request.status counts a request as an actual exit only once it has reached
    // exit_confirmed_at; a submitted-but-not-yet-confirmed resignation is not an exit yet.
    const [exitRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_exits,
         SUM(CASE WHEN er.exit_type = 'voluntary' THEN 1 ELSE 0 END) AS voluntary_count,
         SUM(CASE WHEN er.exit_type IN ('involuntary','absconding') THEN 1 ELSE 0 END) AS involuntary_count
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       WHERE e.process_id = ?
         AND er.exit_confirmed_at IS NOT NULL
         AND DATE_FORMAT(er.last_working_day_confirmed, '%Y-%m') = ?`,
      [processId, period]
    );
    const exits = (exitRows as RowDataPacket[])[0];

    const [reasonRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(er.exit_reason_category, 'Not categorized') AS reason, COUNT(*) AS cnt
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       WHERE e.process_id = ?
         AND er.exit_confirmed_at IS NOT NULL
         AND DATE_FORMAT(er.last_working_day_confirmed, '%Y-%m') = ?
       GROUP BY reason ORDER BY cnt DESC LIMIT 3`,
      [processId, period]
    );

    // Sanctioned strength is the mandated headcount for this process, not a copy of
    // whoever happens to be active today — those are different claims. The mandate is
    // effective-dated (workforce_mandate.effective_from/effective_to), so this takes the
    // row covering "now", per process, summed across any split by branch/role_group.
    // Falls back to null (rendered as "—", never as the active headcount) when no
    // mandate has been configured for this process yet.
    const [mandateRows] = await db.execute<RowDataPacket[]>(
      `SELECT SUM(mandated_hc) AS mandated_hc
       FROM workforce_mandate
       WHERE process_id = ? AND active_status = 1
         AND effective_from <= CURDATE()
         AND (effective_to IS NULL OR effective_to >= CURDATE())`,
      [processId]
    );
    const mandatedHc = (mandateRows as RowDataPacket[])[0]?.mandated_hc;

    const headcount = Number(hc.headcount) || 0;
    const totalExits = Number(exits.total_exits) || 0;
    const attrition_pct = headcount > 0
      ? Math.round((totalExits / headcount) * 100 * 100) / 100
      : 0;

    return {
      period,
      attrition_pct,
      voluntary_count: Number(exits.voluntary_count) || 0,
      involuntary_count: Number(exits.involuntary_count) || 0,
      headcount,
      // null (not headcount) when no mandate is configured -- a client-side "100%
      // capacity" that only holds because we copied the numerator into the
      // denominator is worse than admitting the mandate isn't set up yet.
      sanctioned_strength: mandatedHc != null ? Number(mandatedHc) : null,
      open_positions: 0,
      avg_tenure_months: Math.round(Number(hc.avg_tenure) || 0),
      top_exit_reasons: (reasonRows as RowDataPacket[]).map(r => ({ reason: r.reason, count: Number(r.cnt) })),
    };
  },
};
