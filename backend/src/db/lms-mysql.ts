import mysql, { type RowDataPacket, type FieldPacket, type QueryResult, type Pool } from "mysql2/promise";

// Read-only connection to the external LMS database.
// Never write to this database — it is owned by the LMS system.
const LMS_HOST     = process.env.LMS_DB_HOST     ?? "192.168.11.225";
const LMS_PORT     = Number(process.env.LMS_DB_PORT ?? 3306);
const LMS_USER     = process.env.LMS_DB_USER     ?? "shivam_user";
const LMS_PASSWORD = process.env.LMS_DB_PASSWORD ?? "qwersdfg!@#hjk";
const LMS_DATABASE = process.env.LMS_DB_NAME     ?? "mcn_lms";

let _lmsPool: Pool | null = null;

function getLmsPool(): Pool {
  if (!_lmsPool) {
    _lmsPool = mysql.createPool({
      host:               LMS_HOST,
      port:               LMS_PORT,
      user:               LMS_USER,
      password:           LMS_PASSWORD,
      database:           LMS_DATABASE,
      connectionLimit:    5,
      waitForConnections: true,
      queueLimit:         0,
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

/**
 * Close the LMS connection pool for graceful shutdown.
 */
export async function closeLmsPool(): Promise<void> {
  if (_lmsPool) {
    await _lmsPool.end();
    _lmsPool = null;
  }
}
