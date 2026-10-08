// Ops Control Tower joiner nudges — WhatsApp "Notify" (manual) and the 24h auto sweep share one
// path (nudgeEmployee) so cooldown, skip rules and logging behave identically. WhatsApp itself is
// resolved through the shared providerFactory: until a provider is configured (or while an admin
// has paused the channel) every attempt is logged `skipped_unconfigured` and, because cooldown only
// counts `sent` rows, nothing is "used up" — the first send after configuration goes out normally.
import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { buildOnboardingTokenEmail } from "../ats/ats.email.service.js";
import { emailService } from "../communication/email.service.js";
import { providerFactory } from "../communication/providers/provider.factory.js";
import {
  allBranches,
  getAccountDetailsMissingDetail,
  getDocsPendingDetail,
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
  escalationTitle,
  isNudgeableIssue,
  shouldEscalate,
  SHARED_PENDENCY_KIND,
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
  "docs-pending": getDocsPendingDetail,
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

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146;
}

/** Last time the payroll pendency EMAIL reminder reached this employee for the same item (shared ledger). */
async function lastPendencyEmailMs(employeeId: string, issue: NudgeableIssue): Promise<number | null> {
  const kind = SHARED_PENDENCY_KIND[issue];
  if (!kind) return null;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(created_at) AS last_sent FROM pendency_reminder_log
        WHERE employee_id = ? AND reminder_kind = ? AND status = 'sent'`,
      [employeeId, kind],
    );
    const v = rows[0]?.last_sent;
    return v ? new Date(v as string).getTime() : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function lastSentMs(employeeId: string, issue: NudgeableIssue): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(created_at) AS last_sent FROM ops_nudge_log
      WHERE employee_id = ? AND issue_key = ? AND status = 'sent'`,
    [employeeId, issue],
  );
  const v = rows[0]?.last_sent;
  const mine = v ? new Date(v as string).getTime() : null;
  const email = await lastPendencyEmailMs(employeeId, issue);
  return mine === null ? email : email === null ? mine : Math.max(mine, email);
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

/** Re-issued links stay valid this long — short enough to limit exposure, long enough to act on. */
export const REISSUED_LINK_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Returns a usable onboarding token for the recipient. A live token is reused untouched (earlier
 * emails keep working); a missing or expired one is replaced on the same ats_onboarding_bridge row
 * the candidate flow already validates against. No bridge row (manually created employee) = null.
 * Only runs after the cooldown / contact / provider checks, so it never mints a token for a
 * message that is not going out.
 */
export async function ensureLiveOnboardingToken(
  r: Pick<RecipientRow, "candidate_id" | "onboarding_token" | "onboarding_token_expires_at">,
  nowMs: number,
): Promise<string | null> {
  if (!r.candidate_id) return null;
  const live =
    r.onboarding_token &&
    (!r.onboarding_token_expires_at || new Date(r.onboarding_token_expires_at as string).getTime() > nowMs);
  if (live) return r.onboarding_token;
  const fresh = `${randomUUID()}-${randomUUID()}`;
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE ats_onboarding_bridge
        SET onboarding_token = ?, onboarding_token_expires_at = ?
      WHERE candidate_id = ?`,
    [fresh, new Date(nowMs + REISSUED_LINK_TTL_MS), r.candidate_id],
  );
  return res.affectedRows > 0 ? fresh : null;
}

/**
 * A working onboarding link for one employee, for HR to share by hand (call, chat). Reuses a live token,
 * otherwise re-issues one (72h). Null when the employee has no onboarding record to link to, or has been
 * marked as not joining.
 */
export async function issueOnboardingLink(employeeId: string, nowMs = Date.now()): Promise<{ link: string; expiresAt: string } | null> {
  const r = await loadRecipient(employeeId);
  if (!r || r.candidate_status === "not_joining") return null;
  const token = await ensureLiveOnboardingToken(r, nowMs);
  if (!token) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT onboarding_token_expires_at AS exp FROM ats_onboarding_bridge WHERE candidate_id = ? LIMIT 1", [r.candidate_id],
  );
  const exp = rows[0]?.exp ? new Date(rows[0].exp as string) : new Date(nowMs + REISSUED_LINK_TTL_MS);
  return { link: `${env.FRONTEND_URL || "http://localhost:5173"}/onboard-full?token=${token}`, expiresAt: exp.toISOString() };
}

/** How long the Ops "Email link" action waits for the mail server before reporting failure. */
export const EMAIL_LINK_DEADLINE_MS = 25_000;

export type EmailLinkResult =
  | { status: "sent"; sentTo: string }
  | { status: "no_link" | "no_email" | "not_found" }
  | { status: "failed"; error: string };

/**
 * Emails the joiner their onboarding link (a live link is reused, an expired/missing one is re-issued).
 * Works for any employee that still has an onboarding record, including long-onboarded ones. A manual
 * HR action, so there is no cooldown; the caller audits it. Returns the real delivery outcome.
 */
export async function emailOnboardingLink(employeeId: string, nowMs = Date.now()): Promise<EmailLinkResult> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.full_name, c.email AS cand_email, e.personal_email, e.email AS emp_email
       FROM employees e
       LEFT JOIN ats_onboarding_bridge b ON b.employee_id = e.id
       LEFT JOIN ats_candidate c ON c.id = b.candidate_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const row = rows[0];
  if (!row) return { status: "not_found" };
  const to = String(row.cand_email || row.personal_email || row.emp_email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { status: "no_email" };
  // Sent through the shared mailer (the one payroll pendency reminders use): pooled, retries Gmail 421
  // throttling, strips spaces from app passwords and refuses localhost links. The ATS mailer's own bare
  // transport does none of that, and reports success when SMTP is unconfigured.
  if (!emailService.isConfigured()) return { status: "failed", error: "Email is not configured (SMTP)" };
  const issued = await issueOnboardingLink(employeeId, nowMs);
  if (!issued) return { status: "no_link" };
  const hoursLeft = Math.max(1, Math.round((new Date(issued.expiresAt).getTime() - nowMs) / 3_600_000));
  const [cand] = await db.execute<RowDataPacket[]>(
    "SELECT candidate_id FROM ats_onboarding_bridge WHERE employee_id = ? LIMIT 1", [employeeId],
  );
  const candidateId = String(cand[0]?.candidate_id ?? employeeId);
  const mail = buildOnboardingTokenEmail({
    candidateName: String(row.full_name ?? ""),
    onboardingLink: issued.link,
    validFor: hoursLeft >= 48 ? `${Math.round(hoursLeft / 24)} days` : `${hoursLeft} hours`,
  });
  try {
    // Hard deadline: an unreachable SMTP host would otherwise leave the request (and the button) hanging.
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        emailService.send({ to, subject: mail.subject, html: mail.html }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("The email server did not respond in time — try again shortly")), EMAIL_LINK_DEADLINE_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logLinkEmail(candidateId, to, "failed", error);
    return { status: "failed", error };
  }
  await logLinkEmail(candidateId, to, "sent");
  return { status: "sent", sentTo: to };
}

async function logLinkEmail(candidateId: string, to: string, status: "sent" | "failed", error?: string): Promise<void> {
  try {
    await db.execute(
      `INSERT IGNORE INTO ats_email_log (id, candidate_id, email_type, sent_to, status, error_message) VALUES (UUID(), ?, 'token_sent', ?, ?, ?)`,
      [candidateId, to, status, error?.slice(0, 500) ?? null],
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message, candidateId }, "[ops-nudge] could not log onboarding link email");
  }
}

const ESCALATION_ITEM = "OPS_NUDGE_ESCALATION";

/**
 * Once a joiner has been nudged ESCALATE_AFTER_SENDS times for the same open item, raise ONE work item for the
 * branch head so a person follows up. Deduplicated per joiner + issue; a no-op when branch is unknown.
 */
export async function escalateIfStalled(a: { employeeId: string; branchId: string | null; name: string; issue: NudgeableIssue }): Promise<boolean> {
  if (!a.branchId) return false;
  const [sent] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ops_nudge_log WHERE employee_id = ? AND issue_key = ? AND status = 'sent'`,
    [a.employeeId, a.issue],
  );
  const sentCount = Number(sent?.[0]?.n ?? 0);
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM work_item WHERE item_type = ? AND entity_id = ? AND description = ? LIMIT 1`,
    [ESCALATION_ITEM, a.employeeId, a.issue],
  );
  if (!shouldEscalate(sentCount, Array.isArray(existing) && existing.length > 0)) return false;
  await db.execute(
    `INSERT INTO work_item
       (id, item_type, title, description, module_code, entity_type, entity_id, assigned_to_role, branch_id, priority, status, created_at)
     VALUES (UUID(), ?, ?, ?, 'ops', 'employee', ?, 'branch_head', ?, 'high', 'pending', NOW())`,
    [ESCALATION_ITEM, escalationTitle(a.name, a.issue, sentCount), a.issue, a.employeeId, a.branchId],
  );
  return true;
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

  const token = await ensureLiveOnboardingToken(r, nowMs);
  const link = token ? `${env.FRONTEND_URL || "http://localhost:5173"}/onboard-full?token=${token}` : null;
  const body = buildNudgeMessage(issue, { name: r.full_name, daysOpen: Number(r.days_open ?? 0), link });

  try {
    const res = await providerFactory.getProvider("whatsapp").send(mobile, "Joining formalities pending", body);
    if (!res?.success) throw new Error(res?.error ?? "WhatsApp provider reported failure");
    await logAttempt({ ...base, status: "sent" });
    // Reminders alone are not working: hand it to a person. Never allowed to turn a delivered nudge into an error.
    await escalateIfStalled({ employeeId, branchId: r.branch_id, name: r.full_name, issue }).catch((err) => {
      logger.warn({ err: (err as Error).message, employeeId, issue }, "[ops-nudge] escalation check failed");
    });
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

/**
 * Sent-reminder count + last send time per employee for one issue; employees never reminded are absent.
 * For items the payroll pendency emails also chase, those emails count too (one shared ledger).
 */
export async function getNudgeStats(
  issue: NudgeableIssue,
  employeeIds: string[],
): Promise<Map<string, NudgeStats>> {
  const out = new Map<string, NudgeStats>();
  if (employeeIds.length === 0) return out;
  const marks = employeeIds.map(() => "?").join(",");
  const fold = (id: string, n: number, last: unknown) => {
    const t = last ? new Date(last as string).getTime() : null;
    const cur = out.get(id);
    out.set(id, {
      count: (cur?.count ?? 0) + n,
      lastSentMs: cur?.lastSentMs == null ? t : t == null ? cur.lastSentMs : Math.max(cur.lastSentMs, t),
    });
  };
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, COUNT(*) AS n, MAX(created_at) AS last_sent
       FROM ops_nudge_log
      WHERE issue_key = ? AND status = 'sent' AND employee_id IN (${marks})
      GROUP BY employee_id`,
    [issue, ...employeeIds],
  );
  for (const r of rows) fold(String(r.employee_id), Number(r.n), r.last_sent);
  const kind = SHARED_PENDENCY_KIND[issue];
  if (kind) {
    try {
      const [erows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, COUNT(*) AS n, MAX(created_at) AS last_sent
           FROM pendency_reminder_log
          WHERE reminder_kind = ? AND status = 'sent' AND employee_id IN (${marks})
          GROUP BY employee_id`,
        [kind, ...employeeIds],
      );
      for (const r of erows) fold(String(r.employee_id), Number(r.n), r.last_sent);
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }
  }
  return out;
}

export interface SweepSummary {
  skippedUnconfigured: boolean;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Open items whose next step is HR's or the provider's, so the joiner was not messaged. */
  notJoinersMove: number;
}

/**
 * Whether an open item's next step is the joiner's, which is the only time the automatic reminder messages them.
 * The control-tower lists stay as they are (the item is open); only the WhatsApp is held back. Measured live
 * 2026-10-06: BGV was waiting on HR/provider review for all 159 not-clear joiners (offline Aadhaar and photo match
 * in manual review), 204 joiners had no appointment letter issued, 31 eSign kits were blocked and 18 abandoned,
 * and 34 joiners' documents were still draft_generated (not yet sent by HR). HR's manual Nudge is not filtered.
 */
export const JOINER_ACTION_SQL: Record<NudgeableIssue, string | null> = {
  "account-details-missing": null,
  "digilocker-pending": null,
  // A check sitting in Payroll HR's manual-review queue is HR's decision, not something the joiner can redo.
  "penny-drop-missing": `NOT EXISTS (SELECT 1 FROM ats_onboarding_bridge pb
                           JOIN candidate_bank_verification v ON v.candidate_id = pb.candidate_id
                          WHERE pb.employee_id = ? AND v.verification_status = 'manual_review'
                            AND v.created_at = (SELECT MAX(v2.created_at) FROM candidate_bank_verification v2 WHERE v2.candidate_id = v.candidate_id))`,
  // Only a kit actually out for signing; blocked / abandoned / cancelled kits need HR to re-send first.
  "esign-pending": `EXISTS (SELECT 1 FROM employee_joining_esign_kit k WHERE k.employee_id = ? AND k.status = 'sent')`,
  // Only once the letter has been sent to the joiner.
  "appointment-letter": `EXISTS (SELECT 1 FROM appointment_letter_issue al WHERE al.employee_id = ?
                            AND LOWER(COALESCE(al.employee_esign_status, '')) IN ('sent', 'opened', 'viewed', 'delivered'))`,
  // Something must be waiting on the joiner; draft_generated rows have not been sent to them yet.
  "docs-pending": `EXISTS (SELECT 1 FROM employee_joining_document_checklist c WHERE c.employee_id = ? AND c.mandatory = 1
                      AND UPPER(COALESCE(c.document_code, '')) NOT IN ('EPF_DECLARATION', 'EPF_NOMINATION_FORM2')
                      AND LOWER(COALESCE(c.status, '')) NOT IN ('verified', 'signed_verified', 'completed', 'esign_completed',
                                                                'wet_signed_uploaded', 'waived', 'not_applicable', 'draft_generated'))`,
  // BGV checks are run and reviewed by HR and the provider; there is nothing for the joiner to do from a reminder.
  "bgv-pending": "FALSE",
};

export async function isJoinersMove(employeeId: string, issue: NudgeableIssue): Promise<boolean> {
  const cond = JOINER_ACTION_SQL[issue];
  if (cond === null) return true;
  if (cond === "FALSE") return false;
  const params = cond.split("?").length - 1;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${cond} AS ok`, Array(params).fill(employeeId));
  return Number((rows as RowDataPacket[])[0]?.ok) === 1;
}

/** 24h auto sweep: every pending joiner on every nudgeable issue whose cooldown has lapsed. */
export async function runAutoNudgeSweep(nowMs = Date.now()): Promise<SweepSummary> {
  const summary: SweepSummary = { skippedUnconfigured: false, attempted: 0, sent: 0, failed: 0, skipped: 0, notJoinersMove: 0 };
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
        if (!(await isJoinersMove(row.employeeId, issue))) { summary.notJoinersMove++; continue; }
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
