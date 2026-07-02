/**
 * ATS Google Sheet → MySQL Importer
 *
 * Reads a TSV/CSV export of the walk-in tracking sheet and upserts every row
 * into ats_candidate.  No routes, APIs, or existing records are modified.
 *
 * Usage:
 *   node scripts/import-gsheet-ats.mjs <path-to-file.tsv>   [--dry-run]
 *
 * The input file must be the sheet saved as "Tab-separated values (.tsv)" or
 * "Comma-separated values (.csv)".  The first row must be the header row
 * exactly as exported (column order doesn't matter — matched by header name).
 *
 * Behaviour:
 *   • INSERT … ON DUPLICATE KEY UPDATE — safe to re-run; only updates fields
 *     that are non-empty in the sheet row (never blanks out existing data).
 *   • candidate_code = GSheet CandidateID  (e.g. C20260321115036221)
 *   • Skips rows where CandidateID is blank.
 *   • Reports inserted / updated / skipped counts at the end.
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
const filePath = args.find(a => !a.startsWith('--'));

if (!filePath) {
  console.error('Usage: node scripts/import-gsheet-ats.mjs <file.tsv|file.csv> [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// ── Parse TSV/CSV ─────────────────────────────────────────────────────────────
function parseFile(filePath) {
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
  const part = str.split(' ')[0];          // drop time portion
  const [m, d, y] = part.split('/');
  if (!y) return null;
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
    time_taken:                 v(r, 'AHT')                || null,
    sla_breached:               toTinyInt(v(r, 'SLA Breached ( 120 Mins)')),
    aht_minutes:                ahtMinutes,

    // Walk-in progress
    walkin_end_stage:           walkinEndStage             || null,
    status:                     status                     || null,
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

    // Typing score parsing from skilltest_typing "Accuracy=95/WPM=30"
    ...parseTyping(v(r, 'SkillTest_Typing')),
  };
}

// Parse "Accuracy=95/WPM=30" or "15/70" (accuracy/wpm)
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

for (const rawRow of rows) {
  const row = buildRow(rawRow);
  if (!row) { skipped++; continue; }

  try {
    if (dryRun) {
      console.log(`  [DRY] would upsert ${row.candidate_code} — ${row.full_name}`);
      inserted++;
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

    const sql = `
      INSERT INTO ats_candidate (${cols.join(', ')})
      VALUES (${cols.map(() => '?').join(', ')})
      ON DUPLICATE KEY UPDATE
      ${updateClauses}
    `;

    const [result] = await pool.execute(sql, vals);
    if (result.affectedRows === 1)      inserted++;
    else if (result.affectedRows === 2) updated++;   // 2 = row existed, was updated
    else                                skipped++;   // 0 = existed, nothing changed

  } catch (err) {
    console.error(`  ERROR on ${row.candidate_code}: ${err.message}`);
    errors++;
  }
}

await pool.end();

console.log(`
╔══════════════════════════════════════╗
║  ATS Import Complete                 ║
╠══════════════════════════════════════╣
║  Inserted (new):    ${String(inserted).padEnd(16)} ║
║  Updated (existed): ${String(updated).padEnd(16)} ║
║  Skipped (no-op):   ${String(skipped).padEnd(16)} ║
║  Errors:            ${String(errors).padEnd(16)} ║
╚══════════════════════════════════════╝
`);
if (errors > 0) process.exit(1);
