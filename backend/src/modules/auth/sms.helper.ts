/**
 * SMS Helper for Authentication OTP
 * Simple wrapper around the communication service for sending OTP SMS
 */

import { providerFactory } from '../communication/providers/provider.factory.js';
import { providerConfigService } from '../communication/provider-config.service.js';

export async function sendOtpSms(phone: string, otpCode: string): Promise<boolean> {
  try {
    // Load SMS provider configuration
    const dbConfig = await providerConfigService.loadActiveConfig('sms');
    const provider = await providerFactory.getProviderAsync('sms', dbConfig);

    // Validate phone number format
    if (!provider.validateRecipient(phone)) {
      console.error(`[OTP SMS] Invalid phone format: ${phone}`);
      return false;
    }

    // Compose OTP message
    const message = `Your HRMS password reset OTP is: ${otpCode}. Valid for 10 minutes. Do not share this code with anyone.`;

    // Send SMS
    const result = await provider.send(phone, 'OTP', message);

    console.log(`[OTP SMS] Sent to ${phone}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    return result.success;
  } catch (error) {
    console.error(`[OTP SMS] Failed to send to ${phone}:`, error);
    return false;
  }
}
