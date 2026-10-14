/**
 * Agent "My KPIs" dashboard — call performance for one agent (by MASID), read-only.
 *
 * Sources (all verified live 2026-10-13):
 *  - dialer_db.cdr_in_11_5  one row per inbound call; AgentId = MASID, 'VDCL' = no agent (abandoned).
 *    Indexed on CallDate only, so every query is date-bounded first.
 *  - mas_hrms.apr           daily login (Login_Time, Net_Login) keyed by UserID = MASID.
 *  - mas_hrms.employees     header: process, LOB, reporting manager, designation.
 *  - db_audit.call_quality_assessment  audited calls (CQ%, grader feedback, recording).
 *
 * Definitions mirror call-master/inbound.service.ts so the agent sees the same numbers as the
 * process dashboards: handled = AgentId = MASID and DisconnBy != 'HOLDTIME'; answered within 20s =
 * TIME_TO_SEC(QueueDuration) <= 20; SL% = within-20s / handled; AHT = avg CallDurationSecond.
 * Offered and abandoned have no agent (abandoned rows carry AgentId 'VDCL'), so they are reported
 * only as queue figures for the campaigns this agent worked — never attributed to the agent.
 */
import type { RowDataPacket } from "mysql2";
import { dialerQuery } from "../../db/dialerDb.js";
import { db } from "../../db/mysql.js";
import { cacheInstance } from "../../lib/cache/quality-cache.js";
import { CQ_SCORE_SQL, FATAL_SQL, LOW_QUALITY_GATE_SQL } from "../../lib/query-builders/quality-queries.js";

const CDR = "cdr_in_11_5";
const HANDLED = `DisconnBy != 'HOLDTIME'`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PeriodTotals = {
  handled: number;
  within_20s: number;
  sl_pct: number | null;
  aht_s: number | null;
  talk_s: number;
  avg_hold_s: number | null;
  avg_acw_s: number | null;
  login_s: number | null;
  first_login: string | null;
  days_worked: number;
};

export type QueueTotals = { offered: number; answered: number; abandoned: number; abandon_pct: number | null; agents: number };

export type CdrCall = {
  id: number;
  date: string;
  time: string;
  campaign: string;
  phone_masked: string;
  disposition: string | null;
  disconnected_by: string | null;
  queue_s: number | null;
  talk_s: number | null;
  hold_s: number | null;
  acw_s: number | null;
  duration_s: number | null;
  within_20s: boolean;
  audit: { audit_id: number; cq_pct: number | null; feedback: string | null; recording_url: string | null; scenario: string | null } | null;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const pct = (num: number, den: number) => (den > 0 ? Math.round((1000 * num) / den) / 10 : null);

export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function validDate(d: unknown): string {
  const s = typeof d === "string" ? d.trim() : "";
  if (!DATE_RE.test(s)) return istToday();
  return s > istToday() ? istToday() : s;
}

export function maskPhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 6) return digits ? "XXXX" : "—";
  const local = digits.slice(-10);
  return `${local.slice(0, 2)}XXXX${local.slice(-4)}`;
}

const monthStart = (date: string) => `${date.slice(0, 8)}01`;

async function loginFor(masid: string, from: string, to: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(TIME_TO_SEC(Net_Login)) AS login_s,
            MIN(CASE WHEN ReportDate = ? THEN Login_Time END) AS first_login,
            COUNT(*) AS days
       FROM apr WHERE UserID = ? AND ReportDate BETWEEN ? AND ?`,
    [to, masid, from, to],
  );
  const r = rows[0];
  return {
    login_s: r && n(r.days) > 0 ? n(r.login_s) : null,
    first_login: r?.first_login ? String(r.first_login).slice(0, 5) : null,
  };
}

async function campaignsWorked(masid: string, from: string, to: string): Promise<string[]> {
  const rows = await dialerQuery<RowDataPacket>(
    `SELECT DISTINCT CampaignName FROM ${CDR} WHERE CallDate BETWEEN ? AND ? AND AgentId = ? AND CampaignName IS NOT NULL`,
    [from, to, masid],
  );
  return rows.map((r) => String(r.CampaignName));
}

async function queueTotals(campaigns: string[], from: string, to: string): Promise<{ total: QueueTotals; byCampaign: Array<QueueTotals & { campaign: string }> }> {
  const empty: QueueTotals = { offered: 0, answered: 0, abandoned: 0, abandon_pct: null, agents: 0 };
  if (campaigns.length === 0) return { total: empty, byCampaign: [] };
  const rows = await dialerQuery<RowDataPacket>(
    `SELECT CampaignName AS campaign,
            SUM(${HANDLED}) AS offered,
            SUM(AgentId != 'VDCL' AND ${HANDLED}) AS answered,
            SUM(AgentId = 'VDCL' AND ${HANDLED}) AS abandoned,
            COUNT(DISTINCT CASE WHEN AgentId != 'VDCL' THEN AgentId END) AS agents
       FROM ${CDR}
      WHERE CallDate BETWEEN ? AND ? AND CampaignName IN (${campaigns.map(() => "?").join(",")})
      GROUP BY CampaignName`,
    [from, to, ...campaigns],
  );
  const byCampaign = rows.map((r) => ({
    campaign: String(r.campaign),
    offered: n(r.offered),
    answered: n(r.answered),
    abandoned: n(r.abandoned),
    abandon_pct: pct(n(r.abandoned), n(r.offered)),
    agents: n(r.agents),
  })).sort((a, b) => b.offered - a.offered);
  const offered = byCampaign.reduce((a, r) => a + r.offered, 0);
  const abandoned = byCampaign.reduce((a, r) => a + r.abandoned, 0);
  const [agentRow] = await dialerQuery<RowDataPacket>(
    `SELECT COUNT(DISTINCT AgentId) AS agents FROM ${CDR}
      WHERE CallDate BETWEEN ? AND ? AND AgentId != 'VDCL' AND CampaignName IN (${campaigns.map(() => "?").join(",")})`,
    [from, to, ...campaigns],
  );
  return {
    total: {
      offered,
      answered: byCampaign.reduce((a, r) => a + r.answered, 0),
      abandoned,
      abandon_pct: pct(abandoned, offered),
      agents: n(agentRow?.agents),
    },
    byCampaign,
  };
}

async function header(masid: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT TRIM(e.full_name) AS name, pm.process_name AS process, lm.lob_name AS team,
            TRIM(m.full_name) AS team_leader, d.designation_name AS designation
       FROM employees e
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN lob_master lm ON lm.id = e.lob_id
       LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.call_centre_code = ?
      ORDER BY e.active_status DESC LIMIT 1`,
    [masid],
  );
  let r = rows[0];
  if (!r) {
    const [byCode] = await db.execute<RowDataPacket[]>(
      `SELECT TRIM(e.full_name) AS name, pm.process_name AS process, lm.lob_name AS team,
              TRIM(m.full_name) AS team_leader, d.designation_name AS designation
         FROM employees e
         LEFT JOIN process_master pm ON pm.id = e.process_id
         LEFT JOIN lob_master lm ON lm.id = e.lob_id
         LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
         LEFT JOIN designation_master d ON d.id = e.designation_id
        WHERE e.employee_code = ?
        ORDER BY e.active_status DESC LIMIT 1`,
      [masid],
    );
    r = byCode[0];
  }
  return {
    masid,
    name: r?.name ?? null,
    process: r?.process ?? null,
    team: r?.team ?? null,
    team_leader: r?.team_leader ?? null,
    designation: r?.designation ?? null,
  };
}

const CALL_SELECT = `
  id, DATE_FORMAT(CallDate, '%Y-%m-%d') AS d, DATE_FORMAT(Time, '%H:%i:%s') AS t,
  CampaignName AS campaign, PhoneNumber AS phone, Disposition AS disposition, DisconnBy AS disconnected_by,
  TIME_TO_SEC(QueueDuration) AS queue_s, TIME_TO_SEC(Talkduration) AS talk_s, TIME_TO_SEC(HoldTime) AS hold_s,
  TIME_TO_SEC(Acwduration) AS acw_s, CAST(CallDurationSecond AS UNSIGNED) AS duration_s`;

/**
 * Attach audit results to CDR calls. The two systems do not share a call id (audit lead_id and
 * CDR LeadId are different id spaces), so match on agent + phone (last 10 digits) + same day and
 * the nearest call time within 15 minutes.
 */
async function attachAudits(masid: string, calls: Omit<CdrCall, "audit">[], rawPhones: Map<number, string>): Promise<CdrCall[]> {
  if (calls.length === 0) return [];
  const dates = [...new Set(calls.map((c) => c.date))].sort();
  const [audits] = await db.execute<RowDataPacket[]>(
    `SELECT q.id, DATE_FORMAT(q.CallDate, '%Y-%m-%d') AS d, DATE_FORMAT(q.CallDate, '%H:%i:%s') AS t,
            q.MobileNo AS phone, ROUND(${CQ_SCORE_SQL} * 100, 1) AS cq_pct,
            q.areas_for_improvement AS feedback, q.call_recording AS recording_url, q.scenario
       FROM db_audit.call_quality_assessment q
      WHERE q.User = ? AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)`,
    [masid, dates[0], dates[dates.length - 1]],
  );
  const secs = (t: string) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + (s || 0); };
  const last10 = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-10);
  const used = new Set<number>();
  return calls.map((c) => {
    const phone = last10(rawPhones.get(c.id));
    let best: RowDataPacket | null = null;
    let bestGap = 15 * 60 + 1;
    for (const a of audits) {
      if (used.has(a.id) || a.d !== c.date || !phone || last10(a.phone) !== phone) continue;
      const gap = Math.abs(secs(a.t) - secs(c.time));
      if (gap < bestGap) { best = a; bestGap = gap; }
    }
    if (!best) return { ...c, audit: null };
    used.add(best.id);
    return {
      ...c,
      audit: {
        audit_id: Number(best.id),
        cq_pct: nn(best.cq_pct),
        feedback: best.feedback ?? null,
        recording_url: best.recording_url ?? null,
        scenario: best.scenario ?? null,
      },
    };
  });
}

function toCalls(rows: RowDataPacket[]): { calls: Omit<CdrCall, "audit">[]; phones: Map<number, string> } {
  const phones = new Map<number, string>();
  const calls = rows.map((r) => {
    phones.set(Number(r.id), String(r.phone ?? ""));
    return {
      id: Number(r.id),
      date: String(r.d),
      time: String(r.t),
      campaign: String(r.campaign ?? "—"),
      phone_masked: maskPhone(r.phone),
      disposition: r.disposition ?? null,
      disconnected_by: r.disconnected_by ?? null,
      queue_s: nn(r.queue_s),
      talk_s: nn(r.talk_s),
      hold_s: nn(r.hold_s),
      acw_s: nn(r.acw_s),
      duration_s: nn(r.duration_s),
      within_20s: r.queue_s !== null && Number(r.queue_s) <= 20,
    };
  });
  return { calls, phones };
}

export type CallFilter = {
  from: string;
  to: string;
  hour?: number | null;
  campaign?: string | null;
  sl?: "in" | "out" | null;
  sort?: "time" | "duration";
  limit: number;
  offset: number;
};

export async function getAgentCalls(masid: string, f: CallFilter) {
  const where = [`CallDate BETWEEN ? AND ?`, `AgentId = ?`, HANDLED];
  const params: (string | number)[] = [f.from, f.to, masid];
  if (f.hour !== null && f.hour !== undefined) { where.push(`HOUR(HoursSlot) = ?`); params.push(f.hour); }
  if (f.campaign) { where.push(`CampaignName = ?`); params.push(f.campaign); }
  if (f.sl === "in") where.push(`TIME_TO_SEC(QueueDuration) <= 20`);
  if (f.sl === "out") where.push(`TIME_TO_SEC(QueueDuration) > 20`);
  const order = f.sort === "duration" ? `CAST(CallDurationSecond AS UNSIGNED) DESC` : `CallDate DESC, Time DESC`;
  const limit = Math.min(100, Math.max(1, Math.floor(f.limit)));
  const offset = Math.max(0, Math.floor(f.offset));

  const [countRow] = await dialerQuery<RowDataPacket>(`SELECT COUNT(*) AS total FROM ${CDR} WHERE ${where.join(" AND ")}`, params);
  const rows = await dialerQuery<RowDataPacket>(
    `SELECT ${CALL_SELECT} FROM ${CDR} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const { calls, phones } = toCalls(rows);
  return {
    total: n(countRow?.total),
    limit,
    offset,
    calls: await attachAudits(masid, calls, phones),
  };
}

/** One call, only if it belongs to this agent (AgentId check is the ownership guard). */
export async function getAgentCall(masid: string, id: number) {
  const rows = await dialerQuery<RowDataPacket>(`SELECT ${CALL_SELECT} FROM ${CDR} WHERE id = ? AND AgentId = ?`, [id, masid]);
  if (rows.length === 0) return null;
  const { calls, phones } = toCalls(rows);
  const [call] = await attachAudits(masid, calls, phones);
  return call;
}

export async function getAgentLoginDays(masid: string, from: string, to: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(ReportDate, '%Y-%m-%d') AS date, LEFT(Login_Time, 5) AS first_login,
            TIME_TO_SEC(Net_Login) AS login_s, TIME_TO_SEC(PAUSE_TIME) AS pause_s
       FROM apr WHERE UserID = ? AND ReportDate BETWEEN ? AND ? ORDER BY ReportDate DESC`,
    [masid, from, to],
  );
  return rows.map((r) => ({ date: r.date, first_login: r.first_login, login_s: nn(r.login_s), pause_s: nn(r.pause_s) }));
}

export async function getAgentQueue(masid: string, from: string, to: string) {
  const campaigns = await campaignsWorked(masid, from, to);
  return { from, to, ...(await queueTotals(campaigns, from, to)) };
}

type DayCampaignAgg = {
  d: string; campaign: string; handled: number; w20: number;
  dur_s: number; dur_n: number; talk_s: number; hold_s: number; hold_n: number; acw_s: number; acw_n: number;
};

function sumAgg(rows: DayCampaignAgg[], login?: { login_s: number | null; first_login: string | null }): PeriodTotals {
  const s = rows.reduce(
    (a, r) => ({
      handled: a.handled + r.handled, w20: a.w20 + r.w20, dur_s: a.dur_s + r.dur_s, dur_n: a.dur_n + r.dur_n,
      talk_s: a.talk_s + r.talk_s, hold_s: a.hold_s + r.hold_s, hold_n: a.hold_n + r.hold_n, acw_s: a.acw_s + r.acw_s, acw_n: a.acw_n + r.acw_n,
    }),
    { handled: 0, w20: 0, dur_s: 0, dur_n: 0, talk_s: 0, hold_s: 0, hold_n: 0, acw_s: 0, acw_n: 0 },
  );
  const avg = (sum: number, cnt: number) => (cnt > 0 ? Math.round(sum / cnt) : null);
  return {
    handled: s.handled,
    within_20s: s.w20,
    sl_pct: pct(s.w20, s.handled),
    aht_s: avg(s.dur_s, s.dur_n),
    talk_s: s.talk_s,
    avg_hold_s: avg(s.hold_s, s.hold_n),
    avg_acw_s: avg(s.acw_s, s.acw_n),
    login_s: login?.login_s ?? null,
    first_login: login?.first_login ?? null,
    days_worked: new Set(rows.map((r) => r.d)).size,
  };
}

export async function getAgentMyKpi(masid: string, rawDate: unknown) {
  const date = validDate(rawDate);
  const cacheKey = `quality:my-kpi:v2:${masid}:${date}`;
  return cacheInstance.getOrSet(cacheKey, async () => {
    const mStart = monthStart(date);
    // Window covers the month and the 14 days before the selected date, so "previous working day"
    // is found from the same scan even early in the month.
    const back14 = new Date(`${date}T00:00:00Z`);
    back14.setUTCDate(back14.getUTCDate() - 14);
    const windowStart = [mStart, back14.toISOString().slice(0, 10)].sort()[0];

    // One date-bounded scan of this agent's calls, grouped by day and campaign. Today, previous day,
    // MTD, weekly and campaign mix are all derived from these rows.
    const [aggRaw, hourlyRows, recentRows, feedbackRows] = await Promise.all([
      dialerQuery<RowDataPacket>(
        `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d') AS d, CampaignName AS campaign,
                COUNT(*) AS handled,
                SUM(TIME_TO_SEC(QueueDuration) <= 20) AS w20,
                SUM(CAST(CallDurationSecond AS UNSIGNED)) AS dur_s, COUNT(CallDurationSecond) AS dur_n,
                SUM(COALESCE(TIME_TO_SEC(Talkduration), 0)) AS talk_s,
                SUM(TIME_TO_SEC(HoldTime)) AS hold_s, COUNT(TIME_TO_SEC(HoldTime)) AS hold_n,
                SUM(TIME_TO_SEC(Acwduration)) AS acw_s, COUNT(TIME_TO_SEC(Acwduration)) AS acw_n
           FROM ${CDR}
          WHERE CallDate BETWEEN ? AND ? AND AgentId = ? AND ${HANDLED}
          GROUP BY CallDate, CampaignName`,
        [windowStart, date, masid],
      ),
      dialerQuery<RowDataPacket>(
        `SELECT HOUR(HoursSlot) AS hour, COUNT(*) AS handled, SUM(TIME_TO_SEC(QueueDuration) <= 20) AS within_20s,
                ROUND(AVG(CAST(CallDurationSecond AS UNSIGNED))) AS aht_s
           FROM ${CDR} WHERE CallDate = ? AND AgentId = ? AND ${HANDLED}
          GROUP BY HOUR(HoursSlot) ORDER BY hour`,
        [date, masid],
      ),
      dialerQuery<RowDataPacket>(
        `SELECT ${CALL_SELECT} FROM ${CDR} WHERE CallDate = ? AND AgentId = ? AND ${HANDLED}
          ORDER BY Time DESC LIMIT 10`,
        [date, masid],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT q.id, DATE_FORMAT(q.CallDate, '%Y-%m-%d %H:%i') AS at, q.Campaign AS campaign, q.scenario,
                ROUND(${CQ_SCORE_SQL} * 100, 1) AS cq_pct, q.areas_for_improvement AS feedback
           FROM db_audit.call_quality_assessment q
          WHERE q.User = ? AND q.CallDate >= DATE_SUB(?, INTERVAL 7 DAY) AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
            AND q.quality_percentage IS NOT NULL ${LOW_QUALITY_GATE_SQL}
          ORDER BY q.CallDate DESC LIMIT 10`,
        [masid, date, date],
      ).then(([r]) => r),
    ]);

    const agg: DayCampaignAgg[] = aggRaw.map((r) => ({
      d: String(r.d), campaign: String(r.campaign ?? "—"), handled: n(r.handled), w20: n(r.w20),
      dur_s: n(r.dur_s), dur_n: n(r.dur_n), talk_s: n(r.talk_s), hold_s: n(r.hold_s), hold_n: n(r.hold_n),
      acw_s: n(r.acw_s), acw_n: n(r.acw_n),
    }));
    const dayAgg = agg.filter((r) => r.d === date);
    const mtdAgg = agg.filter((r) => r.d >= mStart && r.d <= date);
    const prevDate = [...new Set(agg.filter((r) => r.d < date).map((r) => r.d))].sort().pop() ?? null;
    const prevAgg = prevDate ? agg.filter((r) => r.d === prevDate) : [];
    const dayCampaigns = [...new Set(dayAgg.map((r) => r.campaign))];
    const mtdCampaigns = [...new Set(mtdAgg.map((r) => r.campaign))];

    // One queue scan over the month for every campaign this agent worked; today's queue and the
    // team SL/AHT comparison are filtered from the same rows.
    const queueRaw = mtdCampaigns.length === 0 ? [] : await dialerQuery<RowDataPacket>(
      `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d') AS d, CampaignName AS campaign,
              SUM(${HANDLED}) AS offered,
              SUM(AgentId != 'VDCL' AND ${HANDLED}) AS answered,
              SUM(AgentId = 'VDCL' AND ${HANDLED}) AS abandoned,
              SUM(AgentId != 'VDCL' AND ${HANDLED} AND TIME_TO_SEC(QueueDuration) <= 20) AS answered_w20,
              SUM(CASE WHEN AgentId != 'VDCL' AND ${HANDLED} THEN CAST(CallDurationSecond AS UNSIGNED) END) AS dur_s,
              COUNT(CASE WHEN AgentId != 'VDCL' AND ${HANDLED} THEN CallDurationSecond END) AS dur_n
         FROM ${CDR}
        WHERE CallDate BETWEEN ? AND ? AND CampaignName IN (${mtdCampaigns.map(() => "?").join(",")})
        GROUP BY CallDate, CampaignName`,
      [mStart, date, ...mtdCampaigns],
    );
    const queue = queueRaw.map((r) => ({
      d: String(r.d), campaign: String(r.campaign), offered: n(r.offered), answered: n(r.answered),
      abandoned: n(r.abandoned), answered_w20: n(r.answered_w20), dur_s: n(r.dur_s), dur_n: n(r.dur_n),
    }));
    const queueFor = (rows: typeof queue) => {
      const byC = new Map<string, QueueTotals & { campaign: string }>();
      for (const r of rows) {
        const c = byC.get(r.campaign) ?? { campaign: r.campaign, offered: 0, answered: 0, abandoned: 0, abandon_pct: null, agents: 0 };
        c.offered += r.offered; c.answered += r.answered; c.abandoned += r.abandoned;
        byC.set(r.campaign, c);
      }
      const byCampaign = [...byC.values()].map((c) => ({ ...c, abandon_pct: pct(c.abandoned, c.offered) })).sort((a, b) => b.offered - a.offered);
      const offered = byCampaign.reduce((a, c) => a + c.offered, 0);
      const abandoned = byCampaign.reduce((a, c) => a + c.abandoned, 0);
      return {
        total: { offered, answered: byCampaign.reduce((a, c) => a + c.answered, 0), abandoned, abandon_pct: pct(abandoned, offered), agents: 0 },
        byCampaign,
      };
    };
    const dayQueueRows = queue.filter((r) => r.d === date && dayCampaigns.includes(r.campaign));
    const teamW20 = dayQueueRows.reduce((a, r) => a + r.answered_w20, 0);
    const teamAns = dayQueueRows.reduce((a, r) => a + r.answered, 0);
    const teamDurS = dayQueueRows.reduce((a, r) => a + r.dur_s, 0);
    const teamDurN = dayQueueRows.reduce((a, r) => a + r.dur_n, 0);

    const [hdr, dayLogin, mtdLogin, prevLogin, recent] = await Promise.all([
      header(masid),
      loginFor(masid, date, date),
      loginFor(masid, mStart, date),
      prevDate ? loginFor(masid, prevDate, prevDate) : Promise.resolve(undefined),
      (async () => { const { calls, phones } = toCalls(recentRows); return attachAudits(masid, calls, phones); })(),
    ]);

    const daysInMonth = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
    const weekly = [1, 2, 3, 4, 5]
      .filter((w) => (w - 1) * 7 + 1 <= daysInMonth)
      .map((w) => {
        const fromDay = (w - 1) * 7 + 1;
        const toDay = w === 5 ? daysInMonth : Math.min(w * 7, daysInMonth);
        const from = `${date.slice(0, 8)}${String(fromDay).padStart(2, "0")}`;
        const to = `${date.slice(0, 8)}${String(toDay).padStart(2, "0")}`;
        const t = sumAgg(mtdAgg.filter((r) => r.d >= from && r.d <= to));
        return { week: w, from, to, handled: t.handled, within_20s: t.within_20s, sl_pct: t.sl_pct, aht_s: t.aht_s };
      });

    const mix = new Map<string, number>();
    for (const r of dayAgg) mix.set(r.campaign, (mix.get(r.campaign) ?? 0) + r.handled);

    return {
      date,
      month_start: mStart,
      previous_date: prevDate,
      generated_at: new Date().toISOString(),
      header: hdr,
      today: sumAgg(dayAgg, dayLogin),
      mtd: sumAgg(mtdAgg, mtdLogin),
      previous: prevDate ? sumAgg(prevAgg, prevLogin) : null,
      team_today: { sl_pct: pct(teamW20, teamAns), aht_s: teamDurN > 0 ? Math.round(teamDurS / teamDurN) : null },
      queue_today: queueFor(dayQueueRows),
      queue_mtd: queueFor(queue),
      hourly: hourlyRows.map((r) => ({
        hour: Number(r.hour),
        handled: n(r.handled),
        within_20s: n(r.within_20s),
        sl_pct: pct(n(r.within_20s), n(r.handled)),
        aht_s: nn(r.aht_s),
      })),
      weekly,
      campaign_mix: [...mix.entries()].map(([campaign, calls]) => ({ campaign, calls })).sort((a, b) => b.calls - a.calls),
      recent_calls: recent,
      recent_feedback: (feedbackRows as RowDataPacket[]).map((r) => ({
        audit_id: Number(r.id),
        at: r.at,
        campaign: r.campaign ?? null,
        scenario: r.scenario ?? null,
        cq_pct: nn(r.cq_pct),
        feedback: r.feedback ?? null,
      })),
    };
  }, 120);
}

export type DailyRow = {
  date: string;
  handled: number;
  within_20s: number;
  sl_pct: number | null;
  aht_s: number | null;
  talk_s: number;
  avg_hold_s: number | null;
  avg_acw_s: number | null;
  queue_offered: number;
  queue_answered: number;
  queue_abandoned: number;
  queue_abandon_pct: number | null;
  login_s: number | null;
  first_login: string | null;
  audits: number;
  cq_pct: number | null;
  fatal_calls: number;
};

/**
 * Every KPI on the dashboard, one row per date, for the date-wise drill-down behind each tile.
 * Same definitions as getAgentMyKpi. Queue figures for a date cover only the campaigns this agent
 * actually handled on that date; CQ is the non-fatal average (audit-site definition).
 */
export async function getAgentDaily(masid: string, from: string, to: string): Promise<DailyRow[]> {
  const cacheKey = `quality:my-daily:v1:${masid}:${from}:${to}`;
  return cacheInstance.getOrSet(cacheKey, async () => {
    const [aggRaw, loginRows, auditRows] = await Promise.all([
      dialerQuery<RowDataPacket>(
        `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d') AS d, CampaignName AS campaign,
                COUNT(*) AS handled,
                SUM(TIME_TO_SEC(QueueDuration) <= 20) AS w20,
                SUM(CAST(CallDurationSecond AS UNSIGNED)) AS dur_s, COUNT(CallDurationSecond) AS dur_n,
                SUM(COALESCE(TIME_TO_SEC(Talkduration), 0)) AS talk_s,
                SUM(TIME_TO_SEC(HoldTime)) AS hold_s, COUNT(TIME_TO_SEC(HoldTime)) AS hold_n,
                SUM(TIME_TO_SEC(Acwduration)) AS acw_s, COUNT(TIME_TO_SEC(Acwduration)) AS acw_n
           FROM ${CDR}
          WHERE CallDate BETWEEN ? AND ? AND AgentId = ? AND ${HANDLED}
          GROUP BY CallDate, CampaignName`,
        [from, to, masid],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(ReportDate, '%Y-%m-%d') AS d, LEFT(Login_Time, 5) AS first_login, TIME_TO_SEC(Net_Login) AS login_s
           FROM apr WHERE UserID = ? AND ReportDate BETWEEN ? AND ?`,
        [masid, from, to],
      ).then(([r]) => r),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(q.CallDate, '%Y-%m-%d') AS d, COUNT(*) AS audits,
                ROUND(AVG(CASE WHEN NOT ${FATAL_SQL} THEN ${CQ_SCORE_SQL} END) * 100, 1) AS cq_pct,
                SUM(CASE WHEN ${FATAL_SQL} THEN 1 ELSE 0 END) AS fatal_calls
           FROM db_audit.call_quality_assessment q
          WHERE q.User = ? AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
            AND q.quality_percentage IS NOT NULL ${LOW_QUALITY_GATE_SQL}
          GROUP BY DATE_FORMAT(q.CallDate, '%Y-%m-%d')`,
        [masid, from, to],
      ).then(([r]) => r),
    ]);

    const agg = aggRaw.map((r) => ({
      d: String(r.d), campaign: String(r.campaign ?? "—"), handled: n(r.handled), w20: n(r.w20),
      dur_s: n(r.dur_s), dur_n: n(r.dur_n), talk_s: n(r.talk_s), hold_s: n(r.hold_s), hold_n: n(r.hold_n),
      acw_s: n(r.acw_s), acw_n: n(r.acw_n),
    }));
    const campaigns = [...new Set(agg.map((r) => r.campaign))];
    const queueRaw = campaigns.length === 0 ? [] : await dialerQuery<RowDataPacket>(
      `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d') AS d, CampaignName AS campaign,
              SUM(${HANDLED}) AS offered,
              SUM(AgentId != 'VDCL' AND ${HANDLED}) AS answered,
              SUM(AgentId = 'VDCL' AND ${HANDLED}) AS abandoned
         FROM ${CDR}
        WHERE CallDate BETWEEN ? AND ? AND CampaignName IN (${campaigns.map(() => "?").join(",")})
        GROUP BY CallDate, CampaignName`,
      [from, to, ...campaigns],
    );
    const workedOn = new Set(agg.map((r) => `${r.d}|${r.campaign}`));
    const login = new Map(loginRows.map((r) => [String(r.d), r]));
    const audits = new Map(auditRows.map((r) => [String(r.d), r]));

    const dates = new Set<string>([...agg.map((r) => r.d), ...login.keys(), ...audits.keys()]);
    return [...dates].sort().reverse().map((d) => {
      const t = sumAgg(agg.filter((r) => r.d === d));
      const q = queueRaw.filter((r) => String(r.d) === d && workedOn.has(`${d}|${r.campaign}`));
      const offered = q.reduce((a, r) => a + n(r.offered), 0);
      const abandoned = q.reduce((a, r) => a + n(r.abandoned), 0);
      const l = login.get(d);
      const a = audits.get(d);
      return {
        date: d,
        handled: t.handled,
        within_20s: t.within_20s,
        sl_pct: t.sl_pct,
        aht_s: t.aht_s,
        talk_s: t.talk_s,
        avg_hold_s: t.avg_hold_s,
        avg_acw_s: t.avg_acw_s,
        queue_offered: offered,
        queue_answered: q.reduce((acc, r) => acc + n(r.answered), 0),
        queue_abandoned: abandoned,
        queue_abandon_pct: pct(abandoned, offered),
        login_s: l ? nn(l.login_s) : null,
        first_login: l?.first_login ?? null,
        audits: n(a?.audits),
        cq_pct: a ? nn(a.cq_pct) : null,
        fatal_calls: n(a?.fatal_calls),
      };
    });
  }, 120);
}
