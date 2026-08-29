/**
 * Connect to mas_hrms / db_bill with an automatic LAN -> public fallback.
 *
 * Both databases answer on two addresses and which one works depends on the
 * network the dev machine is on that day. The wrong one gives ETIMEDOUT, not an
 * auth error, and it can flip mid-session — a script that connected fine at the
 * start of a run has failed 40 minutes later. So never hardcode one host: try the
 * LAN address, then the public one.
 *
 *   mas_hrms   192.168.10.6   ->  122.184.128.90
 *   db_bill    192.168.10.22  ->  14.97.30.236
 *
 * backend/.env stores values WRAPPED IN DOUBLE QUOTES. A naive parser keeps the
 * quotes and passes them as part of the password, which fails with
 * "Access denied ... (using password: YES)" — indistinguishable from a host-grant
 * problem. The grant is shivam_user@% (any host), so a host whitelist is never
 * the cause. Always strip the quotes.
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function envValue(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8');
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null;
  } catch { return null; }
}

export const HOSTS = {
  mas_hrms: ['192.168.10.6', '122.184.128.90'],
  db_bill:  ['192.168.10.22', '14.97.30.236'],
};

/**
 * @param {'mas_hrms'|'db_bill'} database
 * @param {{ host?: string|null, log?: (m: string) => void }} opts
 *        `host` forces one address (from a --hrms-host / --bill-host flag) and
 *        disables the fallback, so an explicit choice is never silently ignored.
 */
export async function connect(database, { host = null, log = () => {} } = {}) {
  const candidates = host ? [host] : HOSTS[database];
  if (!candidates) throw new Error(`No host list for database '${database}'`);

  const cfg = {
    port: 3306,
    user: envValue('DB_USER'),
    password: envValue('DB_PASSWORD'),
    database,
    connectTimeout: 20000,
    dateStrings: true,
  };

  let lastErr;
  for (const h of candidates) {
    try {
      const conn = await mysql.createConnection({ ...cfg, host: h });
      log(`  connected ${database} @ ${h}`);
      return conn;
    } catch (e) {
      lastErr = e;
      // Only a reachability failure is worth retrying elsewhere. An auth or
      // unknown-database error will fail identically on the other host, and
      // retrying it just doubles the failed-login count against fail2ban.
      const reachability = ['ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'];
      if (!reachability.includes(e.code)) throw e;
      log(`  ${database} @ ${h}: ${e.code} — trying next address`);
    }
  }
  throw lastErr;
}
