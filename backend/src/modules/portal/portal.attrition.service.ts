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

    const [exitRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_exits,
         SUM(CASE WHEN exit_type = 'voluntary'   THEN 1 ELSE 0 END) AS voluntary_count,
         SUM(CASE WHEN exit_type = 'involuntary' THEN 1 ELSE 0 END) AS involuntary_count
       FROM exit_records
       WHERE process_id = ? AND DATE_FORMAT(exit_date, '%Y-%m') = ?`,
      [processId, period]
    ).catch((): [RowDataPacket[], unknown] => [[{ total_exits: 0, voluntary_count: 0, involuntary_count: 0 } as RowDataPacket], null]);
    const exits = (exitRows as RowDataPacket[])[0];

    const [reasonRows] = await db.execute<RowDataPacket[]>(
      `SELECT exit_reason AS reason, COUNT(*) AS cnt
       FROM exit_records
       WHERE process_id = ? AND DATE_FORMAT(exit_date, '%Y-%m') = ?
       GROUP BY exit_reason ORDER BY cnt DESC LIMIT 3`,
      [processId, period]
    ).catch((): [RowDataPacket[], unknown] => [[], null]);

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
      sanctioned_strength: headcount,
      open_positions: 0,
      avg_tenure_months: Math.round(Number(hc.avg_tenure) || 0),
      top_exit_reasons: (reasonRows as RowDataPacket[]).map(r => ({ reason: r.reason, count: Number(r.cnt) })),
    };
  },
};
