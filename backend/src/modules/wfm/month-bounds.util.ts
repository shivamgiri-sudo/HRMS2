/**
 * Sargable replacement for `DATE_FORMAT(col, '%Y-%m') = ?`.
 * Returns [firstDayOfMonth, firstDayOfNextMonth) as YYYY-MM-DD strings so callers can write
 * `col >= ? AND col < ?`. Anything that is not a real YYYY-MM returns [null, null], which
 * matches nothing (as the old DATE_FORMAT equality did for such input).
 */
export function monthBounds(month: string): [string | null, string | null] {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month));
  if (!m) return [null, null];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y < 1000 || mo < 1 || mo > 12) return [null, null];
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return [`${y}-${pad(mo)}-01`, `${ny}-${pad(nm)}-01`];
}
