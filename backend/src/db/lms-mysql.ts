import mysql, { type RowDataPacket, type FieldPacket, type QueryResult, type Pool } from "mysql2/promise";

// Read-only connection to the external LMS database.
// Never write to this database — it is owned by the LMS system.
//
// No hardcoded fallback credentials. This used to default to a literal host/user/
// password/database committed to source — a leaked credential fallback that stayed
// live because it silently worked. Now it fails loudly at first use instead if any
// of these are unset, rather than silently connecting with a default nobody chose.
const LMS_HOST     = process.env.LMS_DB_HOST;
const LMS_PORT     = Number(process.env.LMS_DB_PORT ?? 3306); // well-known MySQL port, not a secret
const LMS_USER     = process.env.LMS_DB_USER;
const LMS_PASSWORD = process.env.LMS_DB_PASSWORD;
const LMS_DATABASE = process.env.LMS_DB_NAME;

let _lmsPool: Pool | null = null;

function getLmsPool(): Pool {
  if (!_lmsPool) {
    if (!LMS_HOST || !LMS_USER || !LMS_PASSWORD || !LMS_DATABASE) {
      throw new Error(
        "[lms-mysql] LMS_DB_HOST, LMS_DB_USER, LMS_DB_PASSWORD and LMS_DB_NAME must all be " +
        "set in the environment — no hardcoded fallback is used for the external LMS DB."
      );
    }
    /*
     * connectTimeout and enableKeepAlive match the other external pools (billDb, dialerDb,
     * legacyDb, masmisDb all use connectTimeout: 15000 with keep-alive on). This pool set
     * neither, so it silently took mysql2's 10s default and never kept an idle socket alive -
     * and it is the only one of the five that reaches its host across the public internet,
     * where an idle NAT mapping is dropped without either end being told.
     *
     * What that looked like: /api/lms/connection reported ok with latency_ms 15542 and
     * /api/lms/batch-planner returned "connect ETIMEDOUT" at 15s, on a server that had been
     * up for five hours - while a fresh process connected to the same host in 2.3-6.7s over
     * six consecutive attempts, never once above 10s. Calls that reused a live connection kept
     * working, which is why the failure looked like it belonged to one route.
     */
    _lmsPool = mysql.createPool({
      host:               LMS_HOST,
      port:               LMS_PORT,
      user:               LMS_USER,
      password:           LMS_PASSWORD,
      database:           LMS_DATABASE,
      connectionLimit:    5,
      waitForConnections: true,
      queueLimit:         0,
      connectTimeout:     15000,
      enableKeepAlive:    true,
      keepAliveInitialDelay: 0,
      timezone:           "+05:30",
      dateStrings:        true,
      decimalNumbers:     true,
    });
    (_lmsPool as any).on?.("error", (err: Error) => {
      console.error("[lms mysql pool] error:", err.message);
    });
  }
  return _lmsPool;
}

type ExecuteParams = Parameters<Pool["execute"]>[1];

export const lmsDb = {
  execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> {
    return getLmsPool().execute<T>(sql, params as ExecuteParams);
  },
  query<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> {
    return getLmsPool().query<T>(sql, params as ExecuteParams);
  },
};
