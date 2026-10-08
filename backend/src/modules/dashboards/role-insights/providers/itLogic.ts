/** Pure IT-dashboard calculations (unit-tested). */
export interface QueueTask {
  requestType: "join" | "exit";
  taskCode: string;
  requestedAt: string;
  slaDueAt: string | null;
  employeeCode: string;
  employeeActive: boolean;
}

/**
 * Bucket a provisioning task code. The legacy stats used LIKE '%domain%', '%email%', '%asset%'
 * independently, so the single IT_EMAIL_DOMAIN_ASSET task counted three times (domain + email + asset)
 * and exit tasks (domain_delete / email_delete) were counted as joiner "domain" and "email" work.
 */
export function classifyTask(code: string): string {
  const c = code.toLowerCase();
  if (c === "it_email_domain_asset") return "Email + domain + asset";
  if (c.includes("biometric") || c.includes("id_card")) return "Biometric / ID card";
  if (c.includes("domain")) return "Domain";
  if (c.includes("email")) return "Email";
  if (c.includes("asset")) return "Asset";
  return code;
}

export function ageBuckets(ages: number[]): Array<{ label: string; value: number }> {
  const defs: Array<[string, (a: number) => boolean]> = [["0-1d", (a) => a <= 1], ["2-3d", (a) => a >= 2 && a <= 3], ["4-7d", (a) => a >= 4 && a <= 7], ["8-30d", (a) => a >= 8 && a <= 30], [">30d", (a) => a > 30]];
  return defs.map(([label, f]) => ({ label, value: ages.filter(f).length }));
}

/** Resolved-within-SLA share; null when no resolved ticket carries an SLA (never a false 0/100). */
export function slaCompliance(met: number | null, withSla: number | null): number | null {
  if (met === null || withSla === null || withSla <= 0) return null;
  return Math.round((met / withSla) * 1000) / 10;
}
