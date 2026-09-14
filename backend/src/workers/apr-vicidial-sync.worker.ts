import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import mysql from 'mysql2/promise';

const WORKER_NAME = 'apr-vicidial-sync';

let intervalRef: ReturnType<typeof setInterval> | undefined;

// Legacy tables from dialer_db (kept for backward compatibility)
const LEGACY_DIALER_TABLES = [
  'vicidial_agent_log_10_25',
  'vicidial_agent_log_10_4',
  'vicidial_agent_log_11_4',
  'vicidial_agent_log_11_5',
  'vicidial_agent_log_247',
  'vicidial_agent_log_249',
  'vicidial_agent_log_250',
  'vicidial_agent_log_9',
];

interface AprServerConfig {
  integration_key: string;
  host: string;
  port: number;
  database: string;
  table: string;
  date_column: string;
  employee_code_column: string;
  username: string;
  password: string;
}

function secsToTime(s: number): string {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function buildAggQuery(tableName: string, dateCol: string, userCol: string): string {
  return `
    SELECT
      DATE(${dateCol})                                                     AS ReportDate,
      ${userCol}                                                           AS UserID,
      campaign_id,
      COUNT(DISTINCT CASE WHEN status IN ('INCALL','CBHOLD','XFER')
                          THEN agent_log_id END)                          AS Calls,
      SUM(wait_sec)                                                        AS wait_sec,
      SUM(talk_sec)                                                        AS talk_sec,
      SUM(dispo_sec)                                                       AS dispo_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'LB'
               THEN pause_sec ELSE 0 END)                                 AS LUNCH_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'TB'
               THEN pause_sec ELSE 0 END)                                 AS BIO_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status IN ('WB','MB')
               THEN pause_sec ELSE 0 END)                                 AS TRAINING_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'DISMX'
               THEN pause_sec ELSE 0 END)                                 AS DISMX_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'QB'
               THEN pause_sec ELSE 0 END)                                 AS QA_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'LOGIN'
               THEN pause_sec ELSE 0 END)                                 AS LOGIN_sec,
      SUM(CASE WHEN status = 'PAUSED'
               THEN pause_sec ELSE 0 END)                                 AS PAUSE_sec,
      TIME(MIN(${dateCol}))                                                AS Login_Time,
      TIME(MAX(CASE WHEN status IN ('LOGOUT','PAUSE')
                    THEN ${dateCol} END))                                  AS Logout_Time
    FROM ${tableName}
    WHERE ${dateCol} >= ? AND ${dateCol} < ?
      AND ${userCol} NOT IN ('VDAD','VDCL')
    GROUP BY DATE(${dateCol}), ${userCol}, campaign_id
    HAVING Calls > 0 OR PAUSE_sec > 0 OR wait_sec > 0
  `;
}

// Connection pool cache for external servers
const serverPools = new Map<string, mysql.Pool>();

async function getServerPool(config: AprServerConfig): Promise<mysql.Pool> {
  const key = `${config.host}:${config.port}:${config.database}`;
  let pool = serverPools.get(key);
  if (pool) {
    // Liveness probe: check a connection out and hand it straight back. The release lives in a
    // finally so this obeys the same rule as every other worker — see
    // workerConnectionRelease.contract.test.ts. Releasing on the happy path alone worked here,
    // because nothing between the two lines can throw, but it left the guard permanently red,
    // and a red guard is one nobody reads when the next worker really does leak.
    let conn: mysql.PoolConnection | undefined;
    try {
      conn = await pool.getConnection();
      return pool;
    } catch {
      serverPools.delete(key);
    } finally {
      conn?.release();
    }
  }
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    timezone: '+05:30',
    connectTimeout: 30000,
    waitForConnections: true,
    connectionLimit: 5,
  });
  serverPools.set(key, pool);
  return pool;
}

// Load all apr_server_* configs from integration_config
async function loadAprServerConfigs(): Promise<AprServerConfig[]> {
  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT integration_key, config_json, encrypted_credentials
    FROM integration_config
    WHERE integration_key LIKE 'apr_server_%'
      AND active_status = 1
  `);

  const configs: AprServerConfig[] = [];
  for (const row of rows) {
    try {
      const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
      const creds = typeof row.encrypted_credentials === 'string'
        ? JSON.parse(row.encrypted_credentials)
        : row.encrypted_credentials;

      if (!cfg?.host || !creds?.username || !creds?.password) {
        console.warn(`[${WORKER_NAME}] Skipping ${row.integration_key}: missing host or credentials`);
        continue;
      }

      configs.push({
        integration_key: row.integration_key,
        host: cfg.host,
        port: cfg.port || 3306,
        database: cfg.database || 'asterisk',
        table: cfg.table || 'vicidial_agent_log',
        date_column: cfg.date_column || 'event_time',
        employee_code_column: cfg.employee_code_column || 'user',
        username: creds.username,
        password: creds.password,
      });
    } catch (err: any) {
      console.warn(`[${WORKER_NAME}] Error parsing config for ${row.integration_key}: ${err.message}`);
    }
  }
  return configs;
}

// Legacy dialer_db connection
let legacyDialerDb: mysql.Connection | null = null;

async function getLegacyDialerDb(): Promise<mysql.Connection | null> {
  const dialerPassword = process.env.DIALER_DB_PASSWORD || process.env.DB_PASS;
  if (!dialerPassword) {
    return null;
  }

  if (legacyDialerDb) {
    try {
      await (legacyDialerDb as any).ping();
      return legacyDialerDb;
    } catch {
      legacyDialerDb = null;
    }
  }

  legacyDialerDb = await mysql.createConnection({
    host: process.env.DIALER_DB_HOST || '192.168.10.6',
    user: process.env.DIALER_DB_USER || process.env.DB_USER || 'shivam_user',
    password: dialerPassword,
    database: 'dialer_db',
    timezone: '+05:30',
    connectTimeout: 30000,
  });
  return legacyDialerDb;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUpsertError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string };
  if (err?.code === 'ER_LOCK_WAIT_TIMEOUT' || err?.code === 'ER_LOCK_DEADLOCK') return true;
  if (err?.errno === 1205 || err?.errno === 1213) return true;
  return /lock wait timeout|deadlock/i.test(String(err?.message ?? ''));
}

async function executeAprUpsertWithRetry(sqlText: string, params: unknown[], key: string): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.execute(sqlText, params);
      return;
    } catch (error) {
      if (!isRetryableUpsertError(error) || attempt === maxAttempts) {
        throw error;
      }
      const waitMs = attempt * 500;
      console.warn(`[${WORKER_NAME}] Upsert retry ${attempt}/${maxAttempts - 1} for ${key} after lock contention (${waitMs}ms)`);
      await sleep(waitMs);
    }
  }
}

// Load employee enrichment map: vicidial username → enrichment fields
async function loadEnrichmentMap(): Promise<Map<string, {
  employee_name: string; process_name: string; branch_name: string;
  reporting_manager: string; cost_centre: string;
}>> {
  const m = new Map<string, any>();

  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT
      e.call_centre_code                                                AS vkey,
      COALESCE(e.full_name, CONCAT(e.first_name,' ',e.last_name))     AS employee_name,
      COALESCE(pm.process_name,'')                                     AS process_name,
      COALESCE(bm.branch_name,'')                                      AS branch_name,
      COALESCE(mgr.full_name,
               CONCAT(mgr.first_name,' ',mgr.last_name),'')           AS reporting_manager,
      COALESCE(ccm.cost_centre_name,'')                                AS cost_centre
    FROM employees e
    LEFT JOIN process_master     pm  ON pm.id  = e.process_id
    LEFT JOIN branch_master      bm  ON bm.id  = e.branch_id
    LEFT JOIN employees          mgr ON mgr.id = e.reporting_manager_id
    LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
    WHERE e.call_centre_code IS NOT NULL AND e.call_centre_code != ''
      AND e.active_status = 1
  `);
  for (const r of rows) m.set(String(r.vkey).toUpperCase(), r);

  const [rows2] = await db.execute<RowDataPacket[]>(`
    SELECT
      e.employee_code                                                    AS vkey,
      COALESCE(e.full_name, CONCAT(e.first_name,' ',e.last_name))      AS employee_name,
      COALESCE(pm.process_name,'')                                      AS process_name,
      COALESCE(bm.branch_name,'')                                       AS branch_name,
      COALESCE(mgr.full_name,
               CONCAT(mgr.first_name,' ',mgr.last_name),'')            AS reporting_manager,
      COALESCE(ccm.cost_centre_name,'')                                 AS cost_centre
    FROM employees e
    LEFT JOIN process_master     pm  ON pm.id  = e.process_id
    LEFT JOIN branch_master      bm  ON bm.id  = e.branch_id
    LEFT JOIN employees          mgr ON mgr.id = e.reporting_manager_id
    LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
    WHERE e.employee_code IS NOT NULL AND e.active_status = 1
  `);
  for (const r of rows2) {
    const key = String(r.vkey).toUpperCase();
    if (!m.has(key)) m.set(key, r);
  }

  return m;
}

type AggRow = {
  Calls: number; wait_sec: number; talk_sec: number; dispo_sec: number;
  PAUSE_sec: number; LUNCH_sec: number; BIO_sec: number;
  TRAINING_sec: number; DISMX_sec: number; QA_sec: number; LOGIN_sec: number;
  Login_Time: string | null; Logout_Time: string | null;
};

async function upsertAggregatedRows(
  rowMap: Map<string, AggRow>,
  enrichMap: Map<string, any>,
  istDate: string
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;

  for (const [key, agg] of rowMap) {
    const [, userId, campaignId] = key.split('|');
    const netLogin = agg.wait_sec + agg.talk_sec + agg.dispo_sec + agg.PAUSE_sec;
    const ahtSec = agg.Calls > 0
      ? Math.round((agg.talk_sec + agg.dispo_sec) / agg.Calls) : 0;

    const enrich = enrichMap.get(userId.toUpperCase()) || {
      employee_name: '', process_name: '', branch_name: '',
      reporting_manager: '', cost_centre: '',
    };

    try {
      // Skip update if row exists with source='manual' (protected manual upload)
      await executeAprUpsertWithRetry(
        `INSERT INTO apr
           (ReportDate, UserID, campaign_id,
            Calls, WAIT_TIME, TALK_TIME, DISPO_TIME, PAUSE_TIME, AHT,
            Login_Time, Logout_Time, Net_Login,
            LOGIN, BIO, LUNCH, QA, DISMX, TRAINING,
            employee_name, process_name, branch_name, reporting_manager, cost_centre,
            source)
         VALUES (?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, 'sync')
         ON DUPLICATE KEY UPDATE
           Calls             = IF(source = 'manual', Calls, VALUES(Calls)),
           WAIT_TIME         = IF(source = 'manual', WAIT_TIME, VALUES(WAIT_TIME)),
           TALK_TIME         = IF(source = 'manual', TALK_TIME, VALUES(TALK_TIME)),
           DISPO_TIME        = IF(source = 'manual', DISPO_TIME, VALUES(DISPO_TIME)),
           PAUSE_TIME        = IF(source = 'manual', PAUSE_TIME, VALUES(PAUSE_TIME)),
           AHT               = IF(source = 'manual', AHT, VALUES(AHT)),
           Login_Time        = IF(source = 'manual', Login_Time, VALUES(Login_Time)),
           Logout_Time       = IF(source = 'manual', Logout_Time, VALUES(Logout_Time)),
           Net_Login         = IF(source = 'manual', Net_Login, VALUES(Net_Login)),
           LOGIN             = IF(source = 'manual', LOGIN, VALUES(LOGIN)),
           BIO               = IF(source = 'manual', BIO, VALUES(BIO)),
           LUNCH             = IF(source = 'manual', LUNCH, VALUES(LUNCH)),
           QA                = IF(source = 'manual', QA, VALUES(QA)),
           DISMX             = IF(source = 'manual', DISMX, VALUES(DISMX)),
           TRAINING          = IF(source = 'manual', TRAINING, VALUES(TRAINING)),
           employee_name     = IF(source = 'manual', employee_name, VALUES(employee_name)),
           process_name      = IF(source = 'manual', process_name, VALUES(process_name)),
           branch_name       = IF(source = 'manual', branch_name, VALUES(branch_name)),
           reporting_manager = IF(source = 'manual', reporting_manager, VALUES(reporting_manager)),
           cost_centre       = IF(source = 'manual', cost_centre, VALUES(cost_centre))`,
        [
          istDate, userId, campaignId,
          agg.Calls,
          secsToTime(agg.wait_sec),
          secsToTime(agg.talk_sec),
          secsToTime(agg.dispo_sec),
          secsToTime(agg.PAUSE_sec),
          secsToTime(ahtSec),
          agg.Login_Time || '00:00:00',
          agg.Logout_Time || '00:00:00',
          secsToTime(netLogin),
          secsToTime(agg.LOGIN_sec),
          secsToTime(agg.BIO_sec),
          secsToTime(agg.LUNCH_sec),
          secsToTime(agg.QA_sec),
          secsToTime(agg.DISMX_sec),
          secsToTime(agg.TRAINING_sec),
          enrich.employee_name || '',
          enrich.process_name || '',
          enrich.branch_name || '',
          enrich.reporting_manager || '',
          enrich.cost_centre || '',
        ],
        key,
      );
      upserted++;
    } catch (err: any) {
      console.warn(`[${WORKER_NAME}] Upsert failed ${key}: ${err.message}`);
      skipped++;
    }
  }

  return { upserted, skipped };
}

function mergeAggRow(rowMap: Map<string, AggRow>, key: string, r: any): void {
  const e = rowMap.get(key);
  if (!e) {
    rowMap.set(key, {
      Calls: +r.Calls || 0,
      wait_sec: +r.wait_sec || 0,
      talk_sec: +r.talk_sec || 0,
      dispo_sec: +r.dispo_sec || 0,
      PAUSE_sec: +r.PAUSE_sec || 0,
      LUNCH_sec: +r.LUNCH_sec || 0,
      BIO_sec: +r.BIO_sec || 0,
      TRAINING_sec: +r.TRAINING_sec || 0,
      DISMX_sec: +r.DISMX_sec || 0,
      QA_sec: +r.QA_sec || 0,
      LOGIN_sec: +r.LOGIN_sec || 0,
      Login_Time: r.Login_Time ? String(r.Login_Time) : null,
      Logout_Time: r.Logout_Time ? String(r.Logout_Time) : null,
    });
  } else {
    e.Calls += +r.Calls || 0;
    e.wait_sec += +r.wait_sec || 0;
    e.talk_sec += +r.talk_sec || 0;
    e.dispo_sec += +r.dispo_sec || 0;
    e.PAUSE_sec += +r.PAUSE_sec || 0;
    e.LUNCH_sec += +r.LUNCH_sec || 0;
    e.BIO_sec += +r.BIO_sec || 0;
    e.TRAINING_sec += +r.TRAINING_sec || 0;
    e.DISMX_sec += +r.DISMX_sec || 0;
    e.QA_sec += +r.QA_sec || 0;
    e.LOGIN_sec += +r.LOGIN_sec || 0;
    if (r.Login_Time && (!e.Login_Time || r.Login_Time < e.Login_Time))
      e.Login_Time = String(r.Login_Time);
    if (r.Logout_Time && (!e.Logout_Time || r.Logout_Time > e.Logout_Time))
      e.Logout_Time = String(r.Logout_Time);
  }
}

async function syncFromConfiguredServers(
  istDate: string,
  rowMap: Map<string, AggRow>
): Promise<{ servers: number; rows: number }> {
  const configs = await loadAprServerConfigs();
  let totalRows = 0;

  for (const cfg of configs) {
    try {
      const pool = await getServerPool(cfg);
      const query = buildAggQuery(cfg.table, cfg.date_column, cfg.employee_code_column);
      const dateFrom = `${istDate} 00:00:00`;
      const dateTo = new Date(new Date(istDate).getTime() + 86400000)
        .toISOString().slice(0, 10) + ' 00:00:00';

      const [rows] = await pool.execute(query, [dateFrom, dateTo]) as [any[], any];
      console.log(`[${WORKER_NAME}]   ${cfg.integration_key} (${cfg.host}): ${rows.length} rows`);

      for (const r of rows) {
        const key = `${istDate}|${r.UserID}|${r.campaign_id}`;
        mergeAggRow(rowMap, key, r);
      }
      totalRows += rows.length;
    } catch (err: any) {
      console.error(`[${WORKER_NAME}] Error syncing from ${cfg.integration_key}: ${err.message}`);
    }
  }

  return { servers: configs.length, rows: totalRows };
}

async function syncFromLegacyDialer(
  istDate: string,
  rowMap: Map<string, AggRow>
): Promise<number> {
  const ddb = await getLegacyDialerDb();
  if (!ddb) {
    console.log(`[${WORKER_NAME}]   Legacy dialer_db not configured, skipping`);
    return 0;
  }

  const dateFrom = `${istDate} 00:00:00`;
  const dateTo = new Date(new Date(istDate).getTime() + 86400000)
    .toISOString().slice(0, 10) + ' 00:00:00';

  let totalRows = 0;
  for (const tbl of LEGACY_DIALER_TABLES) {
    try {
      const q = buildAggQuery(tbl, 'event_time', 'user');
      const [rows] = await ddb.execute(q, [dateFrom, dateTo]) as [any[], any];
      if (!rows.length) continue;
      console.log(`[${WORKER_NAME}]   dialer_db.${tbl}: ${rows.length} rows`);

      for (const r of rows) {
        const key = `${istDate}|${r.UserID}|${r.campaign_id}`;
        mergeAggRow(rowMap, key, r);
      }
      totalRows += rows.length;
    } catch (err: any) {
      console.warn(`[${WORKER_NAME}] Skipped ${tbl}: ${err.message}`);
    }
  }

  return totalRows;
}

async function syncForDate(istDate: string): Promise<{ upserted: number; skipped: number }> {
  const enrichMap = await loadEnrichmentMap();
  const rowMap = new Map<string, AggRow>();

  // Sync from configured apr_server_* sources
  const { servers, rows: configRows } = await syncFromConfiguredServers(istDate, rowMap);
  console.log(`[${WORKER_NAME}]   Configured servers: ${servers}, rows: ${configRows}`);

  // Sync from legacy dialer_db tables
  const legacyRows = await syncFromLegacyDialer(istDate, rowMap);
  console.log(`[${WORKER_NAME}]   Legacy dialer_db rows: ${legacyRows}`);

  // Upsert all aggregated rows
  return upsertAggregatedRows(rowMap, enrichMap, istDate);
}

async function runAprSync(daysBack = 1): Promise<void> {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const dates: string[] = [];
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(nowIST);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  console.log(`[${WORKER_NAME}] Syncing dates: ${dates.join(', ')}`);
  let totalUpserted = 0, totalSkipped = 0;

  for (const date of dates) {
    console.log(`[${WORKER_NAME}] Processing ${date}...`);
    try {
      const { upserted, skipped } = await syncForDate(date);
      console.log(`[${WORKER_NAME}]   done: upserted=${upserted} skipped=${skipped}`);
      totalUpserted += upserted;
      totalSkipped += skipped;
    } catch (err: any) {
      console.error(`[${WORKER_NAME}] Error on ${date}: ${err.message}`);
    }
  }

  console.log(`[${WORKER_NAME}] Complete — total upserted=${totalUpserted} skipped=${totalSkipped}`);
}

export async function startAprVicidialSyncWorker(): Promise<void> {
  await runAprSync(1).catch(err =>
    console.error(`[${WORKER_NAME}] Startup sync failed:`, err.message)
  );

  const SYNC_INTERVAL_MS = 60 * 60 * 1000;
  console.log(`[${WORKER_NAME}] Scheduled hourly sync (every 60 min)`);
  intervalRef = setInterval(
    () => runAprSync(0).catch(err =>
      console.error(`[${WORKER_NAME}] Hourly sync error:`, err.message)
    ),
    SYNC_INTERVAL_MS
  );
}

export function stopAprVicidialSyncWorker(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  for (const pool of serverPools.values()) {
    pool.end().catch(() => {});
  }
  serverPools.clear();
  console.log(`[${WORKER_NAME}] Stopped`);
}
