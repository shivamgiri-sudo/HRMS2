/** Send guardrails for auto-outreach. Pure so the orchestrator and tests share one definition. */
export interface GuardrailInput {
  now: Date; // absolute instant
  consent: boolean; // active whatsapp_contact consent
  optedOut: boolean;
  paused: boolean; // global or per-drive pause switch
  sentToday: number; // messages to this lead in the IST day
  lastSentAt: Date | null;
  requisitionOpen: boolean;
  quietStartHour?: number; // IST, default 20 (no sends from 20:00)
  quietEndHour?: number; // IST, default 9
  dailyCap?: number; // default 2
  minGapMinutes?: number; // default 120
}

export type GuardrailVerdict = { ok: true } | { ok: false; reason: string };

/** Hour of day in IST regardless of server TZ. */
export function istHour(d: Date): number {
  return new Date(d.getTime() + 330 * 60_000).getUTCHours();
}

export function checkSendAllowed(i: GuardrailInput): GuardrailVerdict {
  const dailyCap = i.dailyCap ?? 2;
  const gap = i.minGapMinutes ?? 120;
  const qs = i.quietStartHour ?? 20;
  const qe = i.quietEndHour ?? 9;
  if (i.paused) return { ok: false, reason: "paused" };
  if (i.optedOut) return { ok: false, reason: "opted_out" };
  if (!i.consent) return { ok: false, reason: "no_consent" };
  if (!i.requisitionOpen) return { ok: false, reason: "requisition_closed" };
  const h = istHour(i.now);
  if (h >= qs || h < qe) return { ok: false, reason: "quiet_hours" };
  if (i.sentToday >= dailyCap) return { ok: false, reason: "daily_cap" };
  if (i.lastSentAt && i.now.getTime() - i.lastSentAt.getTime() < gap * 60_000) return { ok: false, reason: "min_gap" };
  return { ok: true };
}
