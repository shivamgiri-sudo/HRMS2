import { SmartPingProvider } from '../communication/providers/sms/smartping.provider.js';
import { buildSMS } from '../communication/smartping-dlt-registry.js';

const provider = new SmartPingProvider();

export async function sendOtpSms(phone: string, otpCode: string): Promise<boolean> {
  try {
    if (!provider.validateRecipient(phone)) {
      console.error(`[OTP SMS] Invalid phone format: ${phone}`);
      return false;
    }

    const { body, dltContentId } = buildSMS('hrms_login_otp', {
      otp: otpCode,
      validity_minutes: '10',
    });

    const result = await provider.send(phone, dltContentId, body);
    console.log(`[OTP SMS] Sent to ${phone.slice(-4).padStart(10, '*')}: ${result.success ? 'SUCCESS' : result.error}`);
    return result.success;
  } catch (error) {
    console.error(`[OTP SMS] Failed to send to ${phone}:`, error);
    return false;
  }
}
