import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

// External ticketing system behind the Molecular Email / Reginald Men Email
// dashboards. Same host and credentials for both dashboards — only the
// database name differs: "db_email" is Reginald, "molecular_db_email" is
// Molecular. Read-only: this project never writes tickets, only reads daily
// aggregates out of it.
const pools = new Map<string, mysql.Pool>();

export type EmailTicketSource = 'db_email' | 'molecular_db_email';

function buildConfig(database: EmailTicketSource): mysql.PoolOptions {
  return {
    host: env.MOLECULAR_EMAIL_DB_HOST,
    port: env.MOLECULAR_EMAIL_DB_PORT || 3306,
    user: env.MOLECULAR_EMAIL_DB_USER,
    password: env.MOLECULAR_EMAIL_DB_PASSWORD,
    database,
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0,
    connectTimeout: 15000,
    timezone: '+05:30',
    // DATE(...)-truncated GROUP BY output comes back as a plain 'YYYY-MM-DD'
    // string instead of a JS Date — see hrms2-dialler-db-no-datestrings memory:
    // slicing a Date's toISOString() shifts the day across a UTC boundary.
    dateStrings: true,
    connectAttributes: {
      program_name: 'HRMS_ReadOnly_MolecularEmail',
    },
  };
}

export async function getMolecularEmailPool(database: EmailTicketSource): Promise<mysql.Pool> {
  let pool = pools.get(database);
  if (!pool) {
    pool = mysql.createPool(buildConfig(database));
    pools.set(database, pool);
    try {
      const conn = await pool.getConnection();
      await conn.query('SET SESSION TRANSACTION READ ONLY');
      conn.release();
      console.log(`[MOLECULAR_EMAIL] Connected to ${env.MOLECULAR_EMAIL_DB_HOST}:${env.MOLECULAR_EMAIL_DB_PORT}/${database} (READ-ONLY)`);
    } catch (error: unknown) {
      pools.delete(database);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[MOLECULAR_EMAIL] Connection failed for ${database}:`, message);
      throw error;
    }
  }
  return pool;
}

export async function closeMolecularEmailPools(): Promise<void> {
  for (const [key, pool] of pools) {
    await pool.end().catch(() => {});
    pools.delete(key);
  }
}
