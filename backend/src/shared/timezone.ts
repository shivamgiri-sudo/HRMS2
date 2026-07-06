const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_NAIVE_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?$/;
const ISO_UTC_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/i;
const ISO_OFFSET_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/;

export function toIST(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;

  // Attendance/biometric tables store IST wall-clock DATETIME values.
  // Return an explicit +05:30 tagged string so the frontend does not apply an
  // extra browser/UTC conversion. This fixes the recurring +5h30m display drift.
  if (typeof value === 'string') {
    const s = value.trim();

    // MySQL date-only values should stay date-only; toISTDate can split safely.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // MySQL DATETIME string: "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss+05:30".
    if (MYSQL_DATETIME_RE.test(s)) {
      return s.replace(' ', 'T') + '+05:30';
    }

    // Some drivers/legacy code serialize IST wall-clock DATETIME values as
    // "YYYY-MM-DDTHH:mm:ss(.sss)Z". Do NOT treat that Z as real UTC for
    // attendance; replace it with +05:30 and preserve the clock time.
    const utcMatch = s.match(ISO_UTC_DATETIME_RE);
    if (utcMatch) {
      return `${utcMatch[1]}T${utcMatch[2]}${utcMatch[3] ?? ''}+05:30`;
    }

    // Naive ISO datetime without timezone is also an IST wall-clock value here.
    const naiveMatch = s.match(ISO_NAIVE_DATETIME_RE);
    if (naiveMatch) {
      return `${naiveMatch[1]}T${naiveMatch[2]}${naiveMatch[3] ?? ''}+05:30`;
    }

    // Already explicitly tagged with an offset; preserve it.
    if (ISO_OFFSET_DATETIME_RE.test(s)) return s;
  }

  // Fallback for actual Date objects (e.g., runtime/system timestamps): convert
  // the instant to an IST wall-clock representation and tag it explicitly.
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

export function nowIST(): string {
  return toIST(new Date()) ?? new Date().toISOString();
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
