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
