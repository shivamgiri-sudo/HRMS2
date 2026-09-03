import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Verifying an education document must reach the BGV report.
 *
 * The two halves never met. Candidates upload marksheets and degree certificates
 * — 'Education Proof' is mandatory_flag = 1, requires_bgv = 1 in
 * onboarding_document_master, and 118 candidates had complied. But education has
 * no automated provider, so candidate_bgv_report.education_status stayed
 * 'not_run' for 117 of those 118 until somebody set it by hand, and
 * deriveOverallStatus() requires education to be clear. Result: 1 of 198 BGV
 * reports reached 'clear', and appointment letters were blocked company-wide
 * behind a check whose evidence was already on file.
 *
 * The trigger is HR verification, never upload. An uploaded-but-unverified
 * document passing the check would be the same "report nobody looked at" the
 * is_auto_approved guard exists to reject.
 */
const secureDocs = readFileSync(
  resolve(process.cwd(), 'src/modules/ats/secure-documents.service.ts'),
  'utf8',
);

describe('education BGV status follows verified documents', () => {
  it('syncs only from verifyCandidateDocument, not from an upload path', () => {
    const verify = secureDocs.slice(secureDocs.indexOf('export async function verifyCandidateDocument'));
    const body = verify.slice(0, verify.indexOf('export async function rejectCandidateDocument'));
    expect(body).toContain('syncEducationStatusFromDocuments(document.candidate_id)');
    // Exactly one caller: the verify path.
    expect(secureDocs.match(/syncEducationStatusFromDocuments\(/g)).toHaveLength(2); // definition + call
  });

  it('only fires for education documents, using the existing categoryOf mapping', () => {
    const verify = secureDocs.slice(secureDocs.indexOf('export async function verifyCandidateDocument'));
    const body = verify.slice(0, verify.indexOf('export async function rejectCandidateDocument'));
    expect(body).toContain('categoryOf(document.document_type) === "education"');
  });

  it('counts only documents whose status is verified', () => {
    const fn = secureDocs.slice(secureDocs.indexOf('async function syncEducationStatusFromDocuments'));
    expect(fn).toContain("String(r.document_status) === \"verified\"");
    expect(fn).toContain('if (verified === 0) return;');
  });

  it('writes passed only when every education document is verified', () => {
    const fn = secureDocs.slice(secureDocs.indexOf('async function syncEducationStatusFromDocuments'));
    expect(fn).toContain('verified === educationDocs.length ? "passed" : "partial"');
  });

  it('never overwrites a locked report, an HR failure, or an existing pass', () => {
    const fn = secureDocs.slice(secureDocs.indexOf('async function syncEducationStatusFromDocuments'));
    expect(fn).toContain('AND locked = 0');
    expect(fn).toContain("NOT IN ('failed', 'passed')");
  });

  it('re-derives the overall verdict rather than setting it directly', () => {
    const fn = secureDocs.slice(secureDocs.indexOf('async function syncEducationStatusFromDocuments'));
    expect(fn).toContain('computeAndSaveScore(candidateId)');
    // overall_status is computed, never assigned — the same rule bgv-verification
    // enforces so a 'clear' cannot be written without the checks behind it.
    expect(fn).not.toMatch(/overall_status\s*=\s*['"]/);
  });

  it('does not fail the document verification when the sync fails', () => {
    const verify = secureDocs.slice(secureDocs.indexOf('export async function verifyCandidateDocument'));
    const body = verify.slice(0, verify.indexOf('export async function rejectCandidateDocument'));
    expect(body).toContain('.catch((err: unknown)');
  });
});
