/**
 * COSEC MSSQL client.
 *
 * Opens a connection to the Matrix nCosec SQL Server instance and exposes a
 * thin execute helper.  Connection is created per-call (no pool) because this
 * path is invoked only on new-hire events, not on every request.
 */
import sql from "mssql";
import { env } from "../../../config/env.js";

export type CosecConnection = sql.ConnectionPool;

export async function openCosecConnection(): Promise<CosecConnection> {
  const config: sql.config = {
    server: env.NCOSEC_DB_HOST,
    port: Number(env.NCOSEC_DB_PORT ?? 1433),
    user: env.NCOSEC_DB_USER,
    password: env.NCOSEC_DB_PASSWORD,
    database: env.NCOSEC_DB_NAME,
    options: {
      encrypt: env.NCOSEC_DB_ENCRYPT === "true",
      trustServerCertificate: env.NCOSEC_DB_TRUST_CERT === "true",
      connectTimeout: 10_000,
      requestTimeout: 15_000,
    },
  };

  const pool = new sql.ConnectionPool(config);
  await pool.connect();
  return pool;
}

export async function cosecQuery<T = sql.IRecordSet<Record<string, unknown>>>(
  pool: CosecConnection,
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: Record<string, { type: any; value: unknown }>,
): Promise<T> {
  const request = pool.request();
  if (params) {
    for (const [key, { type, value }] of Object.entries(params)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request.input as any)(key, type, value);
    }
  }
  const result = await request.query(query);
  return result.recordset as T;
}