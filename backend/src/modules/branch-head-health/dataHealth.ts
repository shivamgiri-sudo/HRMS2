import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { ownCompanyBranchSql } from "../../shared/ownCompanyCostCentre.js";
import { listBranchProcesses, masCostCentreSql, type ProcessGroups } from "./processes.js";
import { loadLatestMetrics } from "./ops.js";
import type { SectionResult } from "./types.js";

export interface DataHealth {
  unmappedProcesses: number;
  costCentresWithoutProcess: number;
  overMandate: Array<{ costCentre: string; seats: number; headcount: number }>;
  staleProcesses: number;
}

const GATE = `cc.branch_id IN (?) AND cc.active_status = 1 AND b.active_status = 1 AND b.close_date IS NULL AND ${ownCompanyBranchSql("b")} AND ${masCostCentreSql("cc")}`;

/**
 * costCentresWithoutProcess: active MAS cost centres in the selected branches with no primary process and no active link row.
 * Aggregated across all selected branches (not per branch).
 */
export async function buildDataHealth(branchIds: string[], date: string, groupsIn?: ProcessGroups): Promise<SectionResult<DataHealth>> {
  if (branchIds.length === 0) return { status: "empty", data: null, asOf: date };
  const groups = groupsIn ?? (await listBranchProcesses(branchIds));
  const [[noProc], [seatRows]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n
         FROM cost_centre_master cc JOIN branch_master b ON b.id = cc.branch_id
        WHERE ${GATE} AND cc.process_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM cost_centre_process_link l WHERE l.cost_centre_id = cc.id AND l.active_status = 1)`,
      [branchIds],
    ),
    db.query<RowDataPacket[]>(
      `SELECT cc.id, cc.cost_centre_code AS cc_code, cc.mandated_seats,
              (SELECT COUNT(*) FROM employees e WHERE e.cost_centre_id = cc.id AND e.active_status = 1) AS headcount
         FROM cost_centre_master cc JOIN branch_master b ON b.id = cc.branch_id
        WHERE ${GATE} AND cc.mandated_seats IS NOT NULL`,
      [branchIds],
    ),
  ]);
  const overMandate: DataHealth["overMandate"] = [];
  for (const r of seatRows) {
    const raw = String(r.mandated_seats ?? "").trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) continue; // non-numeric seats such as 'o' are ignored
    const seats = Number(raw);
    const headcount = Number(r.headcount) || 0;
    if (seats > 0 && headcount > seats) overMandate.push({ costCentre: String(r.cc_code ?? ""), seats, headcount });
  }
  overMandate.sort((a, b) => b.headcount - b.seats - (a.headcount - a.seats));

  // Processes with no metric at all are not counted here (that is "not wired", not "stale").
  const liveIds = groups.active.filter((p) => !p.billingMirror).map((p) => p.processId);
  const latest = await loadLatestMetrics(liveIds, date);
  let staleProcesses = 0;
  for (const m of latest.values()) if (m.stale) staleProcesses++;

  return {
    status: "ok",
    asOf: date,
    data: {
      unmappedProcesses: groups.unmapped.length,
      costCentresWithoutProcess: Number(noProc[0]?.n) || 0,
      overMandate,
      staleProcesses,
    },
  };
}
