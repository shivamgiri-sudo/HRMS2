#!/usr/bin/env node
/**
 * Backfill employee_documents from candidate_onboarding_document for employees
 * who converted from a candidate BEFORE candidateDocumentPromotion.service.ts
 * existed (2026-09-17). Their Documents tab (EmployeeProfileCompletion.tsx
 * Step 9) shows every type as "Not uploaded" even when the candidate genuinely
 * uploaded them — the row just never got copied into employee_documents.
 *
 *   node scripts/backfill-employee-documents-from-candidate-onboarding.mjs                  # dry run
 *   node scripts/backfill-employee-documents-from-candidate-onboarding.mjs --apply           # write
 *   node scripts/backfill-employee-documents-from-candidate-onboarding.mjs --apply --employee-code MAS63440   # one employee
 *
 * ── What it does ─────────────────────────────────────────────────────────
 * For every active employee reachable from a converted candidate
 * (ats_onboarding_bridge.candidate_id -> employee_id, falling back to
 * employees.candidate_id where the bridge row is missing):
 *   1. Read candidate_onboarding_document for that candidate (excluding the
 *      Live Selfie, which is promoted separately to the profile photo).
 *   2. Skip any doc_type the employee already has in employee_documents.
 *   3. Resolve the file on THIS machine via the same fallback the app uses
 *      (private-storage/onboarding-documents/<basename>) — a known separate
 *      class of rows has a genuinely missing file; those are counted and
 *      skipped, not fabricated.
 *   4. Copy the file into uploads/employee-documents/<new-uuid>.<ext>,
 *      register it in document_vault_inventory (required — the download
 *      route 403s on anything not registered there), and INSERT the
 *      employee_documents row.
 *
 * Every write is recorded in employee_document_promotion_backfill_log so it
 * can be audited or reversed (delete the employee_documents + vault rows the
 * log points at; the copied files under uploads/employee-documents can be
 * removed the same way).
 *
 * Actor attribution: each employee's own conversion is recorded once in
 * sensitive_action_log (action_type='employee_created_preboarding',
 * entity_id=employee_id) — reuse that same actor_user_id here rather than
 * inventing one. An employee with no such row (pre-dates that log line) is
 * skipped and reported, not silently attributed to a guessed user.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.join(__dirname, '..');

const APPLY = process.argv.includes('--apply');
const codeArgIdx = process.argv.indexOf('--employee-code');
const ONLY_EMPLOYEE_CODE = codeArgIdx !== -1 ? process.argv[codeArgIdx + 1] : null;

const SKIP_DOC_TYPES = new Set(['Live Selfie']);
const ONBOARDING_DOCUMENT_ROOT = path.join(BACKEND_ROOT, 'private-storage', 'onboarding-documents');
const EMPLOYEE_DOCS_DIR = path.join(BACKEND_ROOT, 'uploads', 'employee-documents');

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = readEnv(path.join(BACKEND_ROOT, '.env'));

function isReadableFile(p) {
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
}

/** Same fallback as backend/src/modules/ats/onboardingDocumentPath.ts. */
function resolveOnboardingDocumentFile(storedPath) {
  const raw = String(storedPath ?? '').trim();
  if (!raw) return null;
  if (isReadableFile(raw)) return raw;
  const fileName = raw.split(/[\\/]/).pop();
  if (!fileName) return null;
  const candidate = path.join(ONBOARDING_DOCUMENT_ROOT, fileName);
  return isReadableFile(candidate) ? candidate : null;
}

const LOG_DDL = `
  CREATE TABLE IF NOT EXISTS employee_document_promotion_backfill_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    employee_id CHAR(36) NOT NULL,
    employee_code VARCHAR(64) NULL,
    candidate_id CHAR(36) NOT NULL,
    employee_document_id CHAR(36) NOT NULL,
    doc_type VARCHAR(100) NOT NULL,
    source_candidate_document_id CHAR(36) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    written_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_docpromo_backfill_employee (employee_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function main() {
  const db = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${ONLY_EMPLOYEE_CODE ? ` (employee_code=${ONLY_EMPLOYEE_CODE})` : ''}`);
  if (APPLY) await db.query(LOG_DDL);

  const [candidates] = await db.query(
    `SELECT DISTINCT e.id AS employee_id, e.employee_code, cand.candidate_id
       FROM employees e
       JOIN (
         SELECT candidate_id, employee_id FROM ats_onboarding_bridge WHERE employee_id IS NOT NULL
         UNION
         SELECT candidate_id, id AS employee_id FROM employees WHERE candidate_id IS NOT NULL
       ) cand ON cand.employee_id = e.id
      WHERE e.active_status = 1
      ${ONLY_EMPLOYEE_CODE ? 'AND e.employee_code = ?' : ''}`,
    ONLY_EMPLOYEE_CODE ? [ONLY_EMPLOYEE_CODE] : [],
  );

  console.log(`${candidates.length} converted employee(s) to check.`);

  let employeesTouched = 0;
  let docsPromoted = 0;
  let docsSkippedPresent = 0;
  let docsSkippedFileMissing = 0;
  let employeesSkippedNoActor = 0;

  for (const row of candidates) {
    const { employee_id: employeeId, employee_code: employeeCode, candidate_id: candidateId } = row;

    const [candidateDocs] = await db.query(
      `SELECT id, doc_type, doc_name, file_path, file_url, mime_type, file_size_bytes
         FROM candidate_onboarding_document
        WHERE candidate_id = ? AND deleted_at IS NULL`,
      [candidateId],
    );
    if (!candidateDocs.length) continue;

    const [existingRows] = await db.query(
      `SELECT DISTINCT doc_type FROM employee_documents WHERE employee_id = ?`,
      [employeeId],
    );
    const alreadyPresent = new Set(existingRows.map((r) => String(r.doc_type)));

    const toPromote = candidateDocs.filter(
      (d) => d.doc_type && !SKIP_DOC_TYPES.has(d.doc_type) && !alreadyPresent.has(d.doc_type),
    );
    if (!toPromote.length) continue;

    let actorUserId = null;
    if (APPLY) {
      const [actorRows] = await db.query(
        `SELECT actor_user_id FROM sensitive_action_log
          WHERE entity_id = ? AND action_type = 'employee_created_preboarding'
          ORDER BY acted_at ASC LIMIT 1`,
        [employeeId],
      );
      actorUserId = actorRows[0]?.actor_user_id ?? null;
      if (!actorUserId) {
        console.warn(`  ${employeeCode}: SKIPPED — no employee_created_preboarding actor found, cannot attribute upload.`);
        employeesSkippedNoActor += 1;
        continue;
      }
    }

    console.log(`  ${employeeCode}: ${toPromote.length} candidate document(s) missing from employee_documents`
      + ` (${toPromote.map((d) => d.doc_type).join(', ')})`);

    let touchedThisEmployee = false;
    for (const doc of toPromote) {
      const sourcePath = resolveOnboardingDocumentFile(doc.file_path ?? doc.file_url);
      if (!sourcePath) {
        console.warn(`    - "${doc.doc_type}": file missing on disk, cannot copy — skipped.`);
        docsSkippedFileMissing += 1;
        continue;
      }

      if (!APPLY) {
        console.log(`    - "${doc.doc_type}": would copy from ${sourcePath}`);
        docsPromoted += 1;
        continue;
      }

      fs.mkdirSync(EMPLOYEE_DOCS_DIR, { recursive: true });
      const ext = path.extname(sourcePath) || path.extname(String(doc.file_url ?? '')) || '';
      const storedFilename = `${crypto.randomUUID()}${ext}`;
      const destPath = path.join(EMPLOYEE_DOCS_DIR, storedFilename);
      const fileBuffer = fs.readFileSync(sourcePath);
      fs.writeFileSync(destPath, fileBuffer);
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      const vaultId = crypto.randomUUID();
      await db.execute(
        `INSERT INTO document_vault_inventory
           (id, uploaded_by_user, category, stored_filename, original_filename,
            mime_type, file_size_bytes, sha256_hash, access_level, owner_employee_id)
         VALUES (?, ?, 'employee-documents', ?, ?, ?, ?, ?, 'pii', ?)`,
        [
          vaultId, actorUserId, storedFilename, path.basename(sourcePath),
          doc.mime_type ?? null, doc.file_size_bytes != null ? Number(doc.file_size_bytes) : fileBuffer.length,
          sha256, employeeId,
        ],
      );

      const employeeDocId = crypto.randomUUID();
      const fileUrl = `/api/files/employee-documents/${storedFilename}`;
      await db.execute(
        `INSERT INTO employee_documents (id, employee_id, doc_type, doc_name, file_url, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [employeeDocId, employeeId, doc.doc_type, doc.doc_name ?? doc.doc_type, fileUrl, actorUserId],
      );

      await db.execute(
        `INSERT INTO employee_document_promotion_backfill_log
           (employee_id, employee_code, candidate_id, employee_document_id, doc_type, source_candidate_document_id, stored_filename)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [employeeId, employeeCode, candidateId, employeeDocId, doc.doc_type, doc.id, storedFilename],
      );

      console.log(`    - "${doc.doc_type}": copied -> ${storedFilename}`);
      docsPromoted += 1;
      touchedThisEmployee = true;
    }
    docsSkippedPresent += 0; // already excluded via alreadyPresent filter above
    if (touchedThisEmployee) employeesTouched += 1;
  }

  console.log('\n── Summary ──────────────────────────────────────');
  console.log(`Employees ${APPLY ? 'updated' : 'that would be updated'}: ${employeesTouched}`);
  console.log(`Documents ${APPLY ? 'promoted' : 'that would be promoted'}: ${docsPromoted}`);
  console.log(`Documents skipped — file missing on disk: ${docsSkippedFileMissing}`);
  if (APPLY) console.log(`Employees skipped — no conversion actor found: ${employeesSkippedNoActor}`);
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to write.');

  await db.end();
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
