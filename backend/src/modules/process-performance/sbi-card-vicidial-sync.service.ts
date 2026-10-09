/**
 * SBI Card ViciDial → mas_hrms live sync.
 *
 * Reads from the asterisk (ViciDial) database at 172.22.15.3 and upserts into:
 *   sbi_card_dialer_mis   — per-campaign per-day totals
 *   sbi_card_agent_mis    — per-agent per-day totals
 *   sbi_card_agent_time   — per-agent per-day APR time breakdown
 *   sbi_card_roster       — agent ↔ employee ↔ team mapping
 *
 * Disposition flags are resolved in ViciDial order: campaign-level override first,
 * then global statuses table, same as the SBI_Collections app provider does.
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { vicidialQuery, testVicidialConnection } from "../../db/sbiVicidialDb.js";

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

async function getProcessId(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE process_code = 'SBI_CARD' AND active_status = 1 LIMIT 1`,
  );
  return (rows[0]?.id as string) ?? null;
}

// ──────────────────────────────────────────────
// 1. DIALER MIS  (per campaign per day)
// ──────────────────────────────────────────────
async function syncDialerMis(processId: string, from: string, to: string): Promise<number> {
  type CampRow = RowDataPacket & {
    campaign: string; report_date: string;
    dials: number; answers: number; connects: number; total_contacts: number;
    accounts_called: number; accounts_scheduled: number;
    ptp: number; pad: number; otp: number; aborts: number;
    disp: number; wn: number; nc: number; au: number; voml: number;
    ct: number; tc: number; ews: number; ws: number; ds: number;
    bctp: number; dptp: number; wh: number; lb: number; tcbl: number;
    tpc: number; rtp: number; cbl: number;
    total_promises: number; total_calls: number;
  };

  // Per-campaign per-day aggregates from vicidial_log + status flags
  const rows = await vicidialQuery<CampRow>(`
    SELECT
      vl.campaign_id                                                        AS campaign,
      DATE(vl.call_date)                                                    AS report_date,
      COUNT(*)                                                              AS dials,
      SUM(IFNULL(vcs.human_answered, vs.human_answered) = 'Y')             AS answers,
      SUM(IFNULL(vcs.human_answered, vs.human_answered) = 'Y'
          AND val.talk_sec > 0)                                             AS connects,
      SUM(IFNULL(vcs.customer_contact, vs.customer_contact) = 'Y')        AS total_contacts,
      COUNT(DISTINCT vl.lead_id)                                            AS accounts_called,
      SUM(vl.status = 'PTP')   AS ptp,
      SUM(vl.status = 'PAD')   AS pad,
      SUM(vl.status = 'OTP')   AS otp,
      SUM(vl.term_reason = 'ABANDON') AS aborts,
      SUM(vl.status = 'DISP')  AS disp,
      SUM(vl.status = 'WN')    AS wn,
      SUM(vl.status = 'NC')    AS nc,
      SUM(vl.status = 'AU')    AS au,
      SUM(vl.status = 'VOML')  AS voml,
      SUM(vl.status = 'CT')    AS ct,
      SUM(vl.status = 'TC')    AS tc,
      SUM(vl.status = 'EWS')   AS ews,
      SUM(vl.status = 'WS')    AS ws,
      SUM(vl.status = 'DS')    AS ds,
      SUM(vl.status = 'BCTP')  AS bctp,
      SUM(vl.status = 'DPTP')  AS dptp,
      SUM(vl.status = 'WH')    AS wh,
      SUM(vl.status = 'LB')    AS lb,
      SUM(vl.status = 'TCBL')  AS tcbl,
      SUM(vl.status = 'TPC')   AS tpc,
      SUM(vl.status = 'RTP')   AS rtp,
      SUM(vl.status = 'CBL')   AS cbl,
      SUM(vl.status IN ('PTP','PAD','OTP','CPU')) AS total_promises,
      COUNT(*) AS total_calls
    FROM vicidial_log vl
    LEFT JOIN vicidial_statuses vs
           ON vs.status = vl.status
    LEFT JOIN vicidial_campaign_statuses vcs
           ON vcs.campaign_id = vl.campaign_id AND vcs.status = vl.status
    LEFT JOIN vicidial_agent_log val
           ON val.uniqueid = vl.uniqueid AND val.user = vl.user
    WHERE DATE(vl.call_date) BETWEEN ? AND ?
      AND vl.user != 'VDAD'
      AND vl.campaign_id != ''
    GROUP BY vl.campaign_id, DATE(vl.call_date)
  `, [from, to]);

  // Accounts scheduled: leads in the dialer list for each campaign loaded on that date
  type SchedRow = RowDataPacket & { campaign_id: string; report_date: string; scheduled: number };
  const schedRows = await vicidialQuery<SchedRow>(`
    SELECT ls.campaign_id, DATE(ls.list_changedate) AS report_date, COUNT(DISTINCT ll.lead_id) AS scheduled
    FROM vicidial_lists ls
    JOIN vicidial_list ll ON ll.list_id = ls.list_id
    WHERE DATE(ls.list_changedate) BETWEEN ? AND ?
    GROUP BY ls.campaign_id, DATE(ls.list_changedate)
  `, [from, to]);
  const schedMap = new Map<string, number>();
  for (const r of schedRows) schedMap.set(`${r.campaign_id}|${r.report_date}`, Number(r.scheduled));

  let count = 0;
  for (const r of rows) {
    const scheduled = schedMap.get(`${r.campaign}|${r.report_date}`) ?? 0;
    await db.execute(`
      INSERT INTO sbi_card_dialer_mis
        (id, process_id, report_date, campaign, is_rollup,
         total_accounts, accounts_scheduled, accounts_called,
         dials, answers, connects, aborts, drop_calls,
         ptp, pad, otp, disp, wn, nc, au, voml, ct, tc, ews, ws, ds,
         bctp, dptp, wh, lb, tcbl, tpc, rtp, cbl,
         total_calls, total_contacts, total_promises,
         data_source)
      VALUES (UUID(), ?, ?, ?, 0,
              ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?,
              'vicidial_sync')
      ON DUPLICATE KEY UPDATE
        total_accounts      = VALUES(total_accounts),
        accounts_scheduled  = VALUES(accounts_scheduled),
        accounts_called     = VALUES(accounts_called),
        dials               = VALUES(dials),
        answers             = VALUES(answers),
        connects            = VALUES(connects),
        aborts              = VALUES(aborts),
        drop_calls          = VALUES(drop_calls),
        ptp                 = VALUES(ptp),
        pad                 = VALUES(pad),
        otp                 = VALUES(otp),
        disp                = VALUES(disp),
        wn                  = VALUES(wn),
        nc                  = VALUES(nc),
        au                  = VALUES(au),
        voml                = VALUES(voml),
        ct                  = VALUES(ct),
        tc                  = VALUES(tc),
        ews                 = VALUES(ews),
        ws                  = VALUES(ws),
        ds                  = VALUES(ds),
        bctp                = VALUES(bctp),
        dptp                = VALUES(dptp),
        wh                  = VALUES(wh),
        lb                  = VALUES(lb),
        tcbl                = VALUES(tcbl),
        tpc                 = VALUES(tpc),
        rtp                 = VALUES(rtp),
        cbl                 = VALUES(cbl),
        total_calls         = VALUES(total_calls),
        total_contacts      = VALUES(total_contacts),
        total_promises      = VALUES(total_promises),
        data_source         = 'vicidial_sync',
        updated_at          = NOW()
    `, [
      processId, r.report_date, r.campaign,
      scheduled, scheduled, Number(r.accounts_called),
      Number(r.dials), Number(r.answers), Number(r.connects), Number(r.aborts), Number(r.aborts),
      Number(r.ptp), Number(r.pad), Number(r.otp),
      Number(r.disp), Number(r.wn), Number(r.nc), Number(r.au), Number(r.voml),
      Number(r.ct), Number(r.tc), Number(r.ews), Number(r.ws), Number(r.ds),
      Number(r.bctp), Number(r.dptp), Number(r.wh), Number(r.lb), Number(r.tcbl),
      Number(r.tpc), Number(r.rtp), Number(r.cbl),
      Number(r.total_calls), Number(r.total_contacts), Number(r.total_promises),
    ]);
    count++;
  }
  return count;
}

// ──────────────────────────────────────────────
// 2. AGENT MIS  (per agent per day)
// ──────────────────────────────────────────────
async function syncAgentMis(processId: string, from: string, to: string): Promise<number> {
  type ARow = RowDataPacket & {
    dialer_id: string; report_date: string; calls: number; contacts: number;
    ptp: number; pad: number; total_promises: number; no_promise: number;
    tos_sec: number; talk_sec: number; wrap_sec: number; idle_sec: number;
  };
  type LoginRow = RowDataPacket & { dialer_id: string; report_date: string; first_login: string | null; last_logout: string | null };
  type UserRow = RowDataPacket & { user: string; full_name: string; user_group: string };

  const [callRows, loginRows, userRows] = await Promise.all([
    vicidialQuery<ARow>(`
      SELECT
        vl.user                                                                   AS dialer_id,
        DATE(vl.call_date)                                                        AS report_date,
        COUNT(*)                                                                   AS calls,
        SUM(IFNULL(vcs.customer_contact, vs.customer_contact) = 'Y')              AS contacts,
        SUM(vl.status = 'PTP')                                                    AS ptp,
        SUM(vl.status = 'PAD')                                                    AS pad,
        SUM(vl.status IN ('PTP','PAD','OTP','CPU'))                               AS total_promises,
        SUM(IFNULL(vcs.customer_contact, vs.customer_contact) != 'Y'
            AND vl.status NOT IN ('PTP','PAD','OTP','CPU','DROP'))                AS no_promise,
        COALESCE(SUM(val.wait_sec + val.talk_sec + val.dispo_sec), 0)             AS tos_sec,
        COALESCE(SUM(val.talk_sec), 0)                                            AS talk_sec,
        COALESCE(SUM(val.dispo_sec), 0)                                           AS wrap_sec,
        COALESCE(SUM(val.wait_sec), 0)                                            AS idle_sec
      FROM vicidial_log vl
      LEFT JOIN vicidial_statuses vs
             ON vs.status = vl.status
      LEFT JOIN vicidial_campaign_statuses vcs
             ON vcs.campaign_id = vl.campaign_id AND vcs.status = vl.status
      LEFT JOIN vicidial_agent_log val
             ON val.uniqueid = vl.uniqueid AND val.user = vl.user
      WHERE DATE(vl.call_date) BETWEEN ? AND ?
        AND vl.user != 'VDAD'
      GROUP BY vl.user, DATE(vl.call_date)
    `, [from, to]),
    vicidialQuery<LoginRow>(`
      SELECT
        user                                                        AS dialer_id,
        DATE(event_date)                                            AS report_date,
        TIME(MIN(CASE WHEN event = 'LOGIN'  THEN event_date END))  AS first_login,
        TIME(MAX(CASE WHEN event = 'LOGOUT' THEN event_date END))  AS last_logout
      FROM vicidial_user_log
      WHERE DATE(event_date) BETWEEN ? AND ?
      GROUP BY user, DATE(event_date)
    `, [from, to]),
    vicidialQuery<UserRow>(`SELECT user, full_name, user_group FROM vicidial_users`),
  ]);

  const loginMap = new Map<string, { first: string | null; last: string | null }>();
  for (const r of loginRows) loginMap.set(`${r.dialer_id}|${r.report_date}`, { first: r.first_login, last: r.last_logout });

  const userMap = new Map<string, { name: string; group: string }>();
  for (const u of userRows) userMap.set(u.user, { name: u.full_name, group: u.user_group });

  let count = 0;
  for (const r of callRows) {
    const login = loginMap.get(`${r.dialer_id}|${r.report_date}`);
    const user = userMap.get(r.dialer_id);
    // Leakage = seconds after target time (09:00:00) on first login
    let leakage = 0;
    if (login?.first) {
      const [h, m, s] = login.first.split(":").map(Number);
      const loginSec = h * 3600 + m * 60 + (s || 0);
      leakage = Math.max(0, loginSec - 9 * 3600);
    }
    await db.execute(`
      INSERT INTO sbi_card_agent_mis
        (id, process_id, report_date, employee_id, dialer_id, agent_name, team,
         first_login_time, target_time, last_logout_time, leakage_seconds,
         calls, contacts, ptp, pad, total_promises, no_promise,
         tos_hours, talk_hours, wrap_hours, idle_hours, data_source)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?,
              ?, '09:00:00', ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, 'vicidial_sync')
      ON DUPLICATE KEY UPDATE
        agent_name       = VALUES(agent_name),
        team             = VALUES(team),
        first_login_time = VALUES(first_login_time),
        last_logout_time = VALUES(last_logout_time),
        leakage_seconds  = VALUES(leakage_seconds),
        calls            = VALUES(calls),
        contacts         = VALUES(contacts),
        ptp              = VALUES(ptp),
        pad              = VALUES(pad),
        total_promises   = VALUES(total_promises),
        no_promise       = VALUES(no_promise),
        tos_hours        = VALUES(tos_hours),
        talk_hours       = VALUES(talk_hours),
        wrap_hours       = VALUES(wrap_hours),
        idle_hours       = VALUES(idle_hours),
        data_source      = 'vicidial_sync',
        updated_at       = NOW()
    `, [
      processId, r.report_date,
      r.dialer_id,   // use dialer_id as employee_id fallback until roster maps it
      r.dialer_id,
      user?.name ?? null,
      user?.group ?? null,
      login?.first ?? null,
      login?.last ?? null,
      leakage,
      Number(r.calls), Number(r.contacts), Number(r.ptp), Number(r.pad),
      Number(r.total_promises), Number(r.no_promise),
      Number(r.tos_sec) / 3600, Number(r.talk_sec) / 3600,
      Number(r.wrap_sec) / 3600, Number(r.idle_sec) / 3600,
    ]);
    count++;
  }
  return count;
}

// ──────────────────────────────────────────────
// 3. AGENT TIME / APR  (per agent per day)
// ──────────────────────────────────────────────
async function syncAgentTime(processId: string, from: string, to: string): Promise<number> {
  type TRow = RowDataPacket & {
    dialer_id: string; report_date: string; calls: number;
    login_sec: number; wait_sec: number; talk_sec: number; dispo_sec: number;
    pause_sec: number; dead_sec: number; acht_sec: number;
    lb_sec: number; tb_sec: number; wb_sec: number; mb_sec: number; qb_sec: number; login_code_sec: number;
  };
  type LoginRow = RowDataPacket & { dialer_id: string; report_date: string; first_login: string | null; last_logout: string | null };
  type UserRow = RowDataPacket & { user: string; full_name: string };

  const [timeRows, loginRows, userRows] = await Promise.all([
    vicidialQuery<TRow>(`
      SELECT
        user                                                        AS dialer_id,
        DATE(event_time)                                            AS report_date,
        COUNT(DISTINCT NULLIF(uniqueid,''))                         AS calls,
        SUM(pause_sec + wait_sec + talk_sec + dispo_sec)           AS login_sec,
        SUM(wait_sec)                                               AS wait_sec,
        SUM(talk_sec)                                               AS talk_sec,
        SUM(dispo_sec)                                              AS dispo_sec,
        SUM(pause_sec)                                              AS pause_sec,
        SUM(IFNULL(dead_sec,0))                                    AS dead_sec,
        CASE WHEN SUM(CASE WHEN uniqueid != '' THEN 1 ELSE 0 END) > 0
             THEN SUM(talk_sec + dispo_sec) / SUM(CASE WHEN uniqueid != '' THEN 1 ELSE 0 END)
             ELSE NULL END                                          AS acht_sec,
        SUM(CASE WHEN sub_status IN ('LB','TLFB','ETB')  THEN pause_sec ELSE 0 END) AS lb_sec,
        SUM(CASE WHEN sub_status IN ('BTS','CMFB','MTB') THEN pause_sec ELSE 0 END) AS tb_sec,
        SUM(CASE WHEN sub_status IN ('FW','NW')          THEN pause_sec ELSE 0 END) AS wb_sec,
        SUM(CASE WHEN sub_status IN ('SB','TD')          THEN pause_sec ELSE 0 END) AS mb_sec,
        SUM(CASE WHEN sub_status IN ('NTD','QTB')        THEN pause_sec ELSE 0 END) AS qb_sec,
        SUM(CASE WHEN sub_status IS NULL AND pause_sec > 0 THEN pause_sec ELSE 0 END) AS login_code_sec
      FROM vicidial_agent_log
      WHERE DATE(event_time) BETWEEN ? AND ?
        AND user != 'VDAD'
      GROUP BY user, DATE(event_time)
    `, [from, to]),
    vicidialQuery<LoginRow>(`
      SELECT user AS dialer_id, DATE(event_date) AS report_date,
             TIME(MIN(CASE WHEN event = 'LOGIN'  THEN event_date END)) AS first_login,
             TIME(MAX(CASE WHEN event = 'LOGOUT' THEN event_date END)) AS last_logout
      FROM vicidial_user_log
      WHERE DATE(event_date) BETWEEN ? AND ?
      GROUP BY user, DATE(event_date)
    `, [from, to]),
    vicidialQuery<UserRow>(`SELECT user, full_name FROM vicidial_users`),
  ]);

  const loginMap = new Map<string, { first: string | null; last: string | null }>();
  for (const r of loginRows) loginMap.set(`${r.dialer_id}|${r.report_date}`, { first: r.first_login, last: r.last_logout });
  const nameMap = new Map<string, string>();
  for (const u of userRows) nameMap.set(u.user, u.full_name);

  let count = 0;
  for (const r of timeRows) {
    const login = loginMap.get(`${r.dialer_id}|${r.report_date}`);
    await db.execute(`
      INSERT INTO sbi_card_agent_time
        (id, process_id, report_date, employee_id, agent_name, calls,
         login_sec, wait_sec, talk_sec, dispo_sec, pause_sec, dead_sec, acht_sec,
         first_login_time, last_logout_time,
         pause_lb_sec, pause_tb_sec, pause_wb_sec, pause_mb_sec, pause_qb_sec, pause_login_sec,
         data_source)
      VALUES (UUID(), ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?,
              ?, ?,
              ?, ?, ?, ?, ?, ?,
              'vicidial_sync')
      ON DUPLICATE KEY UPDATE
        agent_name       = VALUES(agent_name),
        calls            = VALUES(calls),
        login_sec        = VALUES(login_sec),
        wait_sec         = VALUES(wait_sec),
        talk_sec         = VALUES(talk_sec),
        dispo_sec        = VALUES(dispo_sec),
        pause_sec        = VALUES(pause_sec),
        dead_sec         = VALUES(dead_sec),
        acht_sec         = VALUES(acht_sec),
        first_login_time = VALUES(first_login_time),
        last_logout_time = VALUES(last_logout_time),
        pause_lb_sec     = VALUES(pause_lb_sec),
        pause_tb_sec     = VALUES(pause_tb_sec),
        pause_wb_sec     = VALUES(pause_wb_sec),
        pause_mb_sec     = VALUES(pause_mb_sec),
        pause_qb_sec     = VALUES(pause_qb_sec),
        pause_login_sec  = VALUES(pause_login_sec),
        data_source      = 'vicidial_sync',
        updated_at       = NOW()
    `, [
      processId, r.report_date, r.dialer_id, nameMap.get(r.dialer_id) ?? null,
      Number(r.calls), Number(r.login_sec), Number(r.wait_sec), Number(r.talk_sec),
      Number(r.dispo_sec), Number(r.pause_sec), Number(r.dead_sec),
      r.acht_sec != null ? Math.round(Number(r.acht_sec)) : null,
      login?.first ?? null, login?.last ?? null,
      Number(r.lb_sec), Number(r.tb_sec), Number(r.wb_sec),
      Number(r.mb_sec), Number(r.qb_sec), Number(r.login_code_sec),
    ]);
    count++;
  }
  return count;
}

// ──────────────────────────────────────────────
// 4. ROSTER  (all agents from ViciDial, merged with agent_roster if it exists)
// ──────────────────────────────────────────────
async function syncRoster(processId: string): Promise<number> {
  type RosterRow = RowDataPacket & {
    user: string; full_name: string; user_group: string;
    employee_id: string | null; gh: string | null; tl_name: string | null; team: string | null; shift_start: string | null;
  };

  // Try to join with agent_roster; fall back to vicidial_users only if it doesn't exist
  let rows: RosterRow[];
  try {
    rows = await vicidialQuery<RosterRow>(`
      SELECT
        vu.user, vu.full_name, vu.user_group,
        ar.employee_id, ar.gh, ar.tl_name AS tl_name,
        ar.team, ar.shift_start
      FROM vicidial_users vu
      LEFT JOIN agent_roster ar ON ar.user = vu.user
      WHERE vu.user != 'VDAD' AND vu.user_level >= 1
    `);
  } catch {
    // agent_roster doesn't exist — use only vicidial_users
    rows = await vicidialQuery<RosterRow>(`
      SELECT user, full_name, user_group, NULL AS employee_id, NULL AS gh, NULL AS tl_name, NULL AS team, NULL AS shift_start
      FROM vicidial_users WHERE user != 'VDAD' AND user_level >= 1
    `);
  }

  let count = 0;
  for (const r of rows) {
    await db.execute(`
      INSERT INTO sbi_card_roster
        (id, process_id, dialer_id, employee_id, agent_name, gh, team, team_leader, mode, data_source)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NULL, 'vicidial_sync')
      ON DUPLICATE KEY UPDATE
        employee_id  = COALESCE(VALUES(employee_id), employee_id),
        agent_name   = VALUES(agent_name),
        gh           = VALUES(gh),
        team         = VALUES(team),
        team_leader  = VALUES(team_leader),
        data_source  = 'vicidial_sync',
        updated_at   = NOW()
    `, [
      processId, r.user,
      r.employee_id ?? null,
      r.full_name ?? null,
      r.gh ?? null,
      r.team ?? r.user_group ?? null,
      r.tl_name ?? null,
    ]);
    count++;
  }
  return count;
}

// ──────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────
export interface SyncResult {
  date: string;
  rowsDialerMis: number;
  rowsAgentMis: number;
  rowsAgentTime: number;
  rowsRoster: number;
  durationMs: number;
  error?: string;
}

/** Sync a single calendar date (or today if omitted). Caller passes processId to avoid re-querying. */
export async function syncSbiCardDate(
  date: string,
  processId: string,
  triggeredBy: string | null = null,
): Promise<SyncResult> {
  const logId = randomUUID();
  const start = Date.now();
  try {
    await db.execute(
      `INSERT IGNORE INTO sbi_card_live_sync_log (id, process_id, sync_date, trigger_source, triggered_by, status)
       VALUES (?, ?, ?, 'manual', ?, 'running')`,
      [logId, processId, date, triggeredBy],
    );
  } catch { /* table may not exist yet */ }

  let rowsDialer = 0, rowsAgent = 0, rowsTime = 0, rowsRoster = 0;
  try {
    [rowsDialer, rowsAgent, rowsTime, rowsRoster] = await Promise.all([
      syncDialerMis(processId, date, date),
      syncAgentMis(processId, date, date),
      syncAgentTime(processId, date, date),
      syncRoster(processId),
    ]);
    // Back-fill employee_id from roster into agent_mis for this date
    await db.execute(`
      UPDATE sbi_card_agent_mis am
      JOIN sbi_card_roster ro ON ro.process_id = am.process_id AND ro.dialer_id = am.dialer_id
      SET am.employee_id  = ro.employee_id,
          am.team         = COALESCE(ro.team, am.team),
          am.team_leader  = COALESCE(ro.team_leader, am.team_leader)
      WHERE am.process_id = ? AND am.report_date = ? AND ro.employee_id IS NOT NULL
    `, [processId, date]);

    try {
      await db.execute(
        `UPDATE sbi_card_live_sync_log SET status='ok', rows_dialer_mis=?, rows_agent_mis=?,
         rows_agent_time=?, rows_roster=?, finished_at=NOW() WHERE id=?`,
        [rowsDialer, rowsAgent, rowsTime, rowsRoster, logId],
      );
    } catch { /* ok */ }
    return { date, rowsDialerMis: rowsDialer, rowsAgentMis: rowsAgent, rowsAgentTime: rowsTime, rowsRoster, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await db.execute(`UPDATE sbi_card_live_sync_log SET status='error', error_message=?, finished_at=NOW() WHERE id=?`, [msg, logId]);
    } catch { /* ok */ }
    return { date, rowsDialerMis: rowsDialer, rowsAgentMis: rowsAgent, rowsAgentTime: rowsTime, rowsRoster, durationMs: Date.now() - start, error: msg };
  }
}

/** Sync a date range. */
export async function syncSbiCardRange(from: string, to: string, triggeredBy: string | null = null): Promise<SyncResult[]> {
  const pid = await getProcessId();
  if (!pid) throw new Error("SBI_CARD process not found in process_master");
  const results: SyncResult[] = [];
  const d = new Date(from + "T00:00:00+05:30");
  const end = new Date(to + "T00:00:00+05:30");
  while (d <= end) {
    results.push(await syncSbiCardDate(isoDate(d), pid, triggeredBy));
    d.setDate(d.getDate() + 1);
  }
  return results;
}

export { testVicidialConnection, getProcessId };
