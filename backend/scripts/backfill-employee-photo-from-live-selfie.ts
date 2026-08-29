/**
 * One-off backfill: promote each employee's mandatory onboarding Live Selfie
 * to their avatar_url/photo_url, for employees created before the
 * employee-creation-orchestrator.service.ts promotion fix (which previously
 * read the wrong ats_candidate.selfie_url field and self-admittedly no-op'd
 * for auth-gated URLs — see git history on that file).
 *
 * Scope, deliberately narrow: only employees whose source candidate has a
 * REAL "Live Selfie" document on file (candidate_onboarding_document) and
 * who currently have no avatar_url/photo_url. This is NOT the same
 * population as the mandatory-gate-bypass gap (candidates who were never
 * asked for a selfie at all, via the legacy /onboard short form) — those
 * have no document to promote from and are out of scope for this script;
 * closing that gap requires the candidate to actually capture one, which
 * this script cannot manufacture.
 *
 * Self-contained on purpose: this may run against a server checkout that is
 * ahead of the last deploy (this fix hasn't been pushed yet), so the write
 * step is inlined here rather than importing writeEmployeePhotoBuffer from
 * employee.photo.compat.routes.ts — mirrors that function's rename/cleanup/
 * DB-update pattern exactly (same PHOTOS_DIR, same public URL format) so a
 * future deploy of that file changes nothing about what's on disk already.
 *
 * Usage:
 *   npx tsx scripts/backfill-employee-photo-from-live-selfie.ts --dry-run
 *   npx tsx scripts/backfill-employee-photo-from-live-selfie.ts
 */
import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../src/db/mysql.js";
import { resolveOnboardingDocumentFile } from "../src/modules/ats/onboardingDocumentPath.js";
import { cropFaceForProfilePhoto } from "../src/modules/employees/face-crop.util.js";

const DRY_RUN = process.argv.includes("--dry-run");

// Must match employee.photo.compat.routes.ts's PHOTOS_DIR exactly — both
// resolve from process.cwd() so writes here are read back correctly by the
// same /api/files/employee-photos/:filename route the app already serves.
const PHOTOS_DIR = path.resolve(process.cwd(), "uploads", "employee-photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

async function writePhoto(employeeId: string, buffer: Buffer): Promise<string> {
  const finalName = `${employeeId}.jpg`;
  const finalPath = path.join(PHOTOS_DIR, finalName);

  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const oldPath = path.join(PHOTOS_DIR, `${employeeId}${ext}`);
    if (oldPath !== finalPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  fs.writeFileSync(finalPath, buffer);

  const fileUrl = `/api/files/employee-photos/${finalName}`;
  await db.execute(
    `UPDATE employees SET avatar_url = ?, photo_url = ?, updated_at = COALESCE(updated_at, NOW()) WHERE id = ?`,
    [fileUrl, fileUrl, employeeId],
  );
  return fileUrl;
}

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT e.id AS employee_id, e.employee_code, d.file_path
      FROM employees e
      JOIN ats_onboarding_bridge ob ON ob.employee_id = e.id
      JOIN candidate_onboarding_document d
        ON d.candidate_id = ob.candidate_id
       AND d.doc_type = 'Live Selfie'
       AND d.deleted_at IS NULL
     WHERE (e.photo_url IS NULL OR e.photo_url = '')
       AND (e.avatar_url IS NULL OR e.avatar_url = '')
     ORDER BY d.uploaded_at DESC
  `);

  // Some employees have more than one Live Selfie doc (re-uploads); rows are
  // already ordered most-recent-first, so the first one seen per employee wins.
  const byEmployee = new Map<string, { employeeCode: string; filePath: string }>();
  for (const r of rows as Array<{ employee_id: string; employee_code: string; file_path: string }>) {
    if (!byEmployee.has(r.employee_id)) {
      byEmployee.set(r.employee_id, { employeeCode: r.employee_code, filePath: r.file_path });
    }
  }

  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}${byEmployee.size} employee(s) to backfill.`);

  let promoted = 0;
  let missingFile = 0;
  let failed = 0;

  for (const [employeeId, { employeeCode, filePath }] of byEmployee) {
    try {
      const resolved = resolveOnboardingDocumentFile(filePath);
      if (!resolved) {
        console.warn(`[skip] ${employeeCode}: source file not found on disk`);
        missingFile++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[would-promote] ${employeeCode} <- ${resolved}`);
        promoted++;
        continue;
      }

      const buffer = await cropFaceForProfilePhoto(resolved);
      const url = await writePhoto(employeeId, buffer);
      console.log(`[ok] ${employeeCode} -> ${url}`);
      promoted++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[err] ${employeeCode}: ${message}`);
      failed++;
    }
  }

  console.log(JSON.stringify({ dryRun: DRY_RUN, total: byEmployee.size, promoted, missingFile, failed }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
