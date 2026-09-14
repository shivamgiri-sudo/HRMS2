/**
 * SMS helper — single import point for sending DLT-compliant SMS via SmartPing.
 *
 * Usage:
 *   import { sendSMS } from '../communication/sms.helper.js';
 *   await sendSMS('9876543210', 'hrms_login_otp', { otp: '123456', validity_minutes: '5' });
 */

import { buildSMS, listTemplates } from './smartping-dlt-registry.js';
import { SmartPingProvider } from './providers/sms/smartping.provider.js';
import { logger } from '../../logger.js';

const provider = new SmartPingProvider();

/**
 * Send a DLT-registered SMS.
 * dltContentId is passed as the `subject` field (unused for SMS) to avoid env mutation.
 */
export async function sendSMS(
  mobile: string,
  templateKey: string,
  variables: Record<string, string | number>,
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  try {
    const { body, dltContentId } = buildSMS(templateKey, variables);
    const result = await provider.send(mobile, dltContentId, body);
    if (!result.success) {
      logger.warn(`[SMS] Failed "${templateKey}" to ${mobile.slice(-4).padStart(mobile.length, '*')}: ${result.error}`);
    }
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`[SMS] sendSMS error for template "${templateKey}": ${error}`);
    return { success: false, error };
  }
}

export { listTemplates };
