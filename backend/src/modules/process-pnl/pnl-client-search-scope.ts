import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * The Process P&L page's Client and Search filters, as a set of process ids (audit item 19).
 *
 * The header strip (bpo / Statement) applies them through process-pnl.service.ts
 * getBaseProcesses(): `p.client_id = ?` and a LIKE over process name/code, client name and branch
 * name, on active processes. CEO Overview, Live P&L, the YTD strip and the trend charts are
 * cost-centre / branch engines with no client concept, so they ignored both filters and showed a
 * different (unfiltered) population right under a filtered header. They all DO understand a
 * process scope, so the same predicates are resolved here to the process ids they match, and each
 * engine narrows by those.
 *
 * Returns null when neither filter is set (no narrowing at all). An empty match is returned as
 * NO_MATCHING_PROCESS so the engines show nothing, never "everything" — an empty IN-list is
 * treated as "no filter" by every CeoScope consumer.
 */
export const NO_MATCHING_PROCESS = "__no_matching_process__";

export async function resolveClientSearchProcessIds(input: {
  clientId?: string | null;
  search?: string | null;
}): Promise<string[] | null> {
  const clientId = input.clientId?.trim() || "";
  const search = input.search?.trim() || "";
  if (!clientId && !search) return null;
  const conds = ["COALESCE(p.active_status, 1) = 1"];
  const params: unknown[] = [];
  if (clientId) {
    conds.push("p.client_id = ?");
    params.push(clientId);
  }
  if (search) {
    const like = `%${search}%`;
    conds.push("(p.process_name LIKE ? OR p.process_code LIKE ? OR cm.client_name LIKE ? OR bm.branch_name LIKE ?)");
    params.push(like, like, like, like);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id
       FROM process_master p
       LEFT JOIN client_master cm ON cm.id = p.client_id
       LEFT JOIN branch_master bm ON bm.id = p.branch_id
      WHERE ${conds.join(" AND ")}`,
    params,
  );
  const ids = rows.map((r) => String(r.id)).filter(Boolean);
  return ids.length ? ids : [NO_MATCHING_PROCESS];
}

/**
 * Combine the process scope a route already resolved (a confined user's own process, else what was
 * requested) with the client/search match. Never widens: with both present the result is their
 * intersection, and an empty intersection is NO_MATCHING_PROCESS rather than "all processes".
 */
export function narrowProcessScope(base: string[], clientSearch: string[] | null): string[] {
  if (clientSearch === null) return base;
  if (base.length === 0) return clientSearch;
  const allowed = new Set(clientSearch);
  const both = base.filter((id) => allowed.has(id));
  return both.length ? both : [NO_MATCHING_PROCESS];
}
