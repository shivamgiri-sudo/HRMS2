import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  DashboardScopeConfigurationError,
  resolveDashboardScopeForRequest,
  type DashboardScope,
} from "../../shared/dashboardScope.js";

const PROCESS_SCOPED_WFM_ROLES = new Set(["wfm", "wfm_spoc", "wfm_analyst"]);

type ScopeActor = { id: string; role?: string; isDemo?: boolean };

/**
 * The shared resolver treats `wfm` as process-scoped and refuses anyone without a
 * process row. Live, every `wfm` account was assigned by branch only, so all of them would
 * be refused. For the WFM screens only, an explicit branch assignment row is honoured as
 * branch scope. No branch row still fails closed.
 */
export async function resolveWfmScope(actor: ScopeActor): Promise<DashboardScope> {
  try {
    return await resolveDashboardScopeForRequest(
      { id: actor.id, role: actor.role, isDemo: actor.isDemo },
      actor.role ?? "",
    );
  } catch (err) {
    if (!(err instanceof DashboardScopeConfigurationError) || !PROCESS_SCOPED_WFM_ROLES.has(actor.role ?? "")) {
      throw err;
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT branch_id FROM user_assignment_scope
        WHERE user_id = ? AND active_status = 1 AND branch_id IS NOT NULL AND branch_id <> ''`,
      [actor.id],
    );
    const branchIds = (rows as RowDataPacket[]).map((r) => String(r.branch_id));
    if (!branchIds.length) throw err;
    return {
      level: "BRANCH_ALL",
      branchIds,
      processIds: [],
      employeeIds: [],
      userId: actor.id,
      role: actor.role ?? "",
    };
  }
}
