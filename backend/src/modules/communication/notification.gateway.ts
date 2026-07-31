/**
 * notificationGateway — the single door every new notification goes through.
 *
 * Order matters, and it is: kill switch -> resolve -> deny-list -> claim -> deliver.
 * The claim is written BEFORE delivery, so a crash mid-send loses a message instead of
 * duplicating it. For payroll and escalation mail that is the right trade.
 *
 * Why a gateway rather than calling dispatchService directly: there has to be one place
 * to hang the kill switch, the deny-list and the dedupe claim. Bolting them onto
 * dispatchService would change behaviour for the 24 existing send sites that already
 * call it; putting them here leaves those untouched.
 *
 * PHASE 1A IS INERT BY CONSTRUCTION. No delivery function is registered, so a 'live'
 * event throws NOT_WIRED rather than silently doing nothing. Phase 1c registers the real
 * one. Shadow mode is fully functional now — that is the point: it produces the evidence
 * you review before anything is allowed to send.
 */
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { db } from '../../db/mysql.js';
import { resolveRecipients } from '../../shared/recipient-resolver.js';
import { RecipientResolutionError } from '../../shared/recipient-resolver.types.js';
import type {
  RecipientContext, RecipientResolution, RecipientSpec, Sensitivity,
} from '../../shared/recipient-resolver.types.js';
import { maskEmail } from '../../shared/email-domains.js';

export interface NotifyInput {
  eventCode: string;
  /**
   * Identity of "this notification about this thing, once".
   * Convention: '<entity_type>:<entity_id>[:<discriminator>]'.
   * Include the discriminator whenever the same entity legitimately notifies more than
   * once — escalation levels, for example, are ':level2', ':level3'.
   */
  dedupeKey: string;
  context: RecipientContext;
  /** Template variables, including the analytics-strip figures. */
  data?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  /** Overrides the configured spec. For tests and one-off admin sends only. */
  specOverride?: RecipientSpec;
}

export type NotifyOutcome =
  | 'sent'
  | 'shadow'        // resolved and claimed; deliberately not delivered
  | 'duplicate'     // another claim already exists for this dedupe key
  | 'cooldown'      // same event+entity notified inside the cooldown window
  | 'disabled'      // kill switch off, or event not registered
  | 'capped'        // daily cap reached
  | 'undeliverable' // nobody resolvable — see `dropped`
  | 'blocked';      // deny-list refused it

export interface NotifyResult {
  outcome: NotifyOutcome;
  claimId?: string;
  recipients?: { to: number; cc: number; bcc: number };
  dropped?: RecipientResolution['dropped'];
  reason?: string;
}

interface EventConfigRow extends RowDataPacket {
  event_code: string;
  enabled: number;
  dispatch_mode: 'shadow' | 'live' | 'off';
  sensitivity: Sensitivity;
  is_critical: number;
  recipient_spec: string | Record<string, unknown>;
  backfill_floor_at: Date | null;
  max_per_day: number;
  cooldown_minutes: number;
  template_key: string | null;
}

/** What a delivery implementation must satisfy. Registered in phase 1c. */
export interface NotificationDeliverer {
  deliver(args: {
    eventCode: string;
    templateKey: string | null;
    data: Record<string, unknown>;
    resolution: RecipientResolution;
    isCritical: boolean;
    correlationId?: string;
  }): Promise<{ dispatchLogId?: string }>;
}

let deliverer: NotificationDeliverer | null = null;

/** Phase 1c calls this at bootstrap. Until then, 'live' events refuse to run. */
export function registerDeliverer(impl: NotificationDeliverer): void {
  deliverer = impl;
}

/** Test seam. */
export function __resetDeliverer(): void {
  deliverer = null;
}

async function loadEventConfig(eventCode: string): Promise<EventConfigRow | null> {
  try {
    const [rows] = await db.execute<EventConfigRow[]>(
      `SELECT event_code, enabled, dispatch_mode, sensitivity, is_critical, recipient_spec,
              backfill_floor_at, max_per_day, cooldown_minutes, template_key
         FROM notification_event_config
        WHERE event_code = ? AND active_status = 1
        LIMIT 1`,
      [eventCode],
    );
    return rows[0] ?? null;
  } catch {
    // Table not yet migrated. Fail CLOSED — the opposite of worker-config, because an
    // unconfigured notification must never send rather than never run.
    return null;
  }
}

export const notificationGateway = {
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const cfg = await loadEventConfig(input.eventCode);

    // Unregistered or switched off. Fail closed, and say which.
    if (!cfg) return { outcome: 'disabled', reason: `event '${input.eventCode}' is not registered` };
    if (!cfg.enabled || cfg.dispatch_mode === 'off') {
      return { outcome: 'disabled', reason: `event '${input.eventCode}' is disabled` };
    }

    const mode: 'shadow' | 'live' = cfg.dispatch_mode === 'live' ? 'live' : 'shadow';

    // Daily cap, counted from real claims rather than an in-memory tally.
    const [[capRow]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM notification_dispatch_claim
        WHERE event_code = ? AND claimed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      [input.eventCode],
    );
    if (Number(capRow?.n ?? 0) >= Number(cfg.max_per_day)) {
      return { outcome: 'capped', reason: `daily cap ${cfg.max_per_day} reached for '${input.eventCode}'` };
    }

    // Cooldown: the same entity should not re-notify while the situation is unchanged.
    // An overdue task stays overdue; nobody needs a daily reminder of the same breach.
    if (Number(cfg.cooldown_minutes) > 0 && input.entityType && input.entityId) {
      const [[recent]] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM notification_dispatch_claim
          WHERE event_code = ? AND entity_type = ? AND entity_id = ?
            AND status IN ('claimed','sent')
            AND claimed_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
        [input.eventCode, input.entityType, input.entityId, cfg.cooldown_minutes],
      );
      if (Number(recent?.n ?? 0) > 0) {
        return { outcome: 'cooldown', reason: `within ${cfg.cooldown_minutes}m cooldown` };
      }
    }

    // Resolve. Both refusals below are thrown by the resolver, never silently filtered.
    const spec: RecipientSpec = input.specOverride ?? normaliseSpec(cfg.recipient_spec);
    let resolution: RecipientResolution;
    try {
      resolution = await resolveRecipients(spec, {
        sensitivity: cfg.sensitivity,
        context: input.context,
        correlationId: input.correlationId,
      });
    } catch (err) {
      if (err instanceof RecipientResolutionError) {
        // Record the refusal so it is visible in the Recipients tab rather than lost in a log.
        // null here means a concurrent worker already claimed it — the refusal is still
        // reported to this caller, it is simply already recorded.
        const claimId = await writeClaim(input, mode, 'suppressed', null, err.message);
        return {
          outcome: err.code === 'CLIENT_AUDIENCE' || err.code === 'FIN_HAS_CC' ? 'blocked' : 'undeliverable',
          claimId: claimId ?? undefined,
          dropped: err.resolution?.dropped,
          reason: err.message,
        };
      }
      throw err;
    }

    // Claim BEFORE delivering. A duplicate key here means a concurrent worker already
    // owns this notification — losing the race is the correct outcome, not an error.
    const claimId = await writeClaim(input, mode, 'claimed', resolution, null);
    if (!claimId) return { outcome: 'duplicate', reason: 'claim already exists' };

    const counts = { to: resolution.to.length, cc: resolution.cc.length, bcc: resolution.bcc.length };

    if (mode === 'shadow') {
      await completeClaim(claimId, 'suppressed', null, null);
      return { outcome: 'shadow', claimId, recipients: counts, dropped: resolution.dropped };
    }

    if (!deliverer) {
      // Phase 1a. Loud rather than silent: an event configured 'live' with no sender is a
      // misconfiguration, and pretending to succeed would hide it.
      await completeClaim(claimId, 'failed', null, 'NOT_WIRED: no deliverer registered');
      throw new Error(
        `Event '${input.eventCode}' is configured live but no NotificationDeliverer is registered ` +
        `(phase 1c wires this). Set dispatch_mode='shadow' until then.`,
      );
    }

    try {
      const { dispatchLogId } = await deliverer.deliver({
        eventCode: input.eventCode,
        templateKey: cfg.template_key,
        data: input.data ?? {},
        resolution,
        isCritical: Number(cfg.is_critical) === 1,
        correlationId: input.correlationId,
      });
      await completeClaim(claimId, 'sent', dispatchLogId ?? null, null);
      return { outcome: 'sent', claimId, recipients: counts, dropped: resolution.dropped };
    } catch (err) {
      await completeClaim(claimId, 'failed', null, (err as Error).message.slice(0, 500));
      throw err;
    }
  },
};

/** Accepts a JSON column that mysql2 may hand back already parsed. */
function normaliseSpec(raw: string | Record<string, unknown>): RecipientSpec {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return obj as RecipientSpec;
}

/**
 * Returns the claim id, or null when the unique key rejected it (another worker won).
 * Only addresses in masked form reach recipient_digest — support reads this table.
 */
async function writeClaim(
  input: NotifyInput,
  mode: 'shadow' | 'live',
  status: 'claimed' | 'suppressed',
  resolution: RecipientResolution | null,
  errorMessage: string | null,
): Promise<string | null> {
  const digest = resolution
    ? {
        to: resolution.to.map((r) => maskEmail(r.email)),
        cc: resolution.cc.map((r) => maskEmail(r.email)),
        bcc: resolution.bcc.map((r) => maskEmail(r.email)),
        via: [...resolution.to, ...resolution.cc, ...resolution.bcc].map((r) => r.viaSelector),
        dropped: resolution.dropped,
      }
    : null;

  try {
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO notification_dispatch_claim
         (id, event_code, dedupe_key, mode, status, recipient_count, cc_count, bcc_count,
          dropped_count, recipient_digest, entity_type, entity_id, correlation_id, error_message)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.eventCode, input.dedupeKey, mode, status,
        resolution?.to.length ?? 0, resolution?.cc.length ?? 0, resolution?.bcc.length ?? 0,
        resolution?.dropped.length ?? 0,
        digest ? JSON.stringify(digest) : null,
        input.entityType ?? null, input.entityId ?? null, input.correlationId ?? null,
        errorMessage,
      ],
    );
    if (!res.affectedRows) return null;
    const [[row]] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM notification_dispatch_claim WHERE event_code = ? AND dedupe_key = ? LIMIT 1',
      [input.eventCode, input.dedupeKey],
    );
    return (row?.id as string) ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return null;
    throw err;
  }
}

async function completeClaim(
  claimId: string,
  status: 'sent' | 'failed' | 'suppressed',
  dispatchLogId: string | null,
  errorMessage: string | null,
): Promise<void> {
  await db.execute(
    `UPDATE notification_dispatch_claim
        SET status = ?, dispatch_log_id = ?, error_message = ?, completed_at = NOW()
      WHERE id = ?`,
    [status, dispatchLogId, errorMessage, claimId],
  );
}
