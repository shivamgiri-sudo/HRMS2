import { providerFactory } from '../communication/providers/provider.factory.js';
import { providerConfigService } from '../communication/provider-config.service.js';
import { buildSMS } from '../communication/smartping-dlt-registry.js';
import { sendOnboardingOtp as sendOnboardingOtpEmail } from './ats.email.service.js';

/**
 * Must match the caller's expiry. onboarding-full.routes.ts inserts the OTP with
 * `expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE)`, and the SMS states this number to the
 * candidate, so the two cannot drift without telling people the wrong thing.
 */
const OTP_VALIDITY_MINUTES = 10;

interface SendOtpResult {
  smsSuccess: boolean;
  smsError?: string;
  emailSuccess: boolean;
  emailError?: string;
  /** True if at least one channel succeeded. */
  success: boolean;
}

interface SendOtpParams {
  mobile: string;
  otp: string;
  candidateName: string;
  email?: string | null;
}

/**
 * Sends the same OTP over BOTH SMS and email on every request — not a
 * fallback chain. Used to try SMS once and only email if SMS failed, which
 * is why candidates only ever saw the code arrive by email: as long as SMS
 * failed for ANY reason (a transient provider error, a format quirk), email
 * silently took over and nobody's phone got anything. Both channels are now
 * always attempted, independently, so a candidate who has a working phone
 * always gets it there too, regardless of what happens to the other channel.
 */
export async function sendOnboardingOtp(params: SendOtpParams): Promise<SendOtpResult> {
  const { mobile, otp, candidateName, email } = params;

  let smsSuccess = false;
  let smsError: string | undefined;

  const cleanMobile = mobile.replace(/\D/g, '');
  if (!cleanMobile || cleanMobile.length < 10) {
    smsError = 'Invalid mobile number format';
  } else {
    const formattedMobile = cleanMobile.startsWith('91') ? `+${cleanMobile}` : `+91${cleanMobile}`;
    try {
      const dbConfig = await providerConfigService.loadActiveConfig('sms');
      const smsProvider = await providerFactory.getProviderAsync('sms', dbConfig);

      if (!smsProvider.validateRecipient(formattedMobile)) {
        smsError = `Invalid mobile format for SMS provider: ${formattedMobile}`;
      } else {
        // Built from the registered DLT template, never hand-written.
        //
        // This call used to pass the literal string 'OTP Verification' in the dltContentId slot
        // along with a bespoke message. SmartPing requires a numeric DLT id there, so the
        // provider rejected every send — observed live in production:
        //   [OTP] SMS send failed: No registered DLT template for this message ...
        //   received "OTP Verification". Not sent.
        // Fixed 2026-08-10 (see otp-sms-dlt.contract.test.ts, which locks this in). Under
        // India's TRAI DLT rules the delivered text must MATCH the registered template, so
        // buildSMS interpolates the registered text and returns its id — the only way to keep
        // both correct together.
        const { body, dltContentId } = buildSMS('candidate_mobile_otp', {
          otp,
          validity_minutes: OTP_VALIDITY_MINUTES,
        });

        const result = await smsProvider.send(formattedMobile, dltContentId, body);
        if (result.success) {
          smsSuccess = true;
          console.info(`[OTP] SMS sent successfully to ${mobile.slice(-4).padStart(mobile.length, '*')}`);
        } else {
          smsError = result.error;
          console.warn(`[OTP] SMS send failed: ${result.error}`);
        }
      }
    } catch (err) {
      smsError = err instanceof Error ? err.message : String(err);
      console.warn(`[OTP] SMS provider error: ${smsError}`);
    }
  }

  // Always attempted, regardless of the SMS outcome above — this is the fix.
  let emailSuccess = false;
  let emailError: string | undefined;
  if (!email) {
    emailError = 'No email address on file';
  } else {
    try {
      const emailResult = await sendOnboardingOtpEmail({ mobile, otp, candidateName, email });
      if (emailResult && emailResult.ok) {
        emailSuccess = true;
        console.info(`[OTP] Email sent successfully to ${email}`);
      } else {
        emailError = emailResult?.error ?? 'Email send returned no result';
        console.error(`[OTP] Email send failed: ${emailError}`);
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      console.error(`[OTP] Email send exception: ${emailError}`);
    }
  }

  return {
    smsSuccess, smsError, emailSuccess, emailError,
    success: smsSuccess || emailSuccess,
  };
}
