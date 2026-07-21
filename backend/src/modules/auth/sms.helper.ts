import { providerFactory } from '../communication/providers/provider.factory.js';
import { providerConfigService } from '../communication/provider-config.service.js';
import { buildSMS } from '../communication/smartping-dlt-registry.js';

export async function sendOtpSms(phone: string, otpCode: string): Promise<boolean> {
  try {
    const dbConfig = await providerConfigService.loadActiveConfig('sms');
    const provider = await providerFactory.getProviderAsync('sms', dbConfig);

    if (!provider.validateRecipient(phone)) {
      console.error(`[OTP SMS] Invalid phone format: ${phone}`);
      return false;
    }

    const { body, dltContentId } = buildSMS('hrms_login_otp', {
      otp: otpCode,
      validity_minutes: '10',
    });

    // Patch content id into env for this send
    const prev = process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID;
    process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID = dltContentId;
    let result;
    try {
      result = await provider.send(phone, 'OTP', body);
    } finally {
      if (prev !== undefined) process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID = prev;
      else delete process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID;
    }

    console.log(`[OTP SMS] Sent to ${phone.slice(-4).padStart(10, '*')}: ${result.success ? 'SUCCESS' : result.error}`);
    return result.success;
  } catch (error) {
    console.error(`[OTP SMS] Failed to send to ${phone}:`, error);
    return false;
  }
}
