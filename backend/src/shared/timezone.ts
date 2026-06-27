/**
 * Return current time as a MySQL-safe naive IST datetime string: "YYYY-MM-DD HH:mm:ss"
 * Use this instead of new Date().toISOString() when inserting into DATETIME columns.
 * DATETIME has no timezone info — it stores the wall-clock time literally, so we must
 * supply IST time so that toIST() reading it back produces the correct tagged value.
 */
export function nowIST(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  // ISO string is UTC; shifting by +5:30 makes it IST wall-clock, then strip the Z
  return ist.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Convert MySQL DATETIME to ISO8601 IST string.
 * MySQL DATETIME columns store wall-clock time with no timezone (e.g., "2026-06-27 09:15:00").
 * mysql2 driver returns these as Date objects where .getHours()/.getMinutes() reflect the
 * stored digits directly (NOT UTC). This function reads those digits and tags with +05:30.
 *
 * CRITICAL: Do NOT use toIST(Date) on MySQL datetime values - it would add +5:30 offset
 * on top of the IST wall-clock, producing times 5.5 hours ahead (double-IST bug).
 */
export function mysqlDatetimeToIST(d: Date | null | undefined): string | null {
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+05:30`
  );
}

export function toIST(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;

  // With dateStrings:true, mysql2 returns DATETIME as "YYYY-MM-DD HH:mm:ss" strings.
  // These are already stored as IST in the DB — just tag them with +05:30.
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
      return s.replace(' ', 'T') + '+05:30';
    }
    // Already has timezone suffix or ISO format — return as-is
    if (s.includes('T') || s.includes('+') || s.endsWith('Z')) return s;
  }

  // Fallback for actual Date objects (e.g., from non-DB sources)
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return null;
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.toISOString().replace('Z', '+05:30');
}

export function toISTDate(value: Date | string | null | undefined): string | null {
  const s = toIST(value);
  return s ? s.split('T')[0] : null;
}

export function toISTFields<T extends Record<string, unknown>>(
  row: T,
  fields: (keyof T)[],
): T {
  const out = { ...row };
  for (const f of fields) {
    (out as any)[f] = toIST(row[f] as any);
  }
  return out;
}
