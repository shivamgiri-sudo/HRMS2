import { querySource } from "./sourceDb.js";

/*
 * Stand-in for the Mydashboards `lib/prismaClient`. The synced services use it for exactly one thing on the
 * dashboard path - the "Active Clients" KPI (`md_clients.count`) - which is answered from portal_client_config.
 * Everything else (the tenant-scope helpers resolveUserScope / getClientList) is replaced by call-master.scope.ts,
 * so any other use is a wiring bug and fails loudly.
 */
const prisma = {
  md_clients: {
    async count(args?: { where?: { dialdesk_client_id?: { in: number[] } } }): Promise<number> {
      const ids = args?.where?.dialdesk_client_id?.in;
      const filter = ids?.length ? ` AND client_id IN (${ids.map(() => "?").join(",")})` : "";
      const [row] = await querySource<{ n: number }>(
        `SELECT COUNT(*) AS n FROM Shivamgiri.portal_client_config WHERE is_active = 1${filter}`,
        ids ?? [],
      );
      return Number(row?.n) || 0;
    },
  },
};

export default new Proxy(prisma as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    throw new Error(`Mydashboards prisma.${String(prop)} is not available in HRMS - scope via call-master.scope.ts instead`);
  },
}) as never;
