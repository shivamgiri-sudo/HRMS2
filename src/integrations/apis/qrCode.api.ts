import QRCode from "qrcode";

const APP_BASE_URL = import.meta.env.VITE_APP_URL ?? "https://mcnhrms.teammas.in";

const QR_SERVER_URL = "https://api.qrserver.com/v1/create-qr-code/";

/**
 * Build QR as data URL using local library, falling back to external API.
 */
export async function buildQrCodeUrl(data: string, size = 120): Promise<string> {
  try {
    return await QRCode.toDataURL(data, {
      width: size,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return `${QR_SERVER_URL}?size=${size}x${size}&data=${encodeURIComponent(data)}`;
  }
}

/** Payslip QR → opens public payslip verification page */
export function buildPayslipQrData(employeeCode: string, monthYear: string): string {
  return `${APP_BASE_URL}/verify/payslip/${encodeURIComponent(employeeCode)}/${encodeURIComponent(monthYear)}`;
}

/** Employee ID card QR → opens public employee verification page */
export function buildEmployeeIdQrData(employeeCode: string, _employeeId: string): string {
  return `${APP_BASE_URL}/verify/emp/${encodeURIComponent(employeeCode)}`;
}
