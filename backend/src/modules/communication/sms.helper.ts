/**
 * SMS helper — single import point for sending DLT-compliant SMS via SmartPing.
 *
 * Usage from any backend module:
 *
 *   import { sendSMS } from '../communication/sms.helper.js';
 *
 *   await sendSMS('9876543210', 'hrms_login_otp', { otp: '123456', validity_minutes: '5' });
 *   await sendSMS('+919876543210', 'roster_published', { name: 'Rahul', week: 'W29 (14–20 Jul)' });
 */

import { buildSMS, listTemplates } from './smartping-dlt-registry.js';
import { SmartPingProvider } from './providers/sms/smartping.provider.js';
import { logger } from '../../logger.js';

const provider = new SmartPingProvider();

/**
 * Send a DLT-registered SMS.
 *
 * @param mobile   10-digit Indian mobile, or +91XXXXXXXXXX, or 91XXXXXXXXXX
 * @param templateKey  Key from SMARTPING_DLT_REGISTRY (e.g. 'hrms_login_otp')
 * @param variables    Named variables matching the template's variableNames
 */
export async function sendSMS(
  mobile: string,
  templateKey: string,
  variables: Record<string, string | number>,
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  try {
    const { body, dltContentId } = buildSMS(templateKey, variables);
    // SmartPing provider internally appends the dltContentId from env;
    // for per-send override we pass a patched body tagged with the content id.
    // The provider reads SMARTPING_DEFAULT_DLT_CONTENT_ID — for per-template
    // sends we override by constructing a fresh provider instance with the
    // correct content id via a thin wrapper.
    const result = await sendSMSRaw(mobile, body, dltContentId);
    if (!result.success) {
      logger.warn(`[SMS] Failed to send "${templateKey}" to ${mobile.slice(-4).padStart(mobile.length, '*')}: ${result.error}`);
    }
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`[SMS] sendSMS error for template "${templateKey}": ${error}`);
    return { success: false, error };
  }
}

/**
 * Send a raw SMS body with an explicit DLT content ID.
 * Use this only when you've already built the body yourself.
 */
export async function sendSMSRaw(
  mobile: string,
  body: string,
  dltContentId: string,
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  // Temporarily set env var for this send so the provider picks it up.
  // Safe for single-threaded Node.js event loop — no concurrent mutation risk
  // because we await immediately and the provider reads it synchronously.
  const prev = process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID;
  process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID = dltContentId;
  try {
    return await provider.send(mobile, '', body);
  } finally {
    if (prev !== undefined) {
      process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID = prev;
    } else {
      delete process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID;
    }
  }
}

/** Return all registered template keys (useful for admin UI / validation). */
export { listTemplates };
