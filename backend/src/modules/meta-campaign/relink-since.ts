/** `since` = an IST day (YYYY-MM-DD): only leads filled on or after 00:00 IST of that day are considered by a relink. */
export const validSince = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
