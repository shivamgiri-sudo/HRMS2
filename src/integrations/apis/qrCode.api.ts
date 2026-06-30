/**
 * QR Code generation using free QR Server API (no API key needed)
 */

export function buildQrCodeUrl(data: string, size = 120): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

export function buildPayslipQrData(employeeCode: string, monthYear: string): string {
  return `PAYSLIP|EMP:${employeeCode}|${monthYear}`;
}

export function buildEmployeeIdQrData(employeeCode: string, employeeId: string): string {
  return `EMPID|${employeeCode}|ID:${employeeId}`;
}
