import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Per-cost-centre seat count vs actual headcount vs billability%.
 *
 * mandated_seats (NOT mandated_seats_value — confirmed live 2026-09-10: 376/406 active cost
 * centres carry mandated_seats, only 13/406 carry mandated_seats_value) is the seat mandate.
 * Actual headcount is active employees currently posted to the cost centre
 * (employees.cost_centre_id, active_status=1) — the live headcount, not a historical payroll
 * month, since billability is a live staffing question.
 *
 * Cost centres with NULL/zero mandated_seats are surfaced with billabilityPct = null and
 * seatConfigStatus = "not_configured" rather than silently rendered as 0% or NaN — a real
 * data gap, not a real 0% billability.
 *
 * Approved per-seat rates (cost_centre_seat_rate, status='approved', billing_model='per_seat')
 * are surfaced separately per cost centre when present (18 rows total live, 16 of which cover a
 * staffed centre) — this is informational context for the seat, not folded into billability%.
 */

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

export interface PnlSeatBillabilityRow {
  costCentreId: string;
  costCentreName: string;
  processId: string | null;
  processName: string | null;
  branchId: string | null;
  mandatedSeats: number | null;
  actualHeadcount: number;
  billabilityPct: number | null;
  seatConfigStatus: "configured" | "not_configured";
  approvedSeatRateMonthly: number | null;
}

export interface PnlSeatBillabilityResult {
  costCentres: PnlSeatBillabilityRow[];
  coverage: {
    totalActiveCostCentres: number;
    configuredCount: number;
    notConfiguredCount: number;
  };
}

export async function getSeatBillability(filters: { branchId?: string; processId?: string } = {}): Promise<PnlSeatBillabilityResult> {
  const branchClause = filters.branchId ? "AND ccm.branch_id = ?" : "";
  const processClause = filters.processId ? "AND ccm.process_id = ?" : "";
  const params: unknown[] = [];
  if (filters.branchId) params.push(filters.branchId);
  if (filters.processId) params.push(filters.processId);

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ccm.id AS costCentreId, ccm.cost_centre_name AS costCentreName,
            ccm.process_id AS processId, pm.process_name AS processName,
            ccm.branch_id AS branchId, ccm.mandated_seats AS mandatedSeats,
            (SELECT COUNT(*) FROM employees e WHERE e.cost_centre_id = ccm.id AND e.active_status = 1) AS actualHeadcount,
            (SELECT sr.seat_rate_monthly
               FROM cost_centre_seat_rate sr
              WHERE sr.cost_centre_id = ccm.id AND sr.status = 'approved' AND sr.billing_model = 'per_seat'
                AND sr.seat_rate_monthly > 0
              ORDER BY sr.effective_from DESC LIMIT 1) AS approvedSeatRateMonthly
       FROM cost_centre_master ccm
       LEFT JOIN process_master pm ON pm.id = ccm.process_id
      WHERE ccm.active_status = 1 ${branchClause} ${processClause}
      ORDER BY ccm.cost_centre_name`,
    params
  );

  const costCentres: PnlSeatBillabilityRow[] = rows.map((row) => {
    const mandatedSeats = row.mandatedSeats != null ? n(row.mandatedSeats) : null;
    const actualHeadcount = n(row.actualHeadcount);
    const configured = mandatedSeats != null && mandatedSeats > 0;
    return {
      costCentreId: String(row.costCentreId),
      costCentreName: String(row.costCentreName ?? "Unnamed cost centre"),
      processId: row.processId != null ? String(row.processId) : null,
      processName: row.processName != null ? String(row.processName) : null,
      branchId: row.branchId != null ? String(row.branchId) : null,
      mandatedSeats,
      actualHeadcount,
      billabilityPct: configured ? (actualHeadcount / (mandatedSeats as number)) * 100 : null,
      seatConfigStatus: configured ? "configured" : "not_configured",
      approvedSeatRateMonthly: row.approvedSeatRateMonthly != null ? n(row.approvedSeatRateMonthly) : null,
    };
  });

  const configuredCount = costCentres.filter((c) => c.seatConfigStatus === "configured").length;

  return {
    costCentres,
    coverage: {
      totalActiveCostCentres: costCentres.length,
      configuredCount,
      notConfiguredCount: costCentres.length - configuredCount,
    },
  };
}
