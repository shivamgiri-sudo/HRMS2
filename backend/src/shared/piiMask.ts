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

export function maskEmployeeRecord(record: Record<string, unknown>, role: string): Record<string, unknown> {
  const isPrivileged = ["admin", "hr", "finance", "payroll"].includes(role);
  if (isPrivileged) return record;
  const masked = { ...record };
  if (masked.mobile)         masked.mobile = maskPii(String(masked.mobile), "mobile");
  if (masked.pan_number)     masked.pan_number = maskPii(String(masked.pan_number), "pan");
  if (masked.aadhaar_number) masked.aadhaar_number = maskPii(String(masked.aadhaar_number), "aadhaar");
  if (masked.upi_id)         masked.upi_id = maskPii(String(masked.upi_id), "upi_id");
  return masked;
}
