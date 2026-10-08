/** "offer_approved" -> "Offer approved"; names that already read well ("Round 1- HR Screening") are left alone. */
export function humanizeStage(stage: string): string {
  const raw = (stage ?? "").trim();
  if (!raw) return "Unknown";
  if (!/[_]/.test(raw) && /[A-Z]/.test(raw)) return raw;
  const spaced = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
