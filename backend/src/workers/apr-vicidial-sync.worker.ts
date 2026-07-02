import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import mysql from 'mysql2/promise';

const WORKER_NAME = 'apr-vicidial-sync';

// All vicidial_agent_log_* tables in dialer_db
// event_time is stored in IST (DB server timezone = IST)
const VICIDIAL_TABLES = [
  'vicidial_agent_log_10_25',
  'vicidial_agent_log_10_4',
  'vicidial_agent_log_11_4',
  'vicidial_agent_log_11_5',
  'vicidial_agent_log_247',
  'vicidial_agent_log_249',
  'vicidial_agent_log_250',
  'vicidial_agent_log_9',
];

function secsToTime(s: number): string {
  s = Math.max(0, Math.floor(s || 0));
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// event_time is IST — query directly with BETWEEN on IST date range (index-friendly)
function buildAggQuery(tableName: string): string {
  return `
    SELECT
      DATE(event_time)                                                 AS ReportDate,
      user                                                             AS UserID,
      campaign_id,
      COUNT(DISTINCT CASE WHEN status IN ('INCALL','CBHOLD','XFER')
                          THEN agent_log_id END)                      AS Calls,
      SUM(wait_sec)                                                    AS wait_sec,
      SUM(talk_sec)                                                    AS talk_sec,
      SUM(dispo_sec)                                                   AS dispo_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'LB'
               THEN pause_sec ELSE 0 END)                             AS LUNCH_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'TB'
               THEN pause_sec ELSE 0 END)                             AS BIO_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status IN ('WB','MB')
               THEN pause_sec ELSE 0 END)                             AS TRAINING_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'DISMX'
               THEN pause_sec ELSE 0 END)                             AS DISMX_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'QB'
               THEN pause_sec ELSE 0 END)                             AS QA_sec,
      SUM(CASE WHEN status = 'PAUSED' AND sub_status = 'LOGIN'
               THEN pause_sec ELSE 0 END)                             AS LOGIN_sec,
      SUM(CASE WHEN status = 'PAUSED'
               THEN pause_sec ELSE 0 END)                             AS PAUSE_sec,
      TIME(MIN(event_time))                                            AS Login_Time,
      TIME(MAX(CASE WHEN status IN ('LOGOUT','PAUSE')
                    THEN event_time END))                              AS Logout_Time
    FROM ${tableName}
    WHERE event_time >= ? AND event_time < ?
      AND user NOT IN ('VDAD','VDCL')
    GROUP BY DATE(event_time), user, campaign_id
    HAVING Calls > 0 OR PAUSE_sec > 0 OR wait_sec > 0
  `;
}

let dialerDb: mysql.Connection | null = null;

async function getDialerDb(): Promise<mysql.Connection> {
  if (dialerDb) {
    try {
      await (dialerDb as any).ping();
      return dialerDb;
    } catch {
      dialerDb = null;
    }
  }
  dialerDb = await mysql.createConnection({
    host:            process.env.DIALER_DB_HOST     || '192.168.10.6',
    user:            process.env.DIALER_DB_USER     || process.env.DB_USER || 'shivam_user',
    password:        process.env.DIALER_DB_PASSWORD || process.env.DB_PASS || 'qwersdfg!@#hjk',
    database:        'dialer_db',
    timezone:        '+05:30',   // vicidial stores IST — tell mysql2 not to shift
    connectTimeout:  30000,
  });
  return dialerDb;
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

  // Also index by employee_code as fallback
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

async function syncForDate(istDate: string): Promise<{ upserted: number; skipped: number }> {
  const ddb = await getDialerDb();
  const enrichMap = await loadEnrichmentMap();

  // IST date range: 'YYYY-MM-DD 00:00:00' to 'YYYY-MM-DD+1 00:00:00'
  const dateFrom = `${istDate} 00:00:00`;
  const dateTo   = new Date(new Date(istDate).getTime() + 86400000)
    .toISOString().slice(0, 10) + ' 00:00:00';

  // Collect & merge aggregated rows from all source tables
  type AggRow = {
    Calls: number; wait_sec: number; talk_sec: number; dispo_sec: number;
    PAUSE_sec: number; LUNCH_sec: number; BIO_sec: number;
    TRAINING_sec: number; DISMX_sec: number; QA_sec: number; LOGIN_sec: number;
    Login_Time: string | null; Logout_Time: string | null;
  };
  const rowMap = new Map<string, AggRow>();

  const query = buildAggQuery('?table?'); // template — replaced per table below
  for (const tbl of VICIDIAL_TABLES) {
    let rows: any[];
    try {
      const q = buildAggQuery(tbl);
      const [r] = await ddb.execute(q, [dateFrom, dateTo]);
      rows = r as any[];
    } catch (err: any) {
      console.warn(`[${WORKER_NAME}] Skipped ${tbl}: ${err.message}`);
      continue;
    }
    if (!rows.length) continue;
    console.log(`[${WORKER_NAME}]   ${tbl}: ${rows.length} rows`);

    for (const r of rows) {
      const key = `${istDate}|${r.UserID}|${r.campaign_id}`;
      const e = rowMap.get(key);
      if (!e) {
        rowMap.set(key, {
          Calls:        +r.Calls      || 0,
          wait_sec:     +r.wait_sec   || 0,
          talk_sec:     +r.talk_sec   || 0,
          dispo_sec:    +r.dispo_sec  || 0,
          PAUSE_sec:    +r.PAUSE_sec  || 0,
          LUNCH_sec:    +r.LUNCH_sec  || 0,
          BIO_sec:      +r.BIO_sec    || 0,
          TRAINING_sec: +r.TRAINING_sec || 0,
          DISMX_sec:    +r.DISMX_sec  || 0,
          QA_sec:       +r.QA_sec     || 0,
          LOGIN_sec:    +r.LOGIN_sec  || 0,
          Login_Time:   r.Login_Time  ? String(r.Login_Time)  : null,
          Logout_Time:  r.Logout_Time ? String(r.Logout_Time) : null,
        });
      } else {
        e.Calls        += +r.Calls      || 0;
        e.wait_sec     += +r.wait_sec   || 0;
        e.talk_sec     += +r.talk_sec   || 0;
        e.dispo_sec    += +r.dispo_sec  || 0;
        e.PAUSE_sec    += +r.PAUSE_sec  || 0;
        e.LUNCH_sec    += +r.LUNCH_sec  || 0;
        e.BIO_sec      += +r.BIO_sec    || 0;
        e.TRAINING_sec += +r.TRAINING_sec || 0;
        e.DISMX_sec    += +r.DISMX_sec  || 0;
        e.QA_sec       += +r.QA_sec     || 0;
        e.LOGIN_sec    += +r.LOGIN_sec  || 0;
        if (r.Login_Time && (!e.Login_Time || r.Login_Time < e.Login_Time))
          e.Login_Time  = String(r.Login_Time);
        if (r.Logout_Time && (!e.Logout_Time || r.Logout_Time > e.Logout_Time))
          e.Logout_Time = String(r.Logout_Time);
      }
    }
  }

  let upserted = 0;
  let skipped  = 0;

  for (const [key, agg] of rowMap) {
    const [, userId, campaignId] = key.split('|');
    const netLogin = agg.wait_sec + agg.talk_sec + agg.dispo_sec + agg.PAUSE_sec;
    const ahtSec   = agg.Calls > 0
      ? Math.round((agg.talk_sec + agg.dispo_sec) / agg.Calls) : 0;

    const enrich = enrichMap.get(userId.toUpperCase()) || {
      employee_name: '', process_name: '', branch_name: '',
      reporting_manager: '', cost_centre: '',
    };

    try {
      await db.execute(
        `INSERT INTO apr
           (ReportDate, UserID, campaign_id,
            Calls, WAIT_TIME, TALK_TIME, DISPO_TIME, PAUSE_TIME, AHT,
            Login_Time, Logout_Time, Net_Login,
            LOGIN, BIO, LUNCH, QA, DISMX, TRAINING,
            employee_name, process_name, branch_name, reporting_manager, cost_centre)
         VALUES (?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           Calls             = VALUES(Calls),
           WAIT_TIME         = VALUES(WAIT_TIME),
           TALK_TIME         = VALUES(TALK_TIME),
           DISPO_TIME        = VALUES(DISPO_TIME),
           PAUSE_TIME        = VALUES(PAUSE_TIME),
           AHT               = VALUES(AHT),
           Login_Time        = VALUES(Login_Time),
           Logout_Time       = VALUES(Logout_Time),
           Net_Login         = VALUES(Net_Login),
           LOGIN             = VALUES(LOGIN),
           BIO               = VALUES(BIO),
           LUNCH             = VALUES(LUNCH),
           QA                = VALUES(QA),
           DISMX             = VALUES(DISMX),
           TRAINING          = VALUES(TRAINING),
           employee_name     = VALUES(employee_name),
           process_name      = VALUES(process_name),
           branch_name       = VALUES(branch_name),
           reporting_manager = VALUES(reporting_manager),
           cost_centre       = VALUES(cost_centre)`,
        [
          istDate, userId, campaignId,
          agg.Calls,
          secsToTime(agg.wait_sec),
          secsToTime(agg.talk_sec),
          secsToTime(agg.dispo_sec),
          secsToTime(agg.PAUSE_sec),
          secsToTime(ahtSec),
          agg.Login_Time  || '00:00:00',
          agg.Logout_Time || '00:00:00',
          secsToTime(netLogin),
          secsToTime(agg.LOGIN_sec),
          secsToTime(agg.BIO_sec),
          secsToTime(agg.LUNCH_sec),
          secsToTime(agg.QA_sec),
          secsToTime(agg.DISMX_sec),
          secsToTime(agg.TRAINING_sec),
          enrich.employee_name     || '',
          enrich.process_name      || '',
          enrich.branch_name       || '',
          enrich.reporting_manager || '',
          enrich.cost_centre       || '',
        ]
      );
      upserted++;
    } catch (err: any) {
      console.warn(`[${WORKER_NAME}] Upsert failed ${key}: ${err.message}`);
      skipped++;
    }
  }

  return { upserted, skipped };
}

async function runAprSync(daysBack = 1): Promise<void> {
  // IST today
  const nowIST  = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
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
      totalSkipped  += skipped;
    } catch (err: any) {
      console.error(`[${WORKER_NAME}] Error on ${date}: ${err.message}`);
    }
  }

  console.log(`[${WORKER_NAME}] Complete — total upserted=${totalUpserted} skipped=${totalSkipped}`);
}

export async function startAprVicidialSyncWorker(): Promise<void> {
  // Run on startup for today + yesterday
  await runAprSync(1).catch(err =>
    console.error(`[${WORKER_NAME}] Startup sync failed:`, err.message)
  );

  // Schedule daily at 01:30 IST = 20:00 UTC (after midnight, daily data is complete)
  const scheduleNext = () => {
    const now    = new Date();
    const target = new Date(now);
    target.setUTCHours(20, 0, 0, 0);
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    const delay = target.getTime() - now.getTime();
    console.log(`[${WORKER_NAME}] Next sync at ${target.toISOString()} (${Math.round(delay / 60000)} min)`);
    setTimeout(() => {
      runAprSync(1).catch(err =>
        console.error(`[${WORKER_NAME}] Scheduled sync error:`, err.message)
      );
      setInterval(
        () => runAprSync(1).catch(err =>
          console.error(`[${WORKER_NAME}] Interval sync error:`, err.message)
        ),
        24 * 60 * 60 * 1000
      );
    }, delay);
  };
  scheduleNext();
}
