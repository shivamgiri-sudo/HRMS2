/**
 * sync-attendance-issues-from-dbbill.mjs
 *
 * Migrates db_bill.BranchWiseAttandanceIssue → mas_hrms.attendance_regularization
 *
 * BranchWiseAttandanceIssue is the legacy HR attendance correction/dispute workflow.
 * Every row represents an employee raising an issue about their attendance status
 * (present vs absent, biometric mismatch, shift issue, WFH, etc.) with dual approval.
 *
 * Target: attendance_regularization — the HRMS table where all future regularization
 * requests from the UI will also land. Legacy rows are stored with status='historical'
 * so they never appear in the active HR approval queue, but are fully queryable for
 * audit and employee history views.
 *
 * Dedup key: escalated_to = 'BWAI:<Id>'  (varchar 50, no FK constraint)
 * A re-run is safe: rows with that escalated_to value are skipped via NOT EXISTS check.
 *
 * IssueType → dispute_type mapping:
 *   Present as per APR  → cosec_sync_issue
 *   Forgot To Punch     → missing_punch
 *   Work From Home      → work_from_home
 *   Night Shift Issue   → shift_mismatch
 *   Short Login Hour    → late_mark_dispute
 *   Present on 7:50 Hrs → late_mark_dispute
 *   Others / Other / Training / New Joining / Skin Problem / Power Failure / PQ Training → manual_punch_correction
 *
 * Usage:
 *   node backend/scripts/sync-attendance-issues-from-dbbill.mjs
 *   node backend/scripts/sync-attendance-issues-from-dbbill.mjs --bill-host=14.97.30.236
 *   node backend/scripts/sync-attendance-issues-from-dbbill.mjs --batch=500
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    return env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}

const BILL_HOST  = arg('bill-host', fromEnv('BILL_DB_HOST') ?? '14.97.30.236');
const HRMS_HOST  = arg('hrms-host', fromEnv('DB_HOST')      ?? '192.168.10.6');
const DB_USER    = fromEnv('DB_USER');
const DB_PASS    = fromEnv('DB_PASSWORD');
const BATCH      = Number(arg('batch', '2000'));

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }

// Maps db_bill IssueType string → attendance_regularization.dispute_type enum value
function mapIssueType(issueType) {
  const t = (issueType || '').toLowerCase().trim();
  if (t.includes('apr') || t.includes('cosec'))           return 'cosec_sync_issue';
  if (t.includes('forgot') || t.includes('punch'))        return 'missing_punch';
  if (t.includes('work from home') || t === 'wfh')        return 'work_from_home';
  if (t.includes('night shift') || t.includes('shift'))   return 'shift_mismatch';
  if (t.includes('short login') || t.includes('7:50') || t.includes('late')) return 'late_mark_dispute';
  return 'manual_punch_correction';
}

// Maps db_bill ExpectedStatus code → attendance_regularization.requested_status enum
function mapRequestedStatus(s) {
  if (!s) return null;
  const u = s.trim().toUpperCase();
  if (u === 'P' || u === 'T')              return 'present';
  if (u === 'HD' || u === 'DH' || u === 'HL') return 'half_day';
  return 'absent';
}

// Maps approval columns → regularization status
function mapStatus(approveFirst, approveSecond) {
  if (approveFirst && approveSecond) return 'approved';
  if (approveFirst)                  return 'approved'; // single-level approved
  return 'historical';                                   // never appears in active queue
}

async function retryDeadlock(fn, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      if ((e.message.includes('Deadlock') || e.message.includes('Lock wait')) && i < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  log(`Connecting — bill=${BILL_HOST}  hrms=${HRMS_HOST}`);

  const bill = await mysql.createPool({
    host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS,
    database: 'db_bill', connectTimeout: 30000, waitForConnections: true,
    connectionLimit: 3, dateStrings: true,
  });
  const hrms = await mysql.createPool({
    host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS,
    database: 'mas_hrms', connectTimeout: 30000, waitForConnections: true,
    connectionLimit: 5,
  });

  // Build employee_code → employee_id (UUID) map from mas_hrms
  log('Loading employee map...');
  const [empRows] = await hrms.execute('SELECT id, employee_code FROM employees');
  const empMap = new Map(empRows.map(r => [r.employee_code.trim().toUpperCase(), r.id]));
  log(`  ${empMap.size} employees loaded.`);

  // Pre-load all already-inserted legacy keys into memory — avoids 141K per-row SELECTs
  log('Loading existing legacy keys...');
  const [existingKeys] = await hrms.execute(
    "SELECT escalated_to FROM attendance_regularization WHERE escalated_to LIKE 'BWAI:%'"
  );
  const doneSet = new Set(existingKeys.map(r => r.escalated_to));
  log(`  ${doneSet.size} already inserted.`);

  // Count source rows
  const [[{ total }]] = await bill.execute('SELECT COUNT(*) AS total FROM BranchWiseAttandanceIssue');
  log(`Source rows: ${total}`);

  let offset = 0, inserted = 0, skipped = 0, noEmp = 0;

  while (offset < total) {
    const [rows] = await bill.execute(
      `SELECT Id, BranchName, EmpCode, BioCode, EmpName, Designation,
              CurrentStatus, ExpectedStatus, AttandDate, StartDate, EndDate,
              IssueType, Reason, ApproveFirst, ApproveFirstDate,
              ApproveSecond, ApproveSecondDate, CreateDate, SaveBy,
              ApproveFirstBy, ApproveSecondBy
       FROM BranchWiseAttandanceIssue
       ORDER BY Id
       LIMIT ? OFFSET ?`,
      [BATCH, offset],
    );
    if (!rows.length) break;

    // Build batch of rows to insert
    const toInsert = [];
    for (const r of rows) {
      const legacyKey = `BWAI:${r.Id}`;
      const empId = empMap.get((r.EmpCode || '').trim().toUpperCase());

      if (!empId) { noEmp++; continue; }

      // Skip if already inserted (in-memory check — fast)
      if (doneSet.has(legacyKey)) { skipped++; continue; }
      doneSet.add(legacyKey);
      toInsert.push({ r, empId, legacyKey });
    }

    // Bulk insert — 100 rows per statement for speed
    const CHUNK = 100;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      if (!chunk.length) continue;

      // Columns: id, employee_id, session_date, requested_status, reason,
      //   requested_by_type, status, reviewed_at, dispute_type, old_status,
      //   new_status, created_at(=createDate), updated_at(=NOW()), escalated_to, manager_review_note
      // ? count: 12 per row
      const placeholders = chunk.map(() =>
        `(UUID(), ?, ?, ?, ?, 'employee', ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`
      ).join(',\n');

      const vals = [];
      for (const { r, empId, legacyKey } of chunk) {
        const attDate        = r.AttandDate       ? r.AttandDate.substring(0, 10)       : null;
        const createDate     = r.CreateDate       ? r.CreateDate.substring(0, 19)       : null;
        const approveFirstDate  = r.ApproveFirstDate  ? r.ApproveFirstDate.substring(0, 19)  : null;
        const approveSecondDate = r.ApproveSecondDate ? r.ApproveSecondDate.substring(0, 19) : null;
        const approverNote = [
          r.ApproveFirstBy  ? `L1: ${r.ApproveFirstBy}`  : null,
          r.ApproveSecondBy ? `L2: ${r.ApproveSecondBy}` : null,
        ].filter(Boolean).join(' | ') || null;

        vals.push(
          empId,
          attDate,
          mapRequestedStatus(r.ExpectedStatus),
          String(r.Reason || r.IssueType || '').replace(/<[^>]*>/g, '').substring(0, 499),
          mapStatus(r.ApproveFirst, r.ApproveSecond),
          approveSecondDate || approveFirstDate,
          mapIssueType(r.IssueType),
          r.CurrentStatus ? String(r.CurrentStatus).substring(0, 50) : null,
          r.ExpectedStatus ? String(r.ExpectedStatus).substring(0, 50) : null,
          createDate,
          legacyKey,
          approverNote,
        );
      }

      await retryDeadlock(() => hrms.execute(
        `INSERT INTO attendance_regularization
           (id, employee_id, session_date, requested_status,
            reason, requested_by_type,
            status, reviewed_at,
            dispute_type, old_status, new_status,
            created_at, updated_at,
            escalated_to, manager_review_note)
         VALUES ${placeholders}`,
        vals,
      ));
      inserted += chunk.length;
    }

    offset += rows.length;
    process.stdout.write(`\r  Progress: ${offset}/${total}  inserted=${inserted}  skipped=${skipped}  noEmp=${noEmp}   `);
  }

  process.stdout.write('\n');
  log('═══════════════════════════════════════════');
  log('ATTENDANCE ISSUES SYNC COMPLETE');
  log(`Total source rows : ${total}`);
  log(`Inserted          : ${inserted}`);
  log(`Skipped (dup)     : ${skipped}`);
  log(`Skipped (no emp)  : ${noEmp}  ← IDC/pre-HRMS employees, expected`);

  await bill.end();
  await hrms.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });