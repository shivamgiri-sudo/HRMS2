/**
 * Recruitment master refresh. Reads existing attempt data in place (ats_recruiter_hiring_activity,
 * ATS walk-ins, employees, bookings) and writes only small rollup columns on he_lead.
 * Work is chunked by 2-digit mobile prefix: each chunk is a range scan on indexed columns and stays
 * far below the proxy timeout, so it scales with a huge table.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { classifyOutcome, conversionType, deriveFinalStatus, effortTier, type FinalStatus } from "./he-master.js";

const UPDATE_BATCH = 500;

export interface HistoryRefreshResult {
  prefix: string;
  leads: number;
  updated: number;
  byTier: Record<string, number>;
}

async function activeEmployeeMobiles(): Promise<Set<string>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', ''), 10) AS m FROM employees
      WHERE active_status = 1 AND mobile IS NOT NULL AND mobile <> ''`,
  );
  return new Set(rows.map((r) => String(r.m)));
}

export async function listPrefixes(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT DISTINCT LEFT(mobile10, 2) AS p FROM he_lead ORDER BY p");
  return rows.map((r) => String(r.p));
}

function nextPrefix(p: string): string {
  const n = Number(p) + 1;
  return String(n).padStart(2, "0");
}

const ymd = (v: unknown): string | null => (v ? new Date(v as string).toISOString().slice(0, 10) : null);

/** Recompute history + effort for every lead whose mobile starts with `prefix` (2 digits), or one exact mobile. */
export async function refreshHistoryChunk(opts: { prefix?: string; mobile10?: string; employees?: Set<string> }): Promise<HistoryRefreshResult> {
  const prefix = opts.prefix ?? (opts.mobile10 ? opts.mobile10.slice(0, 2) : "00");
  const lo = opts.mobile10 ?? prefix;
  const hiExclusive = opts.mobile10 ? opts.mobile10 + "~" : nextPrefix(prefix);
  const employees = opts.employees ?? (await activeEmployeeMobiles());

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.mobile10, l.status, l.ats_candidate_id,
            h.attempts, h.first_attempt, h.last_attempt, h.walked, h.selected, h.joined,
            h.first_walkin, h.walkin_days, lr.remark AS last_remark,
            (SELECT MIN(c.walk_in_date) FROM ats_candidate c WHERE c.id = l.ats_candidate_id AND c.walk_in_date IS NOT NULL) AS ats_walkin,
            (SELECT COUNT(*) FROM ats_candidate_rewalkin w WHERE w.candidate_id = l.ats_candidate_id) AS ats_rewalkins,
            EXISTS(SELECT 1 FROM he_match m WHERE m.lead_id = l.id AND m.slot_at > NOW()
                      AND m.state IN ('invited','confirmed')) AS future_slot
       FROM he_lead l
       LEFT JOIN (
         SELECT a.mobile10, COUNT(*) AS attempts, MIN(a.activity_date) AS first_attempt, MAX(a.activity_date) AS last_attempt,
                MAX(a.walkin_flag OR a.final_selection_flag OR a.joined_flag OR COALESCE(a.pi_hr_interviewer_name,'') NOT IN ('','NA','na','N/A','nil','-')) AS walked,
                MAX(a.final_selection_flag) AS selected, MAX(a.joined_flag) AS joined,
                MIN(CASE WHEN a.walkin_flag OR a.final_selection_flag OR a.joined_flag
                         THEN COALESCE(a.walkin_date, a.pi_hr_interviewer_date, a.activity_date) END) AS first_walkin,
                COUNT(DISTINCT CASE WHEN a.walkin_flag OR a.final_selection_flag OR a.joined_flag
                         THEN COALESCE(a.walkin_date, a.pi_hr_interviewer_date, a.activity_date) END) AS walkin_days
           FROM ats_recruiter_hiring_activity a
          WHERE a.mobile10 >= ? AND a.mobile10 < ?
          GROUP BY a.mobile10
       ) h ON h.mobile10 = l.mobile10
       LEFT JOIN (
         SELECT x.mobile10, x.remark FROM (
           SELECT a.mobile10, COALESCE(NULLIF(a.recruiter_remarks,''), a.current_status) AS remark,
                  ROW_NUMBER() OVER (PARTITION BY a.mobile10 ORDER BY a.activity_date DESC, a.created_at DESC) AS rn
             FROM ats_recruiter_hiring_activity a WHERE a.mobile10 >= ? AND a.mobile10 < ?
         ) x WHERE x.rn = 1
       ) lr ON lr.mobile10 = l.mobile10
      WHERE l.mobile10 >= ? AND l.mobile10 < ?`,
    [lo, hiExclusive, lo, hiExclusive, lo, hiExclusive],
  );

  const byTier: Record<string, number> = {};
  const out: unknown[][] = [];
  for (const r of rows) {
    const atsWalk = ymd(r.ats_walkin);
    const arhaWalk = ymd(r.first_walkin);
    const firstWalkin = [atsWalk, arhaWalk].filter(Boolean).sort()[0] ?? null;
    const walkinCount = Math.max(Number(r.walkin_days ?? 0), 0) + (atsWalk && atsWalk !== arhaWalk ? 1 : 0) + Number(r.ats_rewalkins ?? 0);
    const walked = Boolean(Number(r.walked ?? 0)) || Boolean(atsWalk);
    const finalStatus: FinalStatus = deriveFinalStatus(walked, Boolean(Number(r.selected ?? 0)), Boolean(Number(r.joined ?? 0)));
    const outcome = classifyOutcome(r.last_remark);
    const isEmployee = employees.has(String(r.mobile10));
    const attempts = Number(r.attempts ?? 0);
    const { tier, reason } = effortTier({
      status: String(r.status), finalStatus, isEmployee, lastOutcome: r.last_remark ? outcome : null,
      attemptCount: attempts, walkinCount, hasFutureSlot: Boolean(Number(r.future_slot ?? 0)),
    });
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    out.push([
      r.id, attempts, ymd(r.first_attempt), ymd(r.last_attempt), walkinCount, firstWalkin, r.last_remark ? outcome : null,
      finalStatus, conversionType(ymd(r.first_attempt), firstWalkin), isEmployee ? 1 : 0, tier, reason,
    ]);
  }

  let updated = 0;
  for (let i = 0; i < out.length; i += UPDATE_BATCH) {
    const slice = out.slice(i, i + UPDATE_BATCH);
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE he_lead l
         JOIN (VALUES ${slice.map(() => "ROW(?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}) AS v(id, ac, fa, la, wc, lw, lo, fs, ct, ie, et, er)
           ON l.id = v.id
          SET l.attempt_count = v.ac, l.first_attempt_date = v.fa, l.last_attempt_date = v.la, l.walkin_count = v.wc,
              l.last_walkin_date = v.lw, l.last_outcome = v.lo, l.final_status = v.fs, l.conversion_type = v.ct,
              l.is_employee = v.ie, l.effort_tier = v.et, l.effort_reason = v.er, l.history_refreshed_at = NOW()`,
      slice.flat() as never[],
    );
    updated += res.affectedRows;
  }
  return { prefix, leads: rows.length, updated, byTier };
}

/** Refresh one lead right after a connect attempt (cheap: exact-mobile range). */
export async function refreshLeadHistory(mobile10: string): Promise<void> {
  await refreshHistoryChunk({ mobile10 });
}

/** Master view for the UI: pool by effort tier, and why. */
export async function getMasterSummary(): Promise<{
  byTier: RowDataPacket[]; byReason: RowDataPacket[]; byConversion: RowDataPacket[]; refreshedAt: string | null; stale: number;
}> {
  const [byTier] = await db.execute<RowDataPacket[]>("SELECT effort_tier AS tier, COUNT(*) AS n FROM he_lead GROUP BY effort_tier");
  const [byReason] = await db.execute<RowDataPacket[]>(
    "SELECT effort_tier AS tier, effort_reason AS reason, COUNT(*) AS n FROM he_lead GROUP BY effort_tier, effort_reason ORDER BY n DESC LIMIT 30",
  );
  const [byConversion] = await db.execute<RowDataPacket[]>(
    "SELECT conversion_type AS type, COUNT(*) AS n FROM he_lead WHERE conversion_type IS NOT NULL GROUP BY conversion_type ORDER BY n DESC",
  );
  const [metaRows] = await db.execute<RowDataPacket[]>(
    "SELECT MAX(history_refreshed_at) AS at, SUM(history_refreshed_at IS NULL) AS stale FROM he_lead",
  );
  const meta = metaRows[0];
  return { byTier, byReason, byConversion, refreshedAt: meta?.at ? new Date(meta.at).toISOString() : null, stale: Number(meta?.stale ?? 0) };
}
