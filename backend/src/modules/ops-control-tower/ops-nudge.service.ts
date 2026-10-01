// Ops Control Tower joiner nudges — WhatsApp "Notify" (manual) and the 24h auto sweep share one
// path (nudgeEmployee) so cooldown, skip rules and logging behave identically. WhatsApp itself is
// resolved through the shared providerFactory: until a provider is configured (or while an admin
// has paused the channel) every attempt is logged `skipped_unconfigured` and, because cooldown only
// counts `sent` rows, nothing is "used up" — the first send after configuration goes out normally.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { providerFactory } from "../communication/providers/provider.factory.js";
import {
  allBranches,
  getAccountDetailsMissingDetail,
  getAppointmentLetterDetail,
  getBgvPendingDetail,
  getDigilockerPendingDetail,
  getEsignPendingDetail,
  getPennyDropMissingDetail,
} from "./ops-control-tower.service.js";
import {
  ageingBucket,
  buildNudgeMessage,
  cooldownState,
  isNudgeableIssue,
  type AgeingBucket,
  type NudgeableIssue,
} from "./ops-nudge.logic.js";

export type NudgeStatus =
  | "sent"
  | "failed"
  | "skipped_unconfigured"
  | "skipped_no_contact"
  | "skipped_not_joining"
  | "skipped_cooldown"
  | "not_found";

export interface NudgeResult {
  employeeId: string;
  status: NudgeStatus;
  error?: string;
  nextEligibleMs?: number;
}

export const NUDGE_DETAIL_LOADERS: Record<
  NudgeableIssue,
  (branchId: string) => Promise<Array<{ employeeId: string }>>
> = {
  "account-details-missing": getAccountDetailsMissingDetail,
  "penny-drop-missing": getPennyDropMissingDetail,
  "digilocker-pending": getDigilockerPendingDetail,
  "esign-pending": getEsignPendingDetail,
  "appointment-letter": getAppointmentLetterDetail,
  "bgv-pending": getBgvPendingDetail,
};

/** Hard cap per auto sweep so the first run after WhatsApp is configured cannot blast everyone at once. */
export const AUTO_SWEEP_MAX_SENDS = 300;

interface RecipientRow extends RowDataPacket {
  full_name: string;
  branch_id: string | null;
  emp_mobile: string | null;
  candidate_id: string | null;
  cand_mobile: string | null;
  candidate_status: string | null;
  onboarding_token: string | null;
  onboarding_token_expires_at: Date | string | null;
  days_open: number | null;
}

async function loadRecipient(employeeId: string): Promise<RecipientRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.full_name, e.branch_id, e.mobile AS emp_mobile, b.candidate_id,
            c.mobile AS cand_mobile, c.candidate_status,
            b.onboarding_token, b.onboarding_token_expires_at,
            DATEDIFF(CURDATE(), e.created_at) AS days_open
       FROM employees e
       LEFT JOIN ats_onboarding_bridge b ON b.employee_id = e.id
       LEFT JOIN ats_candidate c ON c.id = b.candidate_id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );
  return (rows[0] as RecipientRow | undefined) ?? null;
}

async function lastSentMs(employeeId: string, issue: string): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(created_at) AS last_sent FROM ops_nudge_log
      WHERE employee_id = ? AND issue_key = ? AND status = 'sent'`,
    [employeeId, issue],
  );
  const v = rows[0]?.last_sent;
  return v ? new Date(v as string).getTime() : null;
}

async function logAttempt(a: {
  employeeId: string;
  candidateId: string | null;
  branchId: string | null;
  issue: string;
  trigger: "manual" | "auto";
  status: Exclude<NudgeStatus, "skipped_cooldown" | "not_found">;
  actorId: string | null;
  error?: string;
}): Promise<void> {
  await db.execute(
    `INSERT INTO ops_nudge_log
       (employee_id, candidate_id, branch_id, issue_key, channel, trigger_type, status, sent_by, error_message)
     VALUES (?, ?, ?, ?, 'whatsapp', ?, ?, ?, ?)`,
    [a.employeeId, a.candidateId, a.branchId, a.issue, a.trigger, a.status, a.actorId, a.error?.slice(0, 500) ?? null],
  );
}

export function whatsappConfigured(): boolean {
  const p = providerFactory.getProvider("whatsapp");
  return typeof p.isConfigured === "function" ? p.isConfigured() : true;
}

export async function nudgeEmployee(input: {
  employeeId: string;
  issue: NudgeableIssue;
  trigger: "manual" | "auto";
  actorId: string | null;
  nowMs?: number;
}): Promise<NudgeResult> {
  const { employeeId, issue, trigger, actorId } = input;
  const nowMs = input.nowMs ?? Date.now();
  const r = await loadRecipient(employeeId);
  if (!r) return { employeeId, status: "not_found" };

  const base = { employeeId, candidateId: r.candidate_id, branchId: r.branch_id, issue, trigger, actorId };

  if (r.candidate_status === "not_joining") {
    await logAttempt({ ...base, status: "skipped_not_joining" });
    return { employeeId, status: "skipped_not_joining" };
  }
  const mobile = (r.cand_mobile || r.emp_mobile || "").trim();
  if (!mobile) {
    await logAttempt({ ...base, status: "skipped_no_contact" });
    return { employeeId, status: "skipped_no_contact" };
  }

  const cd = cooldownState(await lastSentMs(employeeId, issue), nowMs);
  if (!cd.due) return { employeeId, status: "skipped_cooldown", nextEligibleMs: cd.nextEligibleMs };

  if (!whatsappConfigured()) {
    await logAttempt({ ...base, status: "skipped_unconfigured" });
    return { employeeId, status: "skipped_unconfigured" };
  }

  const tokenLive =
    r.onboarding_token &&
    (!r.onboarding_token_expires_at || new Date(r.onboarding_token_expires_at as string).getTime() > nowMs);
  const link = tokenLive ? `${env.FRONTEND_URL || "http://localhost:5173"}/onboard-full?token=${r.onboarding_token}` : null;
  const body = buildNudgeMessage(issue, { name: r.full_name, daysOpen: Number(r.days_open ?? 0), link });

  try {
    const res = await providerFactory.getProvider("whatsapp").send(mobile, "Joining formalities pending", body);
    if (!res?.success) throw new Error(res?.error ?? "WhatsApp provider reported failure");
    await logAttempt({ ...base, status: "sent" });
    return { employeeId, status: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAttempt({ ...base, status: "failed", error: msg });
    return { employeeId, status: "failed", error: msg };
  }
}

export async function bulkNudge(input: {
  employeeIds: string[];
  issue: NudgeableIssue;
  actorId: string | null;
}): Promise<NudgeResult[]> {
  const out: NudgeResult[] = [];
  for (const employeeId of [...new Set(input.employeeIds)]) {
    out.push(await nudgeEmployee({ employeeId, issue: input.issue, trigger: "manual", actorId: input.actorId }));
  }
  return out;
}

export interface NudgeStats {
  count: number;
  lastSentMs: number | null;
}

/** Sent-nudge count + last send time per employee for one issue; employees never nudged are absent. */
export async function getNudgeStats(
  issue: NudgeableIssue,
  employeeIds: string[],
): Promise<Map<string, NudgeStats>> {
  const out = new Map<string, NudgeStats>();
  if (employeeIds.length === 0) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, COUNT(*) AS n, MAX(created_at) AS last_sent
       FROM ops_nudge_log
      WHERE issue_key = ? AND status = 'sent' AND employee_id IN (${employeeIds.map(() => "?").join(",")})
      GROUP BY employee_id`,
    [issue, ...employeeIds],
  );
  for (const r of rows) {
    out.set(String(r.employee_id), {
      count: Number(r.n),
      lastSentMs: r.last_sent ? new Date(r.last_sent as string).getTime() : null,
    });
  }
  return out;
}

export interface SweepSummary {
  skippedUnconfigured: boolean;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** 24h auto sweep: every pending joiner on every nudgeable issue whose cooldown has lapsed. */
export async function runAutoNudgeSweep(nowMs = Date.now()): Promise<SweepSummary> {
  const summary: SweepSummary = { skippedUnconfigured: false, attempted: 0, sent: 0, failed: 0, skipped: 0 };
  if (!whatsappConfigured()) {
    summary.skippedUnconfigured = true;
    logger.info("[ops-nudge] auto sweep skipped — WhatsApp not configured / paused");
    return summary;
  }
  const branches = await allBranches();
  const seen = new Set<string>();
  for (const [issue, loader] of Object.entries(NUDGE_DETAIL_LOADERS) as Array<
    [NudgeableIssue, (id: string) => Promise<Array<{ employeeId: string }>>]
  >) {
    for (const b of branches) {
      const rows = await loader(b.branchId);
      for (const row of rows) {
        const key = `${row.employeeId}:${issue}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (summary.sent >= AUTO_SWEEP_MAX_SENDS) return summary;
        const res = await nudgeEmployee({ employeeId: row.employeeId, issue, trigger: "auto", actorId: null, nowMs });
        if (res.status === "skipped_cooldown") continue;
        summary.attempted++;
        if (res.status === "sent") summary.sent++;
        else if (res.status === "failed") summary.failed++;
        else summary.skipped++;
      }
    }
  }
  return summary;
}

export interface NudgeInfo {
  count: number;
  lastSentMs: number | null;
  due: boolean;
  nextEligibleMs: number;
}

export type EnrichedDetailRow = Record<string, unknown> & {
  employeeId: string;
  daysOpen: number;
  ageBucket: AgeingBucket;
  candidateId: string | null;
  nudge?: NudgeInfo;
};

async function candidateIdsFor(employeeIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (employeeIds.length === 0) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, candidate_id FROM ats_onboarding_bridge
      WHERE employee_id IN (${employeeIds.map(() => "?").join(",")}) AND candidate_id IS NOT NULL`,
    employeeIds,
  );
  for (const r of rows) out.set(String(r.employee_id), String(r.candidate_id));
  return out;
}

/** Adds a normalised daysOpen + ageing bucket + candidateId to every row, and nudge stats on nudgeable blocks. */
export async function enrichDetailRows(
  block: string,
  rows: Array<Record<string, unknown> & { employeeId: string }>,
  nowMs = Date.now(),
): Promise<EnrichedDetailRow[]> {
  const ids = rows.map((r) => r.employeeId);
  const [cands, stats] = await Promise.all([
    candidateIdsFor(ids),
    isNudgeableIssue(block) ? getNudgeStats(block, ids) : Promise.resolve(new Map<string, NudgeStats>()),
  ]);
  return rows.map((r) => {
    const daysOpen = Number(r.daysOpen ?? r.daysOverdue ?? 0);
    const out: EnrichedDetailRow = {
      ...r,
      daysOpen,
      ageBucket: ageingBucket(daysOpen),
      candidateId: cands.get(r.employeeId) ?? null,
    };
    if (isNudgeableIssue(block)) {
      const s = stats.get(r.employeeId);
      const cd = cooldownState(s?.lastSentMs ?? null, nowMs);
      out.nudge = { count: s?.count ?? 0, lastSentMs: s?.lastSentMs ?? null, due: cd.due, nextEligibleMs: cd.nextEligibleMs };
    }
    return out;
  });
}

/** Branch of an employee, for route-level scope checks before a manual nudge. */
export async function employeeBranchId(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT branch_id FROM employees WHERE id = ? LIMIT 1`, [employeeId]);
  return rows[0] ? String(rows[0].branch_id ?? "") : null;
}

/** Every pending joiner in one branch for one issue — what "Notify all" nudges. */
export async function nudgeBranchPending(input: {
  branchId: string;
  issue: NudgeableIssue;
  actorId: string | null;
}): Promise<NudgeResult[]> {
  const rows = await NUDGE_DETAIL_LOADERS[input.issue](input.branchId);
  return bulkNudge({ employeeIds: rows.map((r) => r.employeeId), issue: input.issue, actorId: input.actorId });
}
