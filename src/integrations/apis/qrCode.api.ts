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
      // 4 modules is the quiet zone the QR spec requires. It was 1, which left the
      // finder patterns butted against whatever the code was drawn on and made the
      // symbol unreadable to most scanners.
      margin: 4,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return `${QR_SERVER_URL}?size=${size}x${size}&data=${encodeURIComponent(data)}`;
  }
}

const MONTH_INDEX: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

/**
 * "June - 2026" → "2026-06". Keeps the QR payload short: the spelled-out form
 * encodes as "June%20-%202026" (16 chars), which pushes the symbol up a version
 * and shrinks each module past what a phone can resolve at screen resolution.
 * Unrecognised input is passed through so the QR still points somewhere valid.
 */
function compactPeriod(monthYear: string): string {
  const parts = String(monthYear ?? "").trim().split(/\s*-\s*|\s+/).filter(Boolean);
  if (parts.length === 2) {
    const month = MONTH_INDEX[parts[0].toLowerCase()];
    if (month && /^\d{4}$/.test(parts[1])) return `${parts[1]}-${month}`;
  }
  return monthYear;
}

/** Payslip QR → opens public payslip verification page */
export function buildPayslipQrData(employeeCode: string, monthYear: string): string {
  return `${APP_BASE_URL}/verify/payslip/${encodeURIComponent(employeeCode)}/${encodeURIComponent(compactPeriod(monthYear))}`;
}

/** Employee ID card QR → opens public employee verification page */
export function buildEmployeeIdQrData(employeeCode: string, _employeeId: string): string {
  return `${APP_BASE_URL}/verify/emp/${encodeURIComponent(employeeCode)}`;
}

/**
 * Visitor entry QR → opens the public self-registration form.
 * This is what reception prints or shows on a screen so an arriving visitor can
 * scan straight into the form instead of being told a URL to type.
 */
export function buildVisitorRegisterQrData(branchId?: string): string {
  const base = `${APP_BASE_URL}/visitor-register`;
  return branchId ? `${base}?branch=${encodeURIComponent(branchId)}` : base;
}

/** Visitor status QR → opens that visitor's own tracking page */
export function buildVisitorStatusQrData(trackingToken: string): string {
  return `${APP_BASE_URL}/visitor-status/${encodeURIComponent(trackingToken)}`;
}

/**
 * Gate pass QR → opens the security verification screen with the pass already
 * resolved (Phase 4 of Asset & Material Exit Pass).
 *
 * A URL rather than a bare token, for the same reason every other QR in this
 * file is a URL: the guard's own phone camera app becomes a working scanner, so
 * the feature needs no in-page camera support and no scanning dependency to be
 * usable on every device at every gate. /security/exit-pass-verify is behind
 * ProtectedRoute + a page-code Gate, so scanning still lands on a login if the
 * guard's session has lapsed — which is correct, not a gap.
 *
 * The token proves the printed pass was physically present. It authorises
 * nothing: recording the exit is a separate POST that re-checks the guard's
 * role and the pass's status server-side.
 */
export function buildExitPassQrData(qrToken: string): string {
  return `${APP_BASE_URL}/security/exit-pass-verify?t=${encodeURIComponent(qrToken)}`;
}
