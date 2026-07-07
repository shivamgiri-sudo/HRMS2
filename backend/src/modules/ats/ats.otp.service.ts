import { providerFactory } from '../communication/providers/provider.factory.js';
import { providerConfigService } from '../communication/provider-config.service.js';
import { sendOnboardingOtp } from './ats.email.service.js';

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
      // Compose OTP SMS message
      const message = `Your OTP for MAS Callnet Onboarding is: ${otp}. Valid for 10 minutes. Do not share this code with anyone.`;

      const result = await smsProvider.send(formattedMobile, 'OTP Verification', message);

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
