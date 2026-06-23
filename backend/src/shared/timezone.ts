const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function toIST(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return null;
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
