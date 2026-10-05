/**
 * Outreach cadence (pure): Email -> WhatsApp -> bot call, each step at least `gapMin` (default 60) after the previous.
 * The engine asks "what is the next step for this match?" and does exactly that, so the order and the gap live here
 * and are testable. A reply from the candidate at any point ends the automated sequence (human/bot flow takes over).
 */
export type CadenceStep = "email" | "whatsapp" | "voice";

export interface CadenceFacts {
  now: Date;
  gapMin: number;
  /** Lead has an email address and the mail provider is configured. */
  canEmail: boolean;
  /** WhatsApp consent exists (also required for the bot call). */
  waConsent: boolean;
  emailSentAt: Date | null;
  waSentAt: Date | null;
  voiceAt: Date | null;
  /** Candidate wrote back (or a call result arrived) after the first touch. */
  repliedAfterFirstTouch: boolean;
  quietHours: boolean;
}

export type CadenceDecision = { step: CadenceStep | null; reason: string; waitUntil?: Date };

const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

export function nextCadenceStep(f: CadenceFacts): CadenceDecision {
  if (f.repliedAfterFirstTouch) return { step: null, reason: "replied" };
  if (f.quietHours) return { step: null, reason: "quiet_hours" };

  if (!f.emailSentAt && f.canEmail) return { step: "email", reason: "first_touch_email" };

  if (!f.waSentAt) {
    if (!f.waConsent) return { step: null, reason: f.emailSentAt ? "no_whatsapp_consent" : "no_channel" };
    if (f.emailSentAt) {
      const at = plus(f.emailSentAt, f.gapMin);
      if (f.now < at) return { step: null, reason: "waiting_gap_after_email", waitUntil: at };
    }
    return { step: "whatsapp", reason: f.emailSentAt ? "gap_after_email_elapsed" : "first_touch_whatsapp" };
  }

  if (!f.voiceAt) {
    if (!f.waConsent) return { step: null, reason: "no_whatsapp_consent" };
    const at = plus(f.waSentAt, f.gapMin);
    if (f.now < at) return { step: null, reason: "waiting_gap_after_whatsapp", waitUntil: at };
    return { step: "voice", reason: "gap_after_whatsapp_elapsed" };
  }
  return { step: null, reason: "sequence_complete" };
}

export const cadenceGapMin = (): number => {
  const n = Number(process.env.HE_CADENCE_GAP_MIN);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : 60;
};
