import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../../db/mysql.js';
import { emailService } from '../../communication/email.service.js';
import { buildAppLink } from '../../../shared/appLink.js';
import { fetchEsiPendingRows, ESI_STILL_APPLICABLE_SQL } from '../esi-pending.query.js';
import { buildPendencyEmail } from './pendency-email.template.js';
import { NUDGE_ISSUE_FOR_PENDENCY_KIND } from '../../ops-control-tower/ops-nudge.logic.js';

export type PendencyKind = 'esi_docs' | 'bank_account' | 'digilocker';
export const PENDENCY_KINDS: readonly PendencyKind[] = ['esi_docs', 'bank_account', 'digilocker'];

/** Minimum days between reminders of one kind to one employee, and the cap before HR takes over. */
export const MIN_GAP_DAYS = 3;
export const MAX_REMINDERS = 5;

export type SkipReason =
  | 'not_pending'
  | 'no_email'
  | 'recently_reminded'
  | 'max_reminders_reached'
  | 'no_valid_link';

/** Plain-language reason for a skipped reminder, shared by every screen that shows it. */
export function describeSkip(reason: string | undefined): string {
  switch (reason) {
    case 'not_pending': return 'Nothing is pending for this employee.';
    case 'no_email': return 'No valid email address on file.';
    case 'recently_reminded': return `Already reminded in the last ${MIN_GAP_DAYS} days.`;
    case 'max_reminders_reached': return `${MAX_REMINDERS} reminders already sent; follow up by phone.`;
    case 'no_valid_link': return 'The onboarding link has expired — re-send the onboarding link first.';
    default: return reason ?? 'Skipped.';
  }
}

export interface PendencyResult {
  employee_id: string;
  employee_code: string | null;
  /** 'would_send' only in dry-run: the reminder passed every check but nothing was sent or logged. */
  status: 'sent' | 'skipped' | 'failed' | 'would_send';
  reason?: SkipReason | string;
}

interface EmployeeContact {
  id: string;
  employee_code: string | null;
  first_name: string | null;
  email: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Personal address first (reachable before/after employment), then the others. */
export function pickRecipient(row: {
  personal_email?: unknown;
  official_email?: unknown;
  email?: unknown;
}): string | null {
  for (const candidate of [row.personal_email, row.official_email, row.email]) {
    const v = typeof candidate === 'string' ? candidate.trim() : '';
    if (v && EMAIL_RE.test(v)) return v;
  }
  return null;
}

/** What the ESI screen calls "not ready", turned into plain-language lines. */
export function esiMissingItems(row: {
  pan_ready: boolean;
  aadhaar_ready: boolean;
  photo_ready: boolean;
  bank_passbook_ready: boolean;
}): string[] {
  const items: string[] = [];
  if (!row.pan_ready) items.push('PAN card');
  if (!row.aadhaar_ready) items.push('Aadhaar card');
  if (!row.photo_ready) items.push('Your photo (clear face, plain background)');
  if (!row.bank_passbook_ready) items.push('Bank passbook (first page showing account number, IFSC and your name)');
  return items;
}

/** Cooldown decision from the history of sent reminders. Pure, so it is testable without a DB. */
export function cooldownDecision(
  sentCount: number,
  lastSentAt: Date | null,
  now: Date,
): SkipReason | null {
  if (sentCount >= MAX_REMINDERS) return 'max_reminders_reached';
  if (lastSentAt && now.getTime() - lastSentAt.getTime() < MIN_GAP_DAYS * 24 * 60 * 60 * 1000) {
    return 'recently_reminded';
  }
  return null;
}

async function loadContacts(ids: string[]): Promise<Map<string, EmployeeContact & { personal_email: string | null; official_email: string | null }>> {
  const map = new Map<string, any>();
  if (!ids.length) return map;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, first_name, email, official_email, personal_email
       FROM employees WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  for (const r of rows as RowDataPacket[]) map.set(String(r.id), r);
  return map;
}

async function loadHistory(
  ids: string[],
  kind: PendencyKind,
): Promise<Map<string, { sent: number; last: Date | null }>> {
  const map = new Map<string, { sent: number; last: Date | null }>();
  if (!ids.length) return map;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, COUNT(*) AS sent, MAX(created_at) AS last_sent
       FROM pendency_reminder_log
      WHERE reminder_kind = ? AND status = 'sent' AND employee_id IN (${ids.map(() => '?').join(',')})
      GROUP BY employee_id`,
    [kind, ...ids],
  );
  for (const r of rows as RowDataPacket[]) {
    map.set(String(r.employee_id), { sent: Number(r.sent), last: r.last_sent ? new Date(r.last_sent) : null });
  }
  // Shared contact ledger with the Ops Control Tower WhatsApp nudges: a WhatsApp reminder for the
  // same item restarts the minimum gap, so the joiner is not emailed the day after a WhatsApp. It
  // moves `last` only — the 5-reminder cap and HR escalation keep counting emails alone.
  const nudgeIssue = (NUDGE_ISSUE_FOR_PENDENCY_KIND as Record<string, string | undefined>)[kind];
  if (nudgeIssue) {
    try {
      const [nrows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, MAX(created_at) AS last_sent
           FROM ops_nudge_log
          WHERE issue_key = ? AND status = 'sent' AND employee_id IN (${ids.map(() => '?').join(',')})
          GROUP BY employee_id`,
        [nudgeIssue, ...ids],
      );
      for (const r of (nrows ?? []) as RowDataPacket[]) {
        if (!r.last_sent) continue;
        const t = new Date(r.last_sent);
        const cur = map.get(String(r.employee_id));
        if (!cur) map.set(String(r.employee_id), { sent: 0, last: t });
        else if (!cur.last || t > cur.last) cur.last = t;
      }
    } catch (err) {
      const e = err as { code?: string; errno?: number };
      if (e?.code !== 'ER_NO_SUCH_TABLE' && e?.errno !== 1146) throw err;
    }
  }
  return map;
}

interface PendingItem {
  items: string[];
  link: string | null;
}

/** ESI: same query and flags as the ESI Registration screen. */
export async function pendingEsi(ids: string[]): Promise<Map<string, PendingItem>> {
  const out = new Map<string, PendingItem>();
  if (!ids.length) return out;
  const whereClause = [
    'e.active_status = 1',
    'esi.esi_eligible = 1',
    ESI_STILL_APPLICABLE_SQL,
    "COALESCE(NULLIF(e.esic_number, ''), NULLIF(esi.esi_number, '')) IS NULL",
    "e.employment_status != 'terminated'",
    `e.id IN (${ids.map(() => '?').join(',')})`,
  ].join(' AND ');
  const rows = await fetchEsiPendingRows({ whereClause, params: ids, safeLimit: ids.length, safeOffset: 0 });
  for (const r of rows) {
    const items = esiMissingItems({
      pan_ready: !!r.pan_ready,
      aadhaar_ready: !!r.aadhaar_ready,
      photo_ready: !!r.photo_ready,
      bank_passbook_ready: !!r.bank_passbook_url,
    });
    if (items.length) out.set(String(r.employee_id), { items, link: buildAppLink('/profile', { tab: 'documents' }) });
  }
  return out;
}

/** Bank: no primary bank row carrying an IFSC (same test the bank-detail reminder script uses). */
export async function pendingBank(ids: string[]): Promise<Map<string, PendingItem>> {
  const out = new Map<string, PendingItem>();
  if (!ids.length) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id FROM employees e
      WHERE e.id IN (${ids.map(() => '?').join(',')})
        AND e.active_status = 1 AND e.employment_status != 'terminated'
        AND NOT EXISTS (SELECT 1 FROM employee_bank_detail b
                         WHERE b.employee_id = e.id AND b.is_primary = 1
                           AND b.ifsc_code IS NOT NULL AND b.ifsc_code != '')`,
    ids,
  );
  for (const r of rows as RowDataPacket[]) {
    out.set(String(r.id), {
      items: ['Your bank account details (account number, IFSC, account holder name)'],
      link: buildAppLink('/profile', { tab: 'statutory' }),
    });
  }
  return out;
}

/**
 * DigiLocker: the only employee path is the onboarding portal, reached by the employee's
 * existing onboarding link. An expired or missing link is NOT re-minted here — minting
 * overwrites the stored token and would silently kill a link already in the employee's
 * inbox; HR re-sends through the normal onboarding flow instead.
 */
export async function pendingDigilocker(ids: string[]): Promise<Map<string, PendingItem>> {
  const out = new Map<string, PendingItem>();
  if (!ids.length) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.employee_id, b.onboarding_token,
            (b.onboarding_token IS NOT NULL AND b.onboarding_token_expires_at > NOW()) AS token_valid
       FROM ats_onboarding_bridge b
       JOIN employees e ON e.id = b.employee_id
      WHERE b.employee_id IN (${ids.map(() => '?').join(',')})
        AND e.active_status = 1 AND e.employment_status != 'terminated'
        AND COALESCE(b.digilocker_status, 'not_started') != 'documents_received'`,
    ids,
  );
  for (const r of rows as RowDataPacket[]) {
    out.set(String(r.employee_id), {
      items: ['Verify your identity documents through DigiLocker'],
      link: r.token_valid ? buildAppLink('/onboard-full', { token: String(r.onboarding_token) }) : null,
    });
  }
  return out;
}

const COPY: Record<PendencyKind, { subject: string; heading: string; intro: string; cta: string; hint?: string }> = {
  esi_docs: {
    subject: 'Action needed: upload your documents for ESI registration',
    heading: 'Documents needed for your ESI registration',
    intro: 'We cannot complete your ESI registration until the following are on your profile:',
    cta: 'Upload documents',
    hint: 'Open Documents on your profile and upload your PAN card, Aadhaar and bank passbook. Your photo can be changed from the picture at the top of your profile.',
  },
  bank_account: {
    subject: 'Action needed: add your bank details',
    heading: 'Your bank details are missing',
    intro: 'Salary cannot be paid until your bank details are on record:',
    cta: 'Add bank details',
    hint: 'Open the Statutory tab on your profile and fill in your bank details. Payroll verifies them before they take effect.',
  },
  digilocker: {
    subject: 'Action needed: complete your DigiLocker verification',
    heading: 'DigiLocker verification pending',
    intro: 'Your joining formalities are waiting on:',
    cta: 'Continue verification',
    hint: 'This link continues from where you stopped. Your identity documents are fetched securely from DigiLocker.',
  },
};

const LOADERS: Record<PendencyKind, (ids: string[]) => Promise<Map<string, PendingItem>>> = {
  esi_docs: pendingEsi,
  bank_account: pendingBank,
  digilocker: pendingDigilocker,
};

export async function sendPendencyReminders(args: {
  kind: PendencyKind;
  employeeIds: string[];
  sentBy: string | null;
  trigger: 'manual' | 'scheduler';
  now?: Date;
  /** Evaluate every rule but send nothing and write no log row. */
  dryRun?: boolean;
}): Promise<PendencyResult[]> {
  const ids = Array.from(new Set(args.employeeIds.map(String).filter(Boolean)));
  const now = args.now ?? new Date();
  const [pending, contacts, history] = await Promise.all([
    LOADERS[args.kind](ids),
    loadContacts(ids),
    loadHistory(ids, args.kind),
  ]);
  const copy = COPY[args.kind];
  const results: PendencyResult[] = [];

  for (const id of ids) {
    const contact = contacts.get(id);
    const code = contact?.employee_code ?? null;
    const skip = (reason: SkipReason): PendencyResult => ({ employee_id: id, employee_code: code, status: 'skipped', reason });

    const item = pending.get(id);
    if (!contact || !item) { results.push(skip('not_pending')); continue; }

    const h = history.get(id);
    const cool = cooldownDecision(h?.sent ?? 0, h?.last ?? null, now);
    if (cool) { results.push(skip(cool)); continue; }

    if (!item.link) { results.push(skip('no_valid_link')); continue; }
    const to = pickRecipient(contact as any);
    if (!to) { results.push(skip('no_email')); continue; }

    if (args.dryRun) { results.push({ employee_id: id, employee_code: code, status: 'would_send' }); continue; }

    const { html, text } = buildPendencyEmail({
      name: contact.first_name?.trim() || 'there',
      heading: copy.heading,
      intro: copy.intro,
      items: item.items,
      ctaLabel: copy.cta,
      ctaUrl: item.link,
      hint: copy.hint,
    });

    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    try {
      await emailService.send({ to, subject: copy.subject, html, text });
    } catch (err) {
      status = 'failed';
      error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    }

    await db.execute(
      `INSERT INTO pendency_reminder_log
         (id, employee_id, reminder_kind, status, recipient, missing_items, link_url, trigger_source, sent_by, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), id, args.kind, status, to, JSON.stringify(item.items), item.link.slice(0, 500), args.trigger, args.sentBy, error],
    ).catch((e) => console.error('[pendency] log insert failed', (e as Error).message));

    results.push(status === 'sent'
      ? { employee_id: id, employee_code: code, status: 'sent' }
      : { employee_id: id, employee_code: code, status: 'failed', reason: error ?? 'send_failed' });
  }
  return results;
}

/**
 * Employees currently pending for a kind, for the scheduler. Population rules match the
 * per-kind loaders above; `limit` keeps one run from becoming a mail burst.
 */
export async function listPendingEmployeeIds(kind: PendencyKind, limit: number): Promise<string[]> {
  const cap = Math.max(1, Math.min(Math.floor(limit), 500));
  let sql: string;
  switch (kind) {
    case 'esi_docs':
      sql = `SELECT e.id FROM employees e
               JOIN employee_statutory_info esi ON esi.employee_id = e.id
              WHERE e.active_status = 1 AND esi.esi_eligible = 1 AND ${ESI_STILL_APPLICABLE_SQL}
                AND COALESCE(NULLIF(e.esic_number, ''), NULLIF(esi.esi_number, '')) IS NULL
                AND e.employment_status != 'terminated'
              ORDER BY e.employee_code LIMIT ${cap}`;
      break;
    case 'bank_account':
      sql = `SELECT e.id FROM employees e
              WHERE e.active_status = 1 AND e.employment_status != 'terminated'
                AND NOT EXISTS (SELECT 1 FROM employee_bank_detail b
                                 WHERE b.employee_id = e.id AND b.is_primary = 1
                                   AND b.ifsc_code IS NOT NULL AND b.ifsc_code != '')
              ORDER BY e.employee_code LIMIT ${cap}`;
      break;
    case 'digilocker':
      sql = `SELECT e.id FROM ats_onboarding_bridge b
               JOIN employees e ON e.id = b.employee_id
              WHERE e.active_status = 1 AND e.employment_status != 'terminated'
                AND COALESCE(b.digilocker_status, 'not_started') != 'documents_received'
                AND b.onboarding_token IS NOT NULL AND b.onboarding_token_expires_at > NOW()
              ORDER BY e.employee_code LIMIT ${cap}`;
      break;
  }
  const [rows] = await db.execute<RowDataPacket[]>(sql);
  return (rows as RowDataPacket[]).map((r) => String(r.id));
}
