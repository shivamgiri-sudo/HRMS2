/**
 * Task 4: Header Alias Engine
 * Scans spreadsheet rows to locate the header row, detect date columns,
 * and map identity/metadata columns to canonical field names.
 */

export interface ColumnMapping {
  sourceHeader: string;
  mappedTo: string | null; // canonical field name, null = goes to extra_metadata_json
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

export interface DateColumn {
  index: number;
  header: string;
  parsedDate: Date;
}

export interface IdentityColumn {
  index: number;
  header: string;
  mapping: ColumnMapping;
}

export interface HeaderDetectionResult {
  headerRowIndex: number;
  dateColumns: DateColumn[];
  identityColumns: IdentityColumn[];
  unmappedColumns: IdentityColumn[]; // columns with mapping.mappedTo === null
}

// Month abbreviation lookup (case-insensitive via lowercased keys)
const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// Identity alias map — canonical field → list of header aliases (all lowercase)
const IDENTITY_ALIASES: Record<string, string[]> = {
  employeeId: ['mas id', 'masid', 'emp code', 'employee id', 'emp id', 'empl number', 'employee number', 'agent id', 'employee code', 'empid'],
  employeeName: ['analyst name', 'name', 'employee name', 'agent name', 'emp name'],
  teammatesId: ['teammates id', 'teammate id', 'teammates'],
  domainId: ['domain id', 'doman id', 'domainid'],
  domainEmail: ['domain', 'domain email', 'email'],
  gender: ['gender', 'sex'],
  batchNumber: ['batch #', 'batch', 'batch number', 'batch no', 'batch_no'],
  contactNumber: ['contact no', 'phone', 'mobile', 'contact', 'contact number'],
  doj: ['doj', 'date of joining', 'join date', 'joining date', 'date of join'],
  dol: ['dol', 'date of leaving', 'exit date', 'leaving date', 'date of exit'],
  aor: ['aor', 'aor date'],
  aorStatus: ['aor current status', 'aor status', 'current status'],
  tlName: ['tl name', 'team leader', 'tl'],
  qualityAuditor: ['quality auditor', 'qa', 'auditor', 'quality'],
  amName: ['am', 'assistant manager', 'am name'],
  designation: ['designation', 'role', 'title', 'position'],
  department: ['dept', 'department'],
  process: ['process', 'campaign', 'account', 'project'],
  lob: ['lob', 'line of business'],
  subLob: ['sub lob', 'sub-lob', 'queue', 'sublob', 'sub_lob'],
  site: ['site', 'location', 'branch', 'office'],
};

// Reverse lookup: lowercase alias → canonical field name (built once at module load)
const ALIAS_TO_CANONICAL: Map<string, string> = new Map();
for (const [canonical, aliases] of Object.entries(IDENTITY_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical);
  }
}

/**
 * Coerce whatever the sheet reader handed back into a header string.
 *
 * Added 2026-08-20 after a REAL roster file ("Roster Planning", 300 agents, 14 date columns)
 * crashed the whole import with `TypeError: (header ?? "").trim is not a function`. The date
 * headers in that file are genuine Excel date cells, and `XLSX.utils.sheet_to_json(..., {header: 1})`
 * returns those as NUMBERS (serials) — never strings — so every function here that assumed a
 * string threw on the first real-world file that was not typed by hand. The declared
 * `string[][]` row type made it look safe; the sheet reader does not honour it.
 *
 * The throw was a bare TypeError with no statusCode, so in production it surfaces as a generic
 * 500 rather than anything an uploader could act on.
 */
function toHeaderString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // ISO, which parseColumnDate understands below. Local getters, not toISOString: a date-only
    // cell read as local midnight shifts to the previous day under UTC in IST.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') {
    // An Excel serial for a date-only cell is an integer; a serial carrying a time is not, and
    // rounding it here keeps the column's calendar day.
    return Number.isFinite(value) ? String(Math.round(value)) : '';
  }
  return String(value);
}

/**
 * Parse a spreadsheet column header as a date.
 * Returns a Date if the header is a recognised date pattern, or null otherwise.
 *
 * Accepts `unknown` on purpose — see toHeaderString: real spreadsheets hand back numbers and
 * Dates in the header row, not just strings.
 */
export function parseColumnDate(header: unknown): Date | null {
  const trimmed = toHeaderString(header).trim();
  if (!trimmed) return null;

  // ISO YYYY-MM-DD (with an optional time part, which sheet readers append for date cells).
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(trimmed);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10) - 1;
    const day = parseInt(iso[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) return new Date(year, month, day);
    return null;
  }

  // Excel serial number: integer in range 40000–50000
  if (/^\d+$/.test(trimmed)) {
    const serial = parseInt(trimmed, 10);
    if (serial >= 40000 && serial <= 50000) {
      // Excel epoch is 1900-01-00 (stored as 1899-12-30 in UTC)
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return d;
    }
    return null;
  }

  // DD-MMM  e.g. 01-Aug
  const ddMmm = /^(\d{1,2})-([A-Za-z]{3})$/.exec(trimmed);
  if (ddMmm) {
    const day = parseInt(ddMmm[1], 10);
    const month = MONTH_MAP[ddMmm[2].toLowerCase()];
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = new Date().getFullYear();
      return new Date(year, month, day);
    }
    return null;
  }

  // DD-MMM-YY  e.g. 01-Aug-26
  const ddMmmYy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(trimmed);
  if (ddMmmYy) {
    const day = parseInt(ddMmmYy[1], 10);
    const month = MONTH_MAP[ddMmmYy[2].toLowerCase()];
    const yy = parseInt(ddMmmYy[3], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = yy >= 0 && yy <= 99 ? (yy >= 50 ? 1900 + yy : 2000 + yy) : yy;
      return new Date(year, month, day);
    }
    return null;
  }

  // DD-MMM-YYYY  e.g. 01-Aug-2026
  const ddMmmYyyy = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(trimmed);
  if (ddMmmYyyy) {
    const day = parseInt(ddMmmYyyy[1], 10);
    const month = MONTH_MAP[ddMmmYyyy[2].toLowerCase()];
    const year = parseInt(ddMmmYyyy[3], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      return new Date(year, month, day);
    }
    return null;
  }

  // DD/MM/YYYY  e.g. 01/08/2026
  const ddMmYyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (ddMmYyyy) {
    const day = parseInt(ddMmYyyy[1], 10);
    const month = parseInt(ddMmYyyy[2], 10) - 1; // 0-indexed
    const year = parseInt(ddMmYyyy[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      // Distinguish DD/MM/YYYY from M/D/YYYY: if first part is > 12 it must be DD/MM
      // We always treat 4-digit-year as DD/MM/YYYY
      return new Date(year, month, day);
    }
    return null;
  }

  // DD/MM/YY  e.g. 01/08/26
  const ddMmYy = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(trimmed);
  if (ddMmYy) {
    const day = parseInt(ddMmYy[1], 10);
    const month = parseInt(ddMmYy[2], 10) - 1;
    const yy = parseInt(ddMmYy[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const year = yy >= 50 ? 1900 + yy : 2000 + yy;
      return new Date(year, month, day);
    }
    return null;
  }

  // M/D/YYYY  e.g. 8/1/2026  — note: already handled above by DD/MM/YYYY pattern
  // (same regex matches; we already return above for 4-digit years)

  return null;
}

/**
 * Map a single column header to a canonical identity field.
 */
export function mapIdentityColumn(header: unknown): ColumnMapping {
  // Coerced but NOT trimmed: sourceHeader is contract ("preserves sourceHeader exactly"), and
  // only the alias lookup normalises whitespace.
  const sourceHeader = toHeaderString(header);
  const canonical = ALIAS_TO_CANONICAL.get(sourceHeader.trim().toLowerCase());
  if (canonical) {
    return { sourceHeader, mappedTo: canonical, confidence: 'HIGH' };
  }
  return { sourceHeader, mappedTo: null, confidence: 'NONE' };
}

/**
 * Scan rows 0–19 (or all rows if fewer than 20).
 * Returns the index of the first row that contains at least 2 date columns, or -1.
 */
export function detectHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    let dateCount = 0;
    for (const cell of row) {
      if (parseColumnDate(cell) !== null) {
        dateCount++;
        if (dateCount >= 2) return i;
      }
    }
  }
  return -1;
}

/**
 * Full header analysis: locate the header row, classify every column as
 * a date column, a mapped identity column, or an unmapped (extra_metadata) column.
 */
export function analyzeHeaders(rows: unknown[][]): HeaderDetectionResult {
  const headerRowIndex = detectHeaderRow(rows);

  if (headerRowIndex === -1 || headerRowIndex >= rows.length) {
    return {
      headerRowIndex: -1,
      dateColumns: [],
      identityColumns: [],
      unmappedColumns: [],
    };
  }

  const headerRow = rows[headerRowIndex];
  const dateColumns: DateColumn[] = [];
  const identityColumns: IdentityColumn[] = [];
  const unmappedColumns: IdentityColumn[] = [];

  for (let i = 0; i < headerRow.length; i++) {
    const header = toHeaderString(headerRow[i]);
    const parsedDate = parseColumnDate(header);

    if (parsedDate !== null) {
      dateColumns.push({ index: i, header, parsedDate });
    } else {
      const mapping = mapIdentityColumn(header);
      const col: IdentityColumn = { index: i, header, mapping };
      identityColumns.push(col);
      if (mapping.mappedTo === null) {
        unmappedColumns.push(col);
      }
    }
  }

  return { headerRowIndex, dateColumns, identityColumns, unmappedColumns };
}
