import { providerFactory } from '../communication/providers/provider.factory.js';
import { providerConfigService } from '../communication/provider-config.service.js';
import { buildSMS } from '../communication/smartping-dlt-registry.js';
import { sendOnboardingOtp } from './ats.email.service.js';

/**
 * Must match the caller's expiry. onboarding-full.routes.ts inserts the OTP with
 * `expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE)`, and the SMS states this number to the
 * candidate, so the two cannot drift without telling people the wrong thing.
 */
const OTP_VALIDITY_MINUTES = 10;

interface SendOtpResult {
  success: boolean;
  channel: 'sms' | 'email';
  error?: string;
}

interface SendOtpParams {
  mobile: string;
  otp: string;
  candidateName: string;
  email?: string | null;
}

export async function sendOnboardingOtpViaSms(params: SendOtpParams): Promise<SendOtpResult> {
  const { mobile, otp, candidateName, email } = params;

  // Validate mobile number format
  const cleanMobile = mobile.replace(/\D/g, '');
  if (!cleanMobile || cleanMobile.length < 10) {
    return { success: false, channel: 'sms', error: 'Invalid mobile number format' };
  }

  // Format mobile for SMS (add country code if not present)
  const formattedMobile = cleanMobile.startsWith('91') ? `+${cleanMobile}` : `+91${cleanMobile}`;

  // Try SMS first
  try {
    const dbConfig = await providerConfigService.loadActiveConfig('sms');
    const smsProvider = await providerFactory.getProviderAsync('sms', dbConfig);

    // Validate recipient format
    if (!smsProvider.validateRecipient(formattedMobile)) {
      console.warn(`[OTP] Invalid mobile format for SMS provider: ${formattedMobile}`);
      // Fall through to email fallback
    } else {
      // Built from the registered DLT template, never hand-written.
      //
      // This call used to pass the literal string 'OTP Verification' in the dltContentId slot
      // along with a bespoke message. SmartPing requires a numeric DLT id there, so the
      // provider rejected every send — observed live in production:
      //   [OTP] SMS send failed: No registered DLT template for this message ...
      //   received "OTP Verification". Not sent.
      // Candidates therefore never got an onboarding OTP by SMS; every request silently fell
      // through to the email branch below.
      //
      // The bespoke wording was the second half of the bug. Under India's TRAI DLT rules the
      // delivered text must MATCH the registered template, so even had the id been right, a
      // hand-written sentence would have been a compliance failure rather than a delivery one.
      // buildSMS interpolates the registered text and returns its id, which is the only way to
      // keep both correct together.
      const { body, dltContentId } = buildSMS('candidate_mobile_otp', {
        otp,
        validity_minutes: OTP_VALIDITY_MINUTES,
      });

      const result = await smsProvider.send(formattedMobile, dltContentId, body);

      if (result.success) {
        console.info(`[OTP] SMS sent successfully to ${mobile.slice(-4).padStart(mobile.length, '*')}`);
        return { success: true, channel: 'sms' };
      } else {
        console.warn(`[OTP] SMS send failed: ${result.error}`);
        // Fall through to email fallback
      }
    }
  } catch (smsError) {
    const errorMsg = smsError instanceof Error ? smsError.message : String(smsError);
    console.warn(`[OTP] SMS provider error: ${errorMsg}`);
    // Fall through to email fallback
  }

  // Fallback to email if SMS failed or no SMS provider configured
  if (!email) {
    return {
      success: false,
      channel: 'email',
      error: 'SMS delivery failed and no email address available for fallback'
    };
  }

  try {
    const emailResult = await sendOnboardingOtp({ mobile, otp, candidateName, email });

    if (emailResult && emailResult.ok) {
      console.info(`[OTP] Email fallback sent successfully to ${email}`);
      return { success: true, channel: 'email' };
    } else {
      const emailError = emailResult?.error ?? 'Email send returned no result';
      console.error(`[OTP] Email fallback failed: ${emailError}`);
      return {
        success: false,
        channel: 'email',
        error: `Both SMS and email delivery failed: ${emailError}`
      };
    }
  } catch (emailError) {
    const errorMsg = emailError instanceof Error ? emailError.message : String(emailError);
    console.error(`[OTP] Email fallback exception: ${errorMsg}`);
    return {
      success: false,
      channel: 'email',
      error: `Both SMS and email delivery failed: ${errorMsg}`
    };
  }
}
