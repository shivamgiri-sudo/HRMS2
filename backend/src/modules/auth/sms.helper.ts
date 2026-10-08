import { SmartPingProvider } from '../communication/providers/sms/smartping.provider.js';
import { buildSMS } from '../communication/smartping-dlt-registry.js';

const provider = new SmartPingProvider();

/**
 * templateKey defaults to 'hrms_login_otp' — the only caller until 2026-08-18 was
 * twoFactor.service.ts (a genuine login OTP), so that stayed the hardcoded default rather than
 * a required param, to not touch a working call site. candidate-onboarding.service.ts was
 * ALSO calling this with no way to say otherwise, so every candidate onboarding OTP went out
 * worded "Your OTP for HRMS login is..." — sent successfully (both are valid registered
 * templates, so nothing failed), just under the wrong template. Registry already has a
 * dedicated 'candidate_mobile_otp' template ("...for candidate onboarding verification...")
 * for exactly this; candidate-onboarding.service.ts now passes it explicitly.
 *
 * validityMinutes defaults to '10' for the same backward-compat reason (both existing callers
 * already used a 10-minute OTP) — but is now a real parameter, not a value hardcoded in here
 * independent of what the caller's own expiry actually is. That mismatch is a proven bug
 * pattern in this codebase (otp-sms-dlt.contract.test.ts exists specifically because
 * ats.otp.service.ts's SMS text and its OTP row's real expiry drifted apart once already).
 */
export async function sendOtpSms(
  phone: string,
  otpCode: string,
  templateKey: 'hrms_login_otp' | 'candidate_mobile_otp' | 'password_reset_otp' = 'hrms_login_otp',
  validityMinutes: string | number = '10',
): Promise<boolean> {
  try {
    if (!provider.validateRecipient(phone)) {
      console.error(`[OTP SMS] Invalid phone format: ${phone}`);
      return false;
    }

    const { body, dltContentId } = buildSMS(templateKey, {
      otp: otpCode,
      validity_minutes: validityMinutes,
    });

    const result = await provider.send(phone, dltContentId, body);
    console.log(`[OTP SMS] Sent to ${phone.slice(-4).padStart(10, '*')}: ${result.success ? 'SUCCESS' : result.error}`);
    return result.success;
  } catch (error) {
    console.error(`[OTP SMS] Failed to send to ${phone}:`, error);
    return false;
  }
}
