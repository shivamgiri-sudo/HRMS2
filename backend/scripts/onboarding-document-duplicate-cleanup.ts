/**
 * One-time cleanup: for each candidate with more than one ACTIVE document of the
 * same identity doc_type (Aadhaar / PAN / selfie-live-photo), soft-delete all but
 * the most-recently-uploaded one — using the exact same mechanism
 * deleteOnboardingDocument() already uses (document_status='deleted',
 * deleted_at=NOW()), never a hard delete, never touching the file on disk.
 *
 * Only the identity-document allowlist is touched (same isFaceImage/isIdImage logic
 * as uploadOnboardingDocument()'s new supersede-on-upload fix). Non-identity types
 * (education certs, experience letters, etc.) are never touched by this script.
 *
 * Safe by construction:
 *   - Dry-run by default. Nothing is deleted unless --apply is passed.
 *   - Only ever soft-deletes rows that are NOT the max(uploaded_at) in their group.
 *   - Runs inside one transaction; any failure rolls back everything.
 *
 * Usage:
 *   npx tsx scripts/onboarding-document-duplicate-cleanup.ts            # dry run
 *   npx tsx scripts/onboarding-document-duplicate-cleanup.ts --apply    # actually soft-delete
 */
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");

function isIdentityDocType(docType: string): boolean {
  const t = docType.toLowerCase();
  const isFaceImage = t.includes("selfie") || t.includes("live") || t.includes("photo");
  const isIdImage = t.includes("aadhaar") || t.includes("pan");
  return isFaceImage || isIdImage;
}

async function main() {
  const [rows] = await db.execute(
    `SELECT candidate_id, doc_type, COUNT(*) AS cnt
       FROM candidate_onboarding_document
      WHERE deleted_at IS NULL
      GROUP BY candidate_id, doc_type
     HAVING COUNT(*) > 1`
  );
  const groups = (rows as Array<{ candidate_id: string; doc_type: string; cnt: number }>)
    .filter((g) => isIdentityDocType(g.doc_type));

  if (!groups.length) {
    console.log("No identity-document duplicate groups found. Nothing to do.");
    process.exit(0);
  }

  let totalToRetire = 0;
  const idsToRetire: string[] = [];

  for (const g of groups) {
    const [docRows] = await db.execute(
      `SELECT id, doc_name, uploaded_at
         FROM candidate_onboarding_document
        WHERE candidate_id = ? AND doc_type = ? AND deleted_at IS NULL
        ORDER BY uploaded_at DESC, id DESC`,
      [g.candidate_id, g.doc_type]
    );
    const ordered = docRows as Array<{ id: string; doc_name: string; uploaded_at: string }>;
    const [keep, ...retire] = ordered;
    if (!keep || retire.length === 0) continue;

    console.log(
      `${g.candidate_id}  ${g.doc_type}: keep ${keep.id} (${keep.doc_name}, uploaded=${keep.uploaded_at}); ` +
      `${APPLY ? "retiring" : "would retire"} ${retire.length}: ${retire.map((r) => `${r.id} (${r.doc_name})`).join(", ")}`
    );
    totalToRetire += retire.length;
    idsToRetire.push(...retire.map((r) => r.id));
  }

  console.log(`\n${APPLY ? "Retiring" : "Would retire"} ${totalToRetire} document(s) across ${groups.length} group(s).`);

  if (!APPLY) {
    console.log("Dry run only — re-run with --apply to actually soft-delete.");
    process.exit(0);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const placeholders = idsToRetire.map(() => "?").join(",");
    const [result] = await conn.execute(
      `UPDATE candidate_onboarding_document
          SET document_status = 'deleted', deleted_at = NOW(), deleted_by = NULL
        WHERE id IN (${placeholders})`,
      idsToRetire
    );
    await conn.commit();
    console.log(`Committed. Soft-deleted ${(result as any).affectedRows} document(s).`);
  } catch (err) {
    await conn.rollback();
    console.error("Rolled back — nothing was changed.", err);
    process.exit(1);
  } finally {
    conn.release();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
