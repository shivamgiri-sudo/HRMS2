export interface RosterCsvRow {
  employee_code: string;
  roster_date: string;
  shift_start_time: string;
  shift_end_time: string;
  process_name: string | null;
  branch_name: string | null;
}

export interface ParseResult {
  rows: RosterCsvRow[];
  errors: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function parseRosterCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/);
  const rows: RosterCsvRow[] = [];
  const errors: string[] = [];

  if (lines.length < 1) return { rows, errors };

  // Parse header — lowercase + trim
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

  const col = (name: string) => headers.indexOf(name);

  const iEC    = col("employee_code");
  const iDate  = col("roster_date");
  const iStart = col("shift_start_time");
  const iEnd   = col("shift_end_time");
  const iProc  = col("process_name");
  const iBranch = col("branch_name");

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue; // skip blank lines

    const cells = raw.split(",").map((c) => c.trim());
    const rowNum = i;

    const empCode    = iEC    >= 0 ? (cells[iEC]    ?? "") : "";
    const rosterDate = iDate  >= 0 ? (cells[iDate]  ?? "") : "";
    const startTime  = iStart >= 0 ? (cells[iStart] ?? "") : "";
    const endTime    = iEnd   >= 0 ? (cells[iEnd]   ?? "") : "";
    const procName   = iProc  >= 0 ? (cells[iProc]  || null) : null;
    const branchName = iBranch >= 0 ? (cells[iBranch] || null) : null;

    const rowErrors: string[] = [];

    if (!empCode) rowErrors.push(`Row ${rowNum}: employee_code is required`);
    if (!DATE_RE.test(rosterDate)) rowErrors.push(`Row ${rowNum}: date must be YYYY-MM-DD, got "${rosterDate}"`);
    if (!TIME_RE.test(startTime))  rowErrors.push(`Row ${rowNum}: shift_start_time must be HH:MM, got "${startTime}"`);
    if (!TIME_RE.test(endTime))    rowErrors.push(`Row ${rowNum}: shift_end_time must be HH:MM, got "${endTime}"`);

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      employee_code: empCode,
      roster_date: rosterDate,
      shift_start_time: startTime,
      shift_end_time: endTime,
      process_name: procName,
      branch_name: branchName,
    });
  }

  return { rows, errors };
}
