export type PiiFieldType = "aadhaar" | "pan" | "bank_account" | "mobile" | "email" | "upi_id";

export function maskPii(value: string | null | undefined, type: PiiFieldType): string {
  if (!value) return "";
  switch (type) {
    case "aadhaar":
      return value.replace(/\d(?=\d{4})/g, "X");
    case "pan":
      return value.slice(0, 2) + "XXXXX" + value.slice(-3);
    case "bank_account":
      return "X".repeat(Math.max(0, value.length - 4)) + value.slice(-4);
    case "mobile":
      return value.slice(0, 2) + "XXXXX" + value.slice(-3);
    case "email": {
      const [local, domain] = value.split("@");
      if (!domain) return value.slice(0, 2) + "***";
      return local.slice(0, 2) + "***@" + domain;
    }
    case "upi_id":
      return value.slice(0, 2) + "***@" + value.split("@")[1];
    default:
      return "***";
  }
}

// maskEmployeeRecord used to live here — a second, competing employee-record masker with
// its own role list (admin/hr/finance/payroll), alongside redactEmployeeIdentifiers.ts's
// IDENTIFIER_FIELDS + RAW_IDENTIFIER_ROLES, which is what GET /api/employees/:id actually
// uses. Zero call sites anywhere in the backend — confirmed unreferenced (profile-trust-audit,
// 2026-08-13; re-verified before deletion). Removed rather than kept alongside the real one,
// per fieldOwnership.ts: PII masking should have exactly one implementation, not two that can
// silently drift apart on which roles/fields they cover.
