/**
 * Read-only scan: candidates with more than one ACTIVE (deleted_at IS NULL) document
 * of the same identity doc_type (Aadhaar / PAN / selfie-live-photo) in
 * candidate_onboarding_document — the state the new supersede-on-upload fix in
 * uploadOnboardingDocument() now prevents going forward, but existing data predates it.
 *
 * Only the identity-document allowlist is scanned — matches the exact same
 * isFaceImage/isIdImage logic now hoisted in uploadOnboardingDocument()
 * (onboarding-full.service.ts). Non-identity types (education certs, experience
 * letters, etc.) are deliberately not scanned — they can legitimately have multiple
 * active documents of the same doc_type.
 *
 * No writes. Run before onboarding-document-duplicate-cleanup.ts.
 */
import { db } from "../src/db/mysql.js";

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

  const allDupeGroups = rows as Array<{ candidate_id: string; doc_type: string; cnt: number }>;
  const identityDupeGroups = allDupeGroups.filter((g) => isIdentityDocType(g.doc_type));

  console.log(`All duplicate-active-doc_type groups (any type): ${allDupeGroups.length}`);
  console.log(`Of those, identity-document types (the ones the fix supersedes going forward): ${identityDupeGroups.length}`);

  if (!identityDupeGroups.length) {
    console.log("\nNo existing identity-document duplicates found. Nothing to clean up.");
    process.exit(0);
  }

  const ids = [...new Set(identityDupeGroups.map((g) => g.candidate_id))];
  const placeholders = ids.map(() => "?").join(",");
  const [names] = await db.execute(
    `SELECT id, candidate_code, full_name FROM ats_candidate WHERE id IN (${placeholders})`,
    ids
  );
  const nameById = new Map((names as any[]).map((n) => [n.id, n]));

  let totalExtra = 0;
  console.log("\n=== Identity-document duplicate groups ===");
  for (const g of identityDupeGroups) {
    const n = nameById.get(g.candidate_id);
    const extra = g.cnt - 1;
    totalExtra += extra;
    console.log(
      `${g.candidate_id}  ${n?.candidate_code ?? "(no ats_candidate row)"}  ${n?.full_name ?? "?"}  ` +
      `doc_type=${g.doc_type}  active_count=${g.cnt}  extra=${extra}`
    );
  }
  console.log(`\nTotal extra active identity-document rows a cleanup would retire (soft-delete): ${totalExtra}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
