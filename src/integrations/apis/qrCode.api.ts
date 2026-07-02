/**
 * QR Code generation using free QR Server API (no API key needed)
 * QR codes encode real verification URLs so scanning opens a browser page.
 */

const APP_BASE_URL = import.meta.env.VITE_APP_URL ?? "https://mcnhrms.teammas.in";

export function buildQrCodeUrl(data: string, size = 120): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

/** Payslip QR → opens public payslip verification page */
export function buildPayslipQrData(employeeCode: string, monthYear: string): string {
  return `${APP_BASE_URL}/verify/payslip/${encodeURIComponent(employeeCode)}/${encodeURIComponent(monthYear)}`;
}

/** Employee ID card QR → opens public employee verification page */
export function buildEmployeeIdQrData(employeeCode: string, _employeeId: string): string {
  return `${APP_BASE_URL}/verify/emp/${encodeURIComponent(employeeCode)}`;
}
