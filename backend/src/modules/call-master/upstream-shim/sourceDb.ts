import { getSourcePool } from "../../../db/sourceDb.js";

/*
 * Stand-in for the Mydashboards `lib/sourceDb`. The synced services were written against a database that differs
 * from the HRMS source server in three ways, and each is absorbed here so the vendored SQL stays verbatim:
 *
 *  1. sql_mode - upstream selects non-grouped columns (e.g. am.AgentName under GROUP BY AgentName); this server
 *     enforces ONLY_FULL_GROUP_BY. The flag is dropped for the one connection the query runs on.
 *  2. md_clients - does not exist on this host (see call-master.service.ts getClientList). Upstream's
 *     `shivamgiri.md_clients c` (id, name, dialdesk_client_id) is served from Shivamgiri.portal_client_config,
 *     whose client_id is the dialler client id.
 *  3. Bare `AgentName` next to a join on db_masmis.AgentMaster, which also has AgentName, is ambiguous here.
 */
const CLIENTS_AS_MD_CLIENTS =
  "(SELECT client_id AS id, client_id AS dialdesk_client_id, display_name AS name FROM Shivamgiri.portal_client_config WHERE is_active = 1)";

export function adaptSql(sql: string): string {
  let out = sql.replace(/shivamgiri\.md_clients/gi, CLIENTS_AS_MD_CLIENTS);
  if (/FROM db_external\.CallDetails\s+LEFT JOIN db_masmis\.AgentMaster/.test(out)) {
    out = out.replace(/(?<![.\w])AgentName\b/g, "db_external.CallDetails.AgentName");
  }
  return out;
}

export async function querySource<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T[]> {
  const conn = await getSourcePool().getConnection();
  try {
    await conn.query("SET SESSION sql_mode = REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', '')");
    const [rows] = await conn.execute(adaptSql(sql), params);
    return rows as T[];
  } finally {
    conn.release();
  }
}
