/**
 * Outbound voice-bot trigger.
 *
 * The real endpoint contract is UNCONFIRMED (Open Question 2 in the plan — the team has not yet
 * supplied the voice bot's HTTP interface). Rather than guess a shape and ship code that silently
 * posts to nothing, this module:
 *
 *   - is configuration-gated on VOICEBOT_TRIGGER_URL, so with no URL set nothing is attempted and
 *     the caller records "skipped" rather than a failure;
 *   - keeps the request body in ONE place (buildTriggerBody) so that when the real schema arrives,
 *     adapting it is a single edit rather than a hunt through the outreach flow;
 *   - allows the field names to be overridden by env, so a mismatch can be corrected in config
 *     without a deploy.
 *
 * The assumed body, until told otherwise:
 *   { phone, name, language, script_template, callback_url, reference_id }
 */

import axios from 'axios';

export interface VoiceTriggerInput {
  phone: string;
  name: string | null;
  language?: string;
  scriptTemplate?: string;
  /** Our meta_lead_raw.id — echoed back on the callback so we can match the outcome. */
  referenceId: string;
}

export interface VoiceTriggerResult {
  status: 'triggered' | 'skipped' | 'failed';
  detail: string | null;
  providerCallId: string | null;
}

export function isVoicebotConfigured(): boolean {
  return Boolean(process.env.VOICEBOT_TRIGGER_URL);
}

export function buildTriggerBody(input: VoiceTriggerInput): Record<string, unknown> {
  const callbackBase = process.env.VOICEBOT_CALLBACK_BASE_URL ?? process.env.BACKEND_PUBLIC_URL ?? '';
  return {
    phone: input.phone,
    name: input.name ?? '',
    language: input.language ?? process.env.VOICEBOT_DEFAULT_LANGUAGE ?? 'hi',
    script_template: input.scriptTemplate ?? process.env.VOICEBOT_SCRIPT_TEMPLATE ?? 'recruitment_invite',
    callback_url: callbackBase ? `${callbackBase.replace(/\/+$/, '')}/api/meta/voice-callback` : null,
    reference_id: input.referenceId,
  };
}

export async function triggerVoiceCall(input: VoiceTriggerInput): Promise<VoiceTriggerResult> {
  const url = process.env.VOICEBOT_TRIGGER_URL;
  if (!url) {
    return { status: 'skipped', detail: 'VOICEBOT_TRIGGER_URL is not configured', providerCallId: null };
  }

  const authHeader = process.env.VOICEBOT_API_KEY
    ? { Authorization: `Bearer ${process.env.VOICEBOT_API_KEY}` }
    : {};

  try {
    const { data } = await axios.post(url, buildTriggerBody(input), {
      headers: { 'Content-Type': 'application/json', ...authHeader },
      timeout: 15000,
    });
    return {
      status: 'triggered',
      detail: null,
      providerCallId:
        (data?.call_id as string | undefined) ?? (data?.id as string | undefined) ?? null,
    };
  } catch (err) {
    return {
      status: 'failed',
      detail: err instanceof Error ? err.message : String(err),
      providerCallId: null,
    };
  }
}
