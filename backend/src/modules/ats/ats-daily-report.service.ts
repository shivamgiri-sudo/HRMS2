/**
 * ATS Daily Recruiter Performance Report
 *
 * Computes FTD / WTD / MTD metrics per branch and per recruiter.
 * Called by the 6 PM cron in ats-reminders.cron.ts.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface PeriodMetrics {
  walkin: number;
  selected: number;
  rejected: number;
  waiting: number;
  clientRoundPending: number;
  noShow: number;
  slaBreachCount: number;
  pending: number;
  selectionPct: string;
  avgWaitMinutes: number | null;
}

export interface RecruiterRow {
  recruiter: string;
  branch: string;
  sourced: number;
  attended: number;
  slaPct: string;
  selectionPct: string;
  avgWaitMinutes: number | null;
  pendingCount: number;
  attention: "Stable" | "At Risk" | "Critical";
}

export interface ProcessRow {
  branch: string;
  process: string;
  walkin: number;
  selected: number;
  rejected: number;
  waiting: number;
  clientRoundPending: number;
  noShow: number;
  pending: number;
  selectionPct: string;
  avgWaitMinutes: number | null;
}

export interface InterventionPoint {
  message: string;
}

export interface BranchDailyReport {
  branchName: string;
  ftd: PeriodMetrics;
  wtd: PeriodMetrics;
  mtd: PeriodMetrics;
  processFtd: ProcessRow[];
  recruiterFtd: RecruiterRow[];
  interventions: InterventionPoint[];
}

// SLA = submission must happen within 4 hours of walk-in / arrival
const SLA_MINUTES = 240;

function fmtPct(num: number, den: number): string {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}

function fmtWait(minutes: number | null): string {
  if (minutes === null || minutes < 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// -- date helpers -----------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekStartIso(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// -- core period query ------------------------------------------------------

async function queryPeriodMetrics(
  branchName: string,
  fromDate: string,
  toDate: string,
): Promise<PeriodMetrics> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT c.id)                                                         AS total_walkin,
       SUM(CASE WHEN c.current_stage IN
               ('Selected','selected','Offered','offer_approved','converted','payroll_validated','Onboarded')
               THEN 1 ELSE 0 END)                                                   AS selected,
       SUM(CASE WHEN s.walkin_end_stage = 'rejected'
                 OR s.final_decision   IN ('Rejected','rejected','not_selected')
                 THEN 1 ELSE 0 END)                                                 AS rejected,
       SUM(CASE WHEN s.id IS NOT NULL
                 AND COALESCE(s.final_decision,'') NOT IN
                     ('Selected','selected','offer_given','Rejected','rejected',
                      'not_selected','no_show','no_show_confirmed')
                 AND c.current_stage NOT IN
                     ('Selected','Offered','offer_approved','converted','payroll_validated','Onboarded')
                 THEN 1 ELSE 0 END)                                                 AS waiting,
       SUM(CASE WHEN c.current_stage = 'Round 3- Client'
                 OR (s.client_round_conducted = 0 AND s.id IS NOT NULL)
                 THEN 1 ELSE 0 END)                                                 AS client_round_pending,
       SUM(CASE WHEN s.walkin_end_stage = 'no_show'
                 OR s.final_decision   IN ('no_show','no_show_confirmed')
                 OR c.current_stage    =  'No Show'
                 THEN 1 ELSE 0 END)                                                 AS no_show,
       SUM(CASE WHEN s.id IS NOT NULL
                 AND s.interview_started_at IS NOT NULL
                 AND TIMESTAMPDIFF(MINUTE,
                       COALESCE(c.walk_in_date, c.created_at),
                       s.interview_started_at) > ?
                 THEN 1 ELSE 0 END)                                                 AS sla_breach,
       SUM(CASE WHEN s.id IS NULL
                 AND c.current_stage IN ('Arrived','Arrival','Screening','Interview')
                 THEN 1 ELSE 0 END)                                                 AS pending,
       AVG(CASE WHEN s.interview_started_at IS NOT NULL
                 THEN TIMESTAMPDIFF(MINUTE,
                        COALESCE(c.walk_in_date, c.created_at),
                        s.interview_started_at)
                 END)                                                               AS avg_wait
     FROM ats_candidate c
     LEFT JOIN ats_interview_submission s ON s.candidate_id = c.id
     WHERE c.record_type = 'candidate'
       AND c.applied_for_branch = ?
       AND DATE(COALESCE(c.walk_in_date, c.created_at)) BETWEEN ? AND ?`,
    [SLA_MINUTES, branchName, fromDate, toDate],
  );

  const r = rows[0] ?? {};
  const walkin   = Number(r.total_walkin ?? 0);
  const selected = Number(r.selected ?? 0);
  return {
    walkin,
    selected,
    rejected:           Number(r.rejected ?? 0),
    waiting:            Number(r.waiting ?? 0),
    clientRoundPending: Number(r.client_round_pending ?? 0),
    noShow:             Number(r.no_show ?? 0),
    slaBreachCount:     Number(r.sla_breach ?? 0),
    pending:            Number(r.pending ?? 0),
    selectionPct:       fmtPct(selected, walkin),
    avgWaitMinutes:     r.avg_wait != null ? Number(r.avg_wait) : null,
  };
}

// -- process-wise FTD -------------------------------------------------------

async function queryProcessFtd(branchName: string, forDate: string): Promise<ProcessRow[]> {
  const today = forDate;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       c.applied_for_branch                               AS branch,
       COALESCE(c.applied_for_process,'Unknown')         AS process,
       COUNT(DISTINCT c.id)                               AS total_walkin,
       SUM(CASE WHEN c.current_stage IN
               ('Selected','selected','Offered','offer_approved','converted','payroll_validated','Onboarded')
               THEN 1 ELSE 0 END)                        AS selected,
       SUM(CASE WHEN s.walkin_end_stage = 'rejected'
                 OR s.final_decision IN ('Rejected','rejected','not_selected')
                 THEN 1 ELSE 0 END)                      AS rejected,
       SUM(CASE WHEN s.id IS NOT NULL
                 AND COALESCE(s.final_decision,'') NOT IN
                     ('Selected','selected','offer_given','Rejected','rejected',
                      'not_selected','no_show','no_show_confirmed')
                 AND c.current_stage NOT IN
                     ('Selected','Offered','offer_approved','converted','payroll_validated','Onboarded')
                 THEN 1 ELSE 0 END)                      AS waiting,
       SUM(CASE WHEN c.current_stage = 'Round 3- Client'
                 OR (s.client_round_conducted = 0 AND s.id IS NOT NULL)
                 THEN 1 ELSE 0 END)                      AS client_round_pending,
       SUM(CASE WHEN s.walkin_end_stage = 'no_show'
                 OR s.final_decision IN ('no_show','no_show_confirmed')
                 THEN 1 ELSE 0 END)                      AS no_show,
       SUM(CASE WHEN s.id IS NULL
                 AND c.current_stage IN ('Arrived','Arrival','Screening','Interview')
                 THEN 1 ELSE 0 END)                      AS pending,
       AVG(CASE WHEN s.interview_started_at IS NOT NULL
                 THEN TIMESTAMPDIFF(MINUTE,
                        COALESCE(c.walk_in_date, c.created_at),
                        s.interview_started_at)
                 END)                                    AS avg_wait
     FROM ats_candidate c
     LEFT JOIN ats_interview_submission s ON s.candidate_id = c.id
     WHERE c.record_type = 'candidate'
       AND c.applied_for_branch = ?
       AND DATE(COALESCE(c.walk_in_date, c.created_at)) = ?
     GROUP BY c.applied_for_branch, c.applied_for_process
     ORDER BY total_walkin DESC`,
    [branchName, today],
  );

  return rows.map((r) => {
    const walkin   = Number(r.total_walkin ?? 0);
    const selected = Number(r.selected ?? 0);
    return {
      branch:             String(r.branch ?? branchName),
      process:            String(r.process ?? "Unknown"),
      walkin,
      selected,
      rejected:           Number(r.rejected ?? 0),
      waiting:            Number(r.waiting ?? 0),
      clientRoundPending: Number(r.client_round_pending ?? 0),
      noShow:             Number(r.no_show ?? 0),
      pending:            Number(r.pending ?? 0),
      selectionPct:       fmtPct(selected, walkin),
      avgWaitMinutes:     r.avg_wait != null ? Number(r.avg_wait) : null,
    };
  });
}

// -- recruiter FTD ----------------------------------------------------------

async function queryRecruiterFtd(branchName: string, forDate: string): Promise<RecruiterRow[]> {
  const today = forDate;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(c.recruiter_assigned_name, c.recruiter_name, 'Unassigned') AS recruiter,
       c.applied_for_branch                                                  AS branch,
       COUNT(DISTINCT c.id)                                                  AS sourced,
       SUM(CASE WHEN c.current_stage NOT IN ('Applied','New')
                 THEN 1 ELSE 0 END)                                          AS attended,
       SUM(CASE WHEN s.id IS NOT NULL
                 AND s.interview_started_at IS NOT NULL
                 AND TIMESTAMPDIFF(MINUTE,
                       COALESCE(c.walk_in_date, c.created_at),
                       s.interview_started_at) <= ?
                 THEN 1 ELSE 0 END)                                          AS sla_met,
       SUM(CASE WHEN s.id IS NOT NULL
                 THEN 1 ELSE 0 END)                                          AS submitted,
       SUM(CASE WHEN c.current_stage IN
               ('Selected','selected','Offered','offer_approved','converted','payroll_validated','Onboarded')
               THEN 1 ELSE 0 END)                                            AS selected,
       SUM(CASE WHEN s.id IS NULL
                 AND c.current_stage IN ('Arrived','Arrival','Screening','Interview')
                 THEN 1 ELSE 0 END)                                          AS pending,
       AVG(CASE WHEN s.interview_started_at IS NOT NULL
                 THEN TIMESTAMPDIFF(MINUTE,
                        COALESCE(c.walk_in_date, c.created_at),
                        s.interview_started_at)
                 END)                                                        AS avg_wait
     FROM ats_candidate c
     LEFT JOIN ats_interview_submission s ON s.candidate_id = c.id
     WHERE c.record_type = 'candidate'
       AND c.applied_for_branch = ?
       AND DATE(COALESCE(c.walk_in_date, c.created_at)) = ?
     GROUP BY recruiter, c.applied_for_branch
     ORDER BY attended DESC`,
    [SLA_MINUTES, branchName, today],
  );

  return rows.map((r) => {
    const attended  = Number(r.attended ?? 0);
    const selected  = Number(r.selected ?? 0);
    const slaMet    = Number(r.sla_met ?? 0);
    const pending   = Number(r.pending ?? 0);
    const avgWait   = r.avg_wait != null ? Number(r.avg_wait) : null;

    let attention: "Stable" | "At Risk" | "Critical" = "Stable";
    if (pending >= 3 || (avgWait !== null && avgWait > 180)) attention = "Critical";
    else if (pending >= 1 || (avgWait !== null && avgWait > 90)) attention = "At Risk";

    return {
      recruiter:     String(r.recruiter ?? "Unassigned"),
      branch:        String(r.branch ?? branchName),
      sourced:       Number(r.sourced ?? 0),
      attended,
      slaPct:        fmtPct(slaMet, attended),
      selectionPct:  fmtPct(selected, attended),
      avgWaitMinutes: avgWait,
      pendingCount:  pending,
      attention,
    };
  });
}

// -- intervention points ----------------------------------------------------

function buildInterventions(
  branchName: string,
  ftd: PeriodMetrics,
  processFtd: ProcessRow[],
  recruiterFtd: RecruiterRow[],
): InterventionPoint[] {
  const points: InterventionPoint[] = [];

  if (ftd.pending > 0) {
    const pct = fmtPct(ftd.pending, ftd.walkin);
    points.push({
      message: `${ftd.pending} candidate${ftd.pending > 1 ? "s" : ""} pending interview form submission (${pct} of today's walk-ins). Branch head to ensure same-day closure.`,
    });
  }

  if (ftd.clientRoundPending > 0) {
    const pct = fmtPct(ftd.clientRoundPending, ftd.walkin);
    points.push({
      message: `${ftd.clientRoundPending} candidate${ftd.clientRoundPending > 1 ? "s" : ""} pending in client round (${pct}). Escalate to client contact for same-day closure.`,
    });
  }

  for (const p of processFtd) {
    if (p.pending > 0 && p.avgWaitMinutes !== null && p.avgWaitMinutes > 60) {
      points.push({
        message: `${p.process} process has ${p.pending} pending case${p.pending > 1 ? "s" : ""} and avg wait ${fmtWait(p.avgWaitMinutes)}. Process-level follow-up required.`,
      });
    }
  }

  for (const rec of recruiterFtd) {
    if (rec.attention === "Critical") {
      points.push({
        message: `Recruiter ${rec.recruiter}: ${rec.pendingCount} pending form${rec.pendingCount > 1 ? "s" : ""} not submitted today. Immediate action needed.`,
      });
    }
  }

  if (ftd.walkin > 0 && ftd.selected === 0 && ftd.walkin >= 3) {
    points.push({
      message: `0 selections from ${ftd.walkin} walk-ins today. Review interview criteria or process eligibility.`,
    });
  }

  return points;
}

// -- public API -------------------------------------------------------------

export async function computeBranchReport(branchName: string, forDate?: string): Promise<BranchDailyReport> {
  const today     = forDate || todayIso();
  const weekStart = weekStartIso();
  const monthStart = monthStartIso();

  const [ftd, wtd, mtd, processFtd, recruiterFtd] = await Promise.all([
    queryPeriodMetrics(branchName, today, today),
    queryPeriodMetrics(branchName, weekStart, today),
    queryPeriodMetrics(branchName, monthStart, today),
    queryProcessFtd(branchName, today),
    queryRecruiterFtd(branchName, today),
  ]);

  const interventions = buildInterventions(branchName, ftd, processFtd, recruiterFtd);

  return { branchName, ftd, wtd, mtd, processFtd, recruiterFtd, interventions };
}

export { fmtWait };
