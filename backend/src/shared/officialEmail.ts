export const OFFICIAL_EMAIL_DOMAINS = ["teammas.in", "teammas.co.in"] as const;

export function isOfficialEmail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return OFFICIAL_EMAIL_DOMAINS.some((domain) => normalized.endsWith(`@${domain}`));
}

export const OFFICIAL_EMAIL_MESSAGE =
  "Official email must use @teammas.in or @teammas.co.in";
