/**
 * ATS Google Sheet → MySQL Importer
 *
 * Reads an .xlsx workbook, or a TSV/CSV export, of the walk-in tracking sheet
 * and writes every row into ats_candidate. No routes or APIs are touched.
 *
 * Usage:
 *   node scripts/import-gsheet-ats.mjs <file.xlsx|file.tsv|file.csv> \
 *        [--dry-run] [--insert-only] [--match-mobile] [--sheet "<name>"]
 *
 * Prefer .xlsx. Excel's Save-As silently drops leading zeros from mobile
 * numbers, turns long ids into scientific notation and rewrites dates into the
 * machine's locale; reading the workbook keeps the typed cell instead.
 * Column order does not matter — columns are matched by header name.
 *
 * Flags:
 *   --dry-run       write nothing; report what would happen
 *   --insert-only   never modify a row that already exists
 *   --match-mobile  treat a row as existing when its mobile matches, not just
 *                   its candidate_code. Needed here: no row in ats_candidate
 *                   uses the sheet's C20xxxxxxxxx code shape, so code-only
 *                   matching would re-insert people already present under an
 *                   older code (MAS49050, 62410C, IDC36566C, CND-…).
 *   --sheet         which tab to read; defaults to the first
 *
 * Behaviour:
 *   • Upsert by default: only fills columns that are empty, never blanks live
 *     data. Safe to re-run.
 *   • candidate_code = CandidateID  (e.g. C20260321115036221)
 *   • Skips rows with a blank CandidateID.
 *   • An --insert-only run writes the codes it created next to the input file,
 *     so the whole load reverses with one DELETE.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);

// ── Load .env from backend directory ─────────────────────────────────────────
const envPath = path.resolve(process.cwd(), 'backend/.env');
if (!fs.existsSync(envPath)) {
  console.error('ERROR: backend/.env not found. Run from project root.');
  process.exit(1);
}
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([^#=\s]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const mysql = require('mysql2/promise');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
// Pure insert: rows whose candidate_code is already present are left completely
// alone. Use when the sheet is an archive being back-filled and HRMS is the
// system of record for anything already in it.
const insertOnly = args.includes('--insert-only');
// Also treat a row as already present when its mobile matches an existing
// candidate, even though the candidate_code differs.
//
// Not paranoia: no row in ats_candidate uses the sheet's C20xxxxxxxxx
// CandidateID shape. Existing codes are MAS49050, 62410C, IDC36566C,
// CND-MS5QE35L — several different generations of the system. Deduplicating on
// candidate_code alone therefore treats every sheet row as new and re-inserts
// people who are already there under an older code. 2,328 mobiles already
// appear more than once, so that failure has happened before.
const matchMobile = args.includes('--match-mobile');
// Which tab to read from a workbook. Defaults to the first sheet.
const sheetIdx = args.indexOf('--sheet');
const sheetName = sheetIdx !== -1 ? args[sheetIdx + 1] : null;
// The index guard must not fire when --sheet is absent: sheetIdx is -1 then, and
// sheetIdx + 1 is 0, which would discard the file argument itself.
const sheetValueIdx = sheetIdx === -1 ? -1 : sheetIdx + 1;
const filePath = args.filter((a, i) => !a.startsWith('--') && i !== sheetValueIdx)[0];

if (!filePath) {
  console.error('Usage: node scripts/import-gsheet-ats.mjs <file.xlsx|file.tsv|file.csv> [--dry-run] [--insert-only] [--match-mobile] [--sheet "<name>"]');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// ── Parse TSV/CSV ─────────────────────────────────────────────────────────────
/**
 * Read .xlsx/.xls directly rather than asking for a CSV export.
 *
 * Excel's Save-As is lossy in ways that are invisible until the data is already
 * in the database: leading zeros are dropped from mobile numbers, long numeric
 * ids become scientific notation, and dates are rewritten to whatever the
 * machine's locale happens to be. Reading the workbook keeps the typed cell.
 *
 * Values are normalised to the same shape the TSV path produces — trimmed
 * strings, '' for blanks — so everything downstream is identical either way.
 */
function parseWorkbook(filePath, sheetName) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: true, cellNF: true, raw: true });

  const name = sheetName || wb.SheetNames[0];
  if (!wb.Sheets[name]) {
    console.error(`Sheet "${name}" not found. Available: ${wb.SheetNames.join(', ')}`);
    process.exit(1);
  }
  if (!sheetName && wb.SheetNames.length > 1) {
    console.log(`Workbook has ${wb.SheetNames.length} sheets; using "${name}". Override with --sheet "<name>".`);
  }

  // Cells are read individually rather than through sheet_to_json, because two
  // things are only recoverable from the cell object itself:
  //
  //   dates    Excel stores them as floating-point serials. Converting back
  //            lands a fraction of a second early, so 21 Mar 00:00:00 becomes
  //            20 Mar 23:59:59 — the date is off by a day, silently. Rounding
  //            to the nearest second fixes it.
  //   percents a cell displaying 96% holds 0.96. Without the number format
  //            (cell.z) that arrives as 0.96 and a typing accuracy of 96 is
  //            recorded as 1.
  const cellText = (c) => {
    if (!c || c.v === null || c.v === undefined) return '';

    if (c.t === 'd' || c.v instanceof Date) {
      const ms = c.v instanceof Date ? c.v.getTime() : new Date(c.v).getTime();
      const d = new Date(Math.round(ms / 1000) * 1000);       // kill serial drift
      const p = (n) => String(n).padStart(2, '0');
      const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      return time === '00:00:00' ? date : `${date} ${time}`;
    }

    if (typeof c.v === 'number') {
      if (typeof c.z === 'string' && c.z.includes('%')) {
        return String(Math.round(c.v * 100 * 1e6) / 1e6);     // 0.96 -> 96
      }
      return String(c.v);   // never a thousands separator, never 1.2e+17
    }

    if (typeof c.v === 'boolean') return c.v ? 'Yes' : 'No';
    return String(c.v).trim();
  };

  const sheet = wb.Sheets[name];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const at = (r, col) => sheet[XLSX.utils.encode_cell({ r, c: col })];

  const headers = [];
  for (let col = range.s.c; col <= range.e.c; col++) headers[col] = cellText(at(range.s.r, col)).trim();

  const out = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row = {};
    let any = false;
    for (let col = range.s.c; col <= range.e.c; col++) {
      const h = headers[col];
      if (!h) continue;
      const text = cellText(at(r, col));
      row[h] = text;
      if (text !== '') any = true;
    }
    if (any) out.push(row);     // skip fully blank rows
  }
  return out;
}

function parseFile(filePath) {
  if (/\.xlsx?$/i.test(filePath)) return parseWorkbook(filePath, sheetName);

  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const isTsv = filePath.endsWith('.tsv') || raw.includes('\t');
  const sep = isTsv ? '\t' : ',';

  const lines = raw.split('\n').filter(l => l.trim());
  const headers = splitLine(lines[0], sep);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitLine(lines[i], sep);
    if (vals.length === 0) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

function splitLine(line, sep) {
  if (sep !== ',') return line.split(sep);
  // CSV-aware split (handles quoted fields with commas/newlines)
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += c;
  }
  result.push(cur);
  return result;
}

// ── Value helpers ─────────────────────────────────────────────────────────────
const v = (row, key) => (row[key] ?? '').trim();

// Parse "3/21/2026" or "3/21/2026 13:59:27" → MySQL DATE string
function toDate(str) {
  if (!str) return null;
  const part = String(str).trim().split(' ')[0];   // drop time portion
  if (!part) return null;

  // ISO (2026-06-15). Sheets exported under a locale that formats with dashes
  // produce this, and the M/D/YYYY split below silently yields null for it —
  // every date column would land NULL with no error raised.
  const iso = part.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const [m, d, y] = part.split('/');
  if (!y || !m || !d) return null;
  return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

// Parse "3/21/2026 13:59:27" → MySQL DATETIME string
function toDatetime(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(' ');
  const d = toDate(datePart);
  if (!d) return null;
  return timePart ? `${d} ${timePart}` : `${d} 00:00:00`;
}

// "AHT" column: "2:08:51" → total minutes (int)  or  "2h 9m" → minutes
function toAhtMinutes(str) {
  if (!str) return null;
  // "H:MM:SS" or "HH:MM:SS"
  const hms = str.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) return parseInt(hms[1]) * 60 + parseInt(hms[2]);
  // "Xh Ym"
  const hm = str.match(/(\d+)h\s*(\d+)m/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  return null;
}

// Yes/No/Conditional/NA → 1/0/null
function toTinyInt(str) {
  if (!str) return null;
  const lo = str.toLowerCase();
  if (lo === 'yes') return 1;
  if (lo === 'no') return 0;
  return null;   // Conditional, NA, empty → null
}

// Parse offer salary "16240 CTC , IN HAND 13660" → take first number
function toSalary(str) {
  if (!str) return null;
  const m = str.match(/[\d,]+/);
  if (!m) return null;
  return parseFloat(m[0].replace(/,/g, '')) || null;
}

// Parse Offer_DOJ "3/24/2026" (may include time)
function toOfferDoj(str) {
  if (!str) return null;
  return toDate(str.split(' ')[0]);
}

// Map GSheet stage name → ats_candidate.current_stage vocabulary
function mapStage(walkinEndStage, finalDecision) {
  const stage = (walkinEndStage || '').toLowerCase();
  const fd    = (finalDecision  || '').toLowerCase();
  if (fd === 'selected')                   return 'Offered';
  if (fd === 'rejected')                   return 'Applied';   // maps to rejection bucket
  if (stage.includes('selection'))         return 'Offered';
  if (stage.includes('round3'))            return 'Interview';
  if (stage.includes('round2'))            return 'Interview';
  if (stage.includes('skill'))             return 'Screening';
  if (stage.includes('round1'))            return 'Interview';
  if (stage.includes('arrival'))           return 'Applied';
  return 'Applied';
}

// Map status → profile_status enum
function mapProfileStatus(status, finalDecision) {
  const s  = (status        || '').toLowerCase();
  const fd = (finalDecision || '').toLowerCase();
  if (fd === 'selected')  return 'selected';
  if (s  === 'selected')  return 'selected';
  return 'registered';
}

/**
 * ats_candidate.status, reconciled against the outcome columns.
 *
 * The sheet's Status column used to be written straight through. current_stage
 * and profile_status are derived from FinalDecision / Walk-in EndStage instead,
 * so the three could disagree and nothing reconciled them — and status is the
 * only one the walk-in queue and the SLA breach worker read.
 *
 * The June 2026 legacy import landed 1,330 candidates that way: profile_status
 * said registered/onboarded and current_stage said Applied/Onboarded, while
 * status stayed 'Waiting' on every one of them. 'Waiting' means "in the lobby
 * right now", so a month-old walk-in still counted as queued.
 *
 * FinalDecision is the authoritative outcome and now wins over the Status
 * column. Where there is no decision, the sheet's own value is kept, exactly as
 * before, so rows that were already correct are unaffected.
 */
function mapCandidateStatus(status, finalDecision) {
  const fd = (finalDecision || '').trim().toLowerCase();
  if (fd === 'selected') return 'Selected';
  if (fd === 'rejected') return 'Rejected';
  return status || null;
}

// ── Build INSERT row from GSheet row ─────────────────────────────────────────
function buildRow(r) {
  const candidateCode = v(r, 'CandidateID');
  if (!candidateCode) return null;

  const createdDate = toDate(v(r, 'CreatedDate'));
  const createdTime = (() => {
    const t = v(r, 'CreatedTime');
    return t || null;
  })();

  // Combine CreatedDate + CreatedTime for created_at
  const createdAt = createdDate && createdTime
    ? `${createdDate} ${createdTime}`
    : createdDate ? `${createdDate} 00:00:00` : null;

  const lastUpdated      = toDatetime(v(r, 'LastUpdated'));
  const hrFormSubmission = toDatetime(v(r, 'HR Form Submition Time'));

  const walkinEndStage = v(r, 'Walk-in EndStage');
  const finalDecision  = v(r, 'FinalDecision');
  const status         = v(r, 'Status');

  // AHT: prefer the "AHT" column (HH:MM:SS), fall back to "Total Time Consumed"
  const ahtMinutes = toAhtMinutes(v(r, 'AHT')) ?? toAhtMinutes(v(r, 'Total Time Consumed'));

  // Sourcing channel: try to match to known codes, default WALKIN
  const sourcing = 'WALKIN';   // all GSheet data is walk-in

  return {
    id:                         randomUUID(),
    candidate_code:             candidateCode,
    full_name:                  v(r, 'FullName')           || null,
    mobile:                     v(r, 'Mobile')             || null,
    email:                      v(r, 'Email')              || null,
    gender:                     (() => {
                                  const g = v(r, 'Gender').toLowerCase();
                                  if (g === 'male')   return 'Male';
                                  if (g === 'female') return 'Female';
                                  return null;
                                })(),
    address:                    v(r, 'Address')            || null,
    education:                  v(r, 'Education')          || null,
    experience:                 v(r, 'Experience')         || null,
    role_applied:               v(r, 'RoleApplied')        || null,
    applied_for_process:        v(r, 'Process')            || null,
    applied_for_branch:         v(r, 'Branch')             || null,
    sourcing_channel:           sourcing,

    // Queue token
    q_token:                    v(r, 'QToken')             || null,

    // Recruiter info
    recruiter_selected:         v(r, 'RecruiterSelected')  || null,
    recruiter_assigned_name:    v(r, 'RecruiterAssignedName') || v(r, 'RecruiterSelected') || null,
    recruiter_email:            v(r, 'RecruiterEmail')     || null,
    recruiter_mobile:           v(r, 'RecruiterMobile')    || null,
    recruiter_name:             v(r, 'RecruiterAssignedName') || v(r, 'RecruiterSelected') || null,

    // Availability / preferences
    leaves_next_3_months:       v(r, 'LeavesNext3Months')  || null,
    leaves_in_3months:          toTinyInt(v(r, 'LeavesNext3Months')),
    preferred_shift_timing:     v(r, 'PreferredShiftTiming') || null,
    preferred_shift:            v(r, 'PreferredShiftTiming') || null,
    night_shift_comfortable:    v(r, 'NightShiftComfortable') || null,
    night_shift_ok:             v(r, 'NightShiftComfortable') || null,
    rotational_shift_comfort:   v(r, 'RotationalShiftComfort') || null,
    rotational_shift:           toTinyInt(v(r, 'RotationalShiftComfort')),
    own_2_wheeler:              v(r, 'Own2Wheeler')        || null,
    owns_two_wheeler:           toTinyInt(v(r, 'Own2Wheeler')),
    id_proof:                   v(r, 'IDProof')            || null,
    id_proof_available:         toTinyInt(v(r, 'IDProof')),
    edu_proof:                  v(r, 'EduProof')           || null,
    education_proof_available:  toTinyInt(v(r, 'EduProof')),
    resume_url:                 v(r, 'ResumeLink')         || null,

    // Timing
    total_time_consumed:        v(r, 'Total Time Consumed') || null,
    // 'AHT' is absent from newer exports, which carry 'Total Time Consumed'
    // instead. aht_minutes already falls back; this did not, so it landed NULL.
    time_taken:                 v(r, 'AHT') || v(r, 'Total Time Consumed') || null,
    sla_breached:               toTinyInt(v(r, 'SLA Breached ( 120 Mins)')),
    aht_minutes:                ahtMinutes,

    // Walk-in progress
    walkin_end_stage:           walkinEndStage             || null,
    status:                     mapCandidateStatus(status, finalDecision),
    update_form_link:           v(r, 'UpdateFormLink')     || null,
    walk_in_date:               createdDate,

    // Round results
    round1_result:              v(r, 'Round1_Result')      || null,
    round1_voc:                 v(r, 'Round1_VOC')         || null,
    round1_remarks:             v(r, 'Round1_Remarks')     || null,
    skilltest_typing:           v(r, 'SkillTest_Typing')   || null,
    skilltest_ai:               v(r, 'SkillTest_AI')       || null,
    skilltest_result:           v(r, 'SkillTest_Result')   || null,
    skilltest_voc:              v(r, 'SkillTest_VOC')      || null,
    skilltest_remarks:          v(r, 'SkillTest_Remarks')  || null,
    round2_result:              v(r, 'Round2_Result')      || null,
    round2_voc:                 v(r, 'Round2_VOC')         || null,
    round2_remarks:             v(r, 'Round2_Remarks')     || null,
    round3_result:              v(r, 'Round3_Result')      || null,
    round3_voc:                 v(r, 'Round3_VOC')         || null,
    round3_remarks:             v(r, 'Round3_Remarks')     || null,
    final_decision:             finalDecision              || null,

    // Offer details
    offer_salary:               toSalary(v(r, 'Offer_Salary')),
    offer_doj:                  toOfferDoj(v(r, 'Offer_DOJ')),
    reporting_shift:            v(r, 'Reporting_Shift')    || null,
    joining_confirmation:       v(r, 'Joining Confirmation') || null,
    offer_performance_incentive: v(r, 'Offer_PerformanceIncentive') || null,
    candidate_confirm_link:     v(r, 'CandidateConfirmLink') || null,
    bgv_form_link:              v(r, 'BGVFormLink')         || null,
    day1_doc_form_link:         v(r, 'Day1DocFormLink')     || null,

    // Walk-in slot
    walkin_slot:                v(r, 'Walk- in SLOT') || v(r, 'Walk-in SLOT') || null,

    // Rejection reason
    rejection_voc:              v(r, 'Rejection VOC')      || null,

    // Derived stage / status
    current_stage:              mapStage(walkinEndStage, finalDecision),
    profile_status:             mapProfileStatus(status, finalDecision),

    // Timestamps
    created_date:               createdDate,
    created_time:               createdTime,
    hr_form_submission_time:    hrFormSubmission,
    created_at:                 createdAt,
    updated_at:                 lastUpdated || createdAt,

    // Typing / comprehension assessment.
    //
    // ats_candidate has had these eight columns all along and every one of the
    // 33,861 rows has them NULL, because nothing ever read the sheet's dedicated
    // columns. parseTyping() only salvages the free-text SkillTest_Typing field
    // and recognises two shapes ("Accuracy=95/WPM=30" and "15/70"), returning
    // nothing for anything else — so it was the only source and usually empty.
    //
    // The dedicated columns are authoritative; parseTyping is the fallback.
    ...parseTyping(v(r, 'SkillTest_Typing')),
    ...(toDecimal(v(r, 'Typing_Speed'))    !== null ? { typing_speed:    toDecimal(v(r, 'Typing_Speed')) }    : {}),
    ...(toDecimal(v(r, 'Typing_Accuracy')) !== null ? { typing_accuracy: toDecimal(v(r, 'Typing_Accuracy')) } : {}),
    typing_score:               toDecimal(v(r, 'Typing_Score')),
    typing_test_status:         v(r, 'Typing_Test_Status')            || null,
    typing_test_attempts:       toInt(v(r, 'Typing_Test_Attempts')),
    typing_best_attempt_no:     toInt(v(r, 'Typing_Best_Attempt_No')),
    typing_test_last_updated:   toDatetime(v(r, 'Typing_Test_Last_Updated')),
    comprehension_score:        toDecimal(v(r, 'Comprehension Score')),
  };
}

// Parse "Accuracy=95/WPM=30" or "15/70" (accuracy/wpm)
// Numeric coercion for the dedicated assessment columns. Returns null rather
// than NaN for blanks and junk, so a bad cell leaves the column untouched
// instead of failing the row.
function toDecimal(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).replace(/[%,\s]/g, '');
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function toInt(str) {
  const n = toDecimal(str);
  return n === null ? null : Math.trunc(n);
}

function parseTyping(str) {
  if (!str) return {};
  const accWpm = str.match(/Accuracy=(\d+).*WPM=(\d+)/i);
  if (accWpm) return { typing_accuracy: parseFloat(accWpm[1]), typing_speed: parseFloat(accWpm[2]) };
  const slash  = str.match(/^(\d+)\/(\d+)$/);
  if (slash)   return { typing_accuracy: parseFloat(slash[1]), typing_speed: parseFloat(slash[2]) };
  return {};
}

// ── Main ──────────────────────────────────────────────────────────────────────
const rows = parseFile(filePath);
console.log(`\nParsed ${rows.length} rows from ${path.basename(filePath)}`);
if (dryRun) console.log('DRY-RUN mode — no DB writes\n');

const pool = await mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
});

let inserted = 0, updated = 0, skipped = 0, errors = 0;
let existingSkipped = 0, noCode = 0, matchedByCode = 0, matchedByMobile = 0;

// Existing candidate_codes, loaded once. --insert-only skips these in JS rather
// than relying on INSERT IGNORE, which would also swallow real errors (bad
// dates, oversized values) and report them as duplicates.
const [existingRows] = await pool.query('SELECT candidate_code FROM ats_candidate WHERE candidate_code IS NOT NULL');
const existingCodes = new Set(existingRows.map((r) => String(r.candidate_code)));
console.log(`${existingCodes.size} candidate_code(s) already in ats_candidate`);

// Mobile index, built only when asked for — it is a second full scan.
// Digits only, last 10 kept, so 91xxxxxxxxxx, +91-xxxxxxxxxx and xxxxxxxxxx all
// collapse to the same key.
const normaliseMobile = (m) => {
  const digits = String(m ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
};
let existingMobiles = new Set();
if (matchMobile) {
  const [mobRows] = await pool.query("SELECT mobile FROM ats_candidate WHERE mobile IS NOT NULL AND mobile <> ''");
  existingMobiles = new Set(mobRows.map((r) => normaliseMobile(r.mobile)).filter(Boolean));
  console.log(`${existingMobiles.size} distinct mobile(s) indexed for matching`);
}

if (insertOnly) {
  console.log(`INSERT-ONLY mode — matching on candidate_code${matchMobile ? ' AND mobile' : ' ONLY'}`);
  if (!matchMobile) {
    console.log('  NOTE: no existing row uses the sheet C20xxxxxxxxx code shape. Without');
    console.log('        --match-mobile every row here counts as new, duplicating anyone');
    console.log('        already present under an older code.');
  }
  console.log('');
}

// candidate_codes actually written, so an insert-only run can be undone with
// DELETE FROM ats_candidate WHERE candidate_code IN (...).
const insertedCodes = [];

for (const rawRow of rows) {
  const row = buildRow(rawRow);
  if (!row) { skipped++; noCode++; continue; }

  const existsByCode = existingCodes.has(String(row.candidate_code));
  const mobKey = normaliseMobile(row.mobile);
  const existsByMobile = matchMobile && mobKey !== '' && existingMobiles.has(mobKey);
  if (existsByCode) matchedByCode++;
  else if (existsByMobile) matchedByMobile++;
  const alreadyExists = existsByCode || existsByMobile;

  if (insertOnly && alreadyExists) { skipped++; existingSkipped++; continue; }

  try {
    if (dryRun) {
      if (alreadyExists) { updated++; }
      else { inserted++; insertedCodes.push(row.candidate_code); }
      continue;
    }

    // Build column list — only include non-null values so we never blank live data
    const cols    = Object.keys(row).filter(k => row[k] !== null && row[k] !== undefined);
    const vals    = cols.map(k => row[k]);

    // UPDATE clause: all columns except id (PK) and candidate_code (unique key)
    // Uses COALESCE so existing non-null values are never overwritten by empty strings
    const updateClauses = cols
      .filter(k => k !== 'id' && k !== 'candidate_code')
      .map(k => `${k} = IF(${k} IS NULL OR ${k} = '', VALUES(${k}), ${k})`)
      .join(',\n      ');

    const sql = insertOnly
      ? `INSERT INTO ats_candidate (${cols.join(', ')})
         VALUES (${cols.map(() => '?').join(', ')})`
      : `INSERT INTO ats_candidate (${cols.join(', ')})
         VALUES (${cols.map(() => '?').join(', ')})
         ON DUPLICATE KEY UPDATE
         ${updateClauses}`;

    const [result] = await pool.execute(sql, vals);
    if (result.affectedRows === 1)      { inserted++; insertedCodes.push(row.candidate_code); }
    else if (result.affectedRows === 2) updated++;   // 2 = row existed, was updated
    else                                skipped++;   // 0 = existed, nothing changed

  } catch (err) {
    console.error(`  ERROR on ${row.candidate_code}: ${err.message}`);
    errors++;
  }
}

await pool.end();

// Undo list for an insert-only run. Written even on a dry run so the planned
// blast radius is reviewable before anything is committed.
// Written beside the input file, never into the repo root: several sessions edit
// this working tree and a broad `git add` there would sweep the undo list into
// an unrelated commit.
let undoFile = '';
if (insertOnly && insertedCodes.length) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  undoFile = path.join(path.dirname(path.resolve(filePath)), `ats-import-inserted-${stamp}.txt`);
  fs.writeFileSync(undoFile, insertedCodes.join('\n') + '\n');
}

const line = (label, value) => `║  ${String(label).padEnd(24)}${String(value).padEnd(12)}║`;
console.log(`
╔══════════════════════════════════════╗
║  ATS Import ${(dryRun ? 'DRY RUN' : 'Complete').padEnd(25)}║
╠══════════════════════════════════════╣
${line('Mode:', (insertOnly ? 'insert-only' : 'upsert') + (matchMobile ? ' +mobile' : ''))}
${line('Inserted (new):', inserted)}
${line(insertOnly ? 'Left alone (exists):' : 'Updated (existed):', insertOnly ? existingSkipped : updated)}
${line('  matched by code:', matchedByCode)}
${line('  matched by mobile:', matchMobile ? matchedByMobile : 'n/a')}
${line('Skipped (no ID):', noCode)}
${line('Errors:', errors)}
╚══════════════════════════════════════╝
`);
if (!matchMobile && inserted > 0) {
  console.log(
    `Re-run with --match-mobile to see how many of those ${inserted} already exist\n` +
    `under a different candidate_code before committing to the insert.\n`
  );
}
if (undoFile) {
  console.log(`Inserted candidate_codes written to:\n  ${undoFile}`);
  console.log(`Undo with:\n  DELETE FROM ats_candidate WHERE candidate_code IN (<contents of that file>);\n`);
}
if (errors > 0) process.exit(1);
