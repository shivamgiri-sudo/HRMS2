import Tesseract from "tesseract.js";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { extractDobFromText } from "./ageVerification.service.js";
import { classifyDuplicateIdentity } from "./duplicate-identity.js";

const AADHAAR_REGEX = /\b(\d{4}\s?\d{4}\s?\d{4})\b/;
const PAN_REGEX = /\b([A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z])\b/;
const ACCOUNT_REGEX = /\b(\d{9,18})\b/g;
const IFSC_REGEX = /\b([A-Z]{4}0[A-Z0-9]{6})\b/;

export interface OcrExtractionResult {
  rawText: string;
  extractedNumber: string | null;
  extractedName: string | null;
  /**
   * Date of birth, when the document prints one.
   *
   * The raw text was already being stored in
   * candidate_onboarding_document.ocr_raw_text, so an Aadhaar DOB has been
   * sitting in the database unparsed all along. Surfacing it here lets the age
   * check use document evidence instead of a self-declared date.
   */
  extractedDob: string | null;
  confidence: number;
  documentType: "aadhaar" | "pan" | "cheque" | "other";
}

export async function extractFromDocument(filePath: string, docType: string): Promise<OcrExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    return { rawText: "", extractedNumber: null, extractedName: null, extractedDob: null, confidence: 0, documentType: "other" };
  }

  // errorHandler is mandatory here, not cosmetic. When tesseract.js cannot decode
  // an image its worker callback rejects the promise AND, when no errorHandler was
  // supplied, also runs `throw Error(data)` (createWorker.js:210-218). That throw
  // happens inside a worker 'message' callback, so no caller-side .catch() can ever
  // see it — it surfaces as an uncaughtException and kills the backend process.
  // One candidate uploading an unreadable Aadhaar photo took the whole API down,
  // and the severed connection is what the browser reports as "Failed to fetch".
  const { data } = await Tesseract.recognize(filePath, "eng", {
    logger: () => {},
    errorHandler: () => {},
  });

  const text = data.text;
  const confidence = data.confidence;
  const normalizedDocType = docType.toLowerCase();

  if (normalizedDocType.includes("aadhaar") || normalizedDocType.includes("aadhar")) {
    return extractAadhaarDetails(text, confidence);
  } else if (normalizedDocType.includes("pan")) {
    return extractPanDetails(text, confidence);
  } else if (normalizedDocType.includes("cheque") || normalizedDocType.includes("passbook") || normalizedDocType.includes("bank")) {
    return extractChequeDetails(text, confidence);
  }

  return { rawText: text, extractedNumber: null, extractedName: null, extractedDob: extractDobFromText(text), confidence, documentType: "other" };
}

function extractAadhaarDetails(text: string, confidence: number): OcrExtractionResult {
  const match = text.replace(/\n/g, " ").match(AADHAAR_REGEX);
  const number = match ? match[1].replace(/\s/g, "") : null;

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let name: string | null = null;
  for (const line of lines) {
    if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(line) && !line.match(/government|india|aadhaar|uid/i)) {
      name = line.split(/\s{2,}/)[0].trim();
      break;
    }
  }

  return { rawText: text, extractedNumber: number, extractedName: name, extractedDob: extractDobFromText(text), confidence, documentType: "aadhaar" };
}

function extractPanDetails(text: string, confidence: number): OcrExtractionResult {
  const upperText = text.toUpperCase().replace(/\n/g, " ");
  const match = upperText.match(PAN_REGEX);
  const number = match ? match[1] : null;

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let name: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (/name/i.test(lines[i]) && lines[i + 1]) {
      name = lines[i + 1].trim();
      break;
    }
  }

  return { rawText: text, extractedNumber: number, extractedName: name, extractedDob: extractDobFromText(text), confidence, documentType: "pan" };
}

function extractChequeDetails(text: string, confidence: number): OcrExtractionResult {
  const ifscMatch = text.toUpperCase().match(IFSC_REGEX);
  const accountMatches = text.match(ACCOUNT_REGEX);

  let accountNumber: string | null = null;
  if (accountMatches) {
    const candidates = accountMatches.filter(m => m.length >= 9 && m.length <= 18);
    accountNumber = candidates.length > 0 ? candidates[0] : null;
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let name: string | null = null;
  for (const line of lines) {
    if (/^[A-Z\s]{5,}$/.test(line) && !/bank|branch|ifsc|cheque|account/i.test(line)) {
      name = line.trim();
      break;
    }
  }

  return {
    rawText: text,
    extractedNumber: accountNumber || (ifscMatch ? ifscMatch[1] : null),
    extractedName: name,
    extractedDob: extractDobFromText(text),
    confidence,
    documentType: "cheque",
  };
}

export async function crossValidateDocument(
  candidateId: string,
  documentId: string,
  docType: string,
  ocrResult: OcrExtractionResult
): Promise<{ matched: boolean; alertId?: string }> {
  if (!ocrResult.extractedNumber) {
    await db.execute(
      `UPDATE candidate_onboarding_document SET ocr_extraction_status = 'success', ocr_number_match = 'no_number_found', ocr_raw_text = ? WHERE id = ?`,
      [ocrResult.rawText.substring(0, 5000), documentId]
    );
    return { matched: true };
  }

  const hashExtracted = createHash("sha256").update(ocrResult.extractedNumber.trim().toUpperCase()).digest("hex");
  const normalizedDocType = docType.toLowerCase();

  let storedHash: string | null = null;
  let alertType: string | null = null;

  if (normalizedDocType.includes("aadhaar") || normalizedDocType.includes("aadhar")) {
    const [rows] = await db.execute<any[]>(
      `SELECT aadhaar_number_hash FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
      [candidateId]
    );
    storedHash = rows[0]?.aadhaar_number_hash ?? null;
    alertType = "DOCUMENT_NUMBER_MISMATCH";
  } else if (normalizedDocType.includes("pan")) {
    const [rows] = await db.execute<any[]>(
      `SELECT pan_number_hash FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
      [candidateId]
    );
    storedHash = rows[0]?.pan_number_hash ?? null;
    alertType = "DOCUMENT_NUMBER_MISMATCH";
  } else if (normalizedDocType.includes("cheque") || normalizedDocType.includes("bank") || normalizedDocType.includes("passbook")) {
    const [rows] = await db.execute<any[]>(
      `SELECT account_no_hash FROM candidate_onboarding_bank_detail WHERE candidate_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [candidateId]
    );
    storedHash = rows[0]?.account_no_hash ?? null;
    alertType = "CHEQUE_ACCOUNT_MISMATCH";
  }

  const matched = !storedHash || hashExtracted === storedHash;

  await db.execute(
    `UPDATE candidate_onboarding_document
       SET ocr_extracted_number = ?, ocr_extracted_name = ?, ocr_extraction_status = 'success',
           ocr_number_match = ?, ocr_raw_text = ?
     WHERE id = ?`,
    [
      ocrResult.extractedNumber,
      ocrResult.extractedName,
      matched ? "matched" : "mismatch",
      ocrResult.rawText.substring(0, 5000),
      documentId,
    ]
  );

  if (!matched && alertType) {
    const alertId = randomUUID();
    // ON DUPLICATE KEY UPDATE against uq_candidate_alert_type (candidate_id,
    // alert_type) — see 442_candidate_fraud_alert_unique_constraint.sql. A
    // re-run of this check (e.g. the document is re-uploaded) refreshes the
    // finding on the same row instead of adding a duplicate open alert. The
    // status guard means a re-fire never resurrects an alert HR already
    // reviewed: it only stays/goes 'open' if it was already 'open'.
    await db.execute(
      `INSERT INTO candidate_fraud_alert (id, candidate_id, alert_type, severity, details)
       VALUES (?, ?, ?, 'medium', ?) AS new_alert
       ON DUPLICATE KEY UPDATE
         severity = new_alert.severity,
         details = new_alert.details,
         status = CASE WHEN candidate_fraud_alert.status = 'open' THEN 'open' ELSE candidate_fraud_alert.status END,
         updated_at = NOW()`,
      [
        alertId,
        candidateId,
        alertType,
        JSON.stringify({
          document_id: documentId,
          doc_type: docType,
          extracted_number_last4: ocrResult.extractedNumber.slice(-4),
          message: `OCR extracted number from ${docType} does not match entered number`,
        }),
      ]
    );
    return { matched: false, alertId };
  }

  return { matched: true };
}

/**
 * Has this Aadhaar / PAN / bank account been used by a different candidate?
 *
 * Coverage is the thing to understand before trusting a clean result here. The
 * lookup is only as good as the hash columns, and those are populated only for
 * candidates who completed the current onboarding flow: 20 of 32,726 bank rows,
 * and roughly 53 of 32,755 for Aadhaar and PAN. The remaining rows were migrated
 * without the raw identifier, and since the raw values are deliberately not
 * retained they cannot be backfilled. So "no duplicate found" means "none among
 * the small population we can compare", not "none". Coverage grows on its own as
 * new candidates join.
 *
 * Callers invoke this without awaiting, so a throw here disappears. It is
 * therefore recorded rather than raised — a fraud check that silently failed is
 * indistinguishable from one that passed, and that is the more dangerous of the
 * two to leave invisible.
 */
export async function checkDuplicates(
  candidateId: string,
  type: "aadhaar" | "pan" | "bank",
  hash: string
): Promise<{ isDuplicate: boolean; matchedCandidateId?: string }> {
  if (!hash) return { isDuplicate: false };
  try {
    return await runDuplicateCheck(candidateId, type, hash);
  } catch (error) {
    await recordCheckFailure(candidateId, type, error).catch(() => {
      // Recording the failure failed too; the console is all that is left.
      console.error("[Fraud] could not record duplicate-check failure for", candidateId);
    });
    return { isDuplicate: false };
  }
}

/** A fraud check that could not complete is itself worth a reviewer's attention. */
async function recordCheckFailure(candidateId: string, type: string, error: unknown) {
  // ON DUPLICATE KEY UPDATE against uq_candidate_alert_type — see
  // 442_candidate_fraud_alert_unique_constraint.sql. Same guard as the OCR
  // mismatch alert above: a repeat failure refreshes this row instead of
  // piling up duplicates, and never overwrites a status HR already set.
  await db.execute(
    `INSERT INTO candidate_fraud_alert (id, candidate_id, alert_type, severity, details)
     VALUES (?, ?, 'FRAUD_CHECK_FAILED', 'medium', ?) AS new_alert
     ON DUPLICATE KEY UPDATE
       severity = new_alert.severity,
       details = new_alert.details,
       status = CASE WHEN candidate_fraud_alert.status = 'open' THEN 'open' ELSE candidate_fraud_alert.status END,
       updated_at = NOW()`,
    [
      randomUUID(),
      candidateId,
      JSON.stringify({
        message: `The ${type} duplicate check did not complete, so no conclusion can be drawn for this candidate`,
        check: type,
        error: (error as Error)?.message ?? String(error),
      }),
    ],
  );
}

async function runDuplicateCheck(
  candidateId: string,
  type: "aadhaar" | "pan" | "bank",
  hash: string
): Promise<{ isDuplicate: boolean; matchedCandidateId?: string }> {

  let query: string;
  if (type === "aadhaar") {
    query = `SELECT candidate_id FROM candidate_onboarding_profile WHERE aadhaar_number_hash = ? AND candidate_id != ? LIMIT 1`;
  } else if (type === "pan") {
    query = `SELECT candidate_id FROM candidate_onboarding_profile WHERE pan_number_hash = ? AND candidate_id != ? LIMIT 1`;
  } else {
    query = `SELECT candidate_id FROM candidate_onboarding_bank_detail WHERE account_no_hash = ? AND candidate_id != ? LIMIT 1`;
  }

  const [rows] = await db.execute<any[]>(query, [hash, candidateId]);
  if (!rows.length) return { isDuplicate: false };

  const matchedCandidateId = rows[0].candidate_id as string;

  // A shared identifier is only fraud if it is shared by two different people.
  //
  // The match is deliberately NOT filtered by candidate status. Excluding
  // rejected or ex-employee records would be the wrong fix: a departed
  // employee's PAN turning up on someone else is one of the more likely places
  // to find real fraud. What matters is whether these two records describe the
  // same human being — a rejoiner, or someone who simply applied twice, is not
  // committing anything.
  const [parties] = await db.execute<any[]>(
    `SELECT id, full_name, date_of_birth FROM ats_candidate WHERE id IN (?, ?)`,
    [candidateId, matchedCandidateId],
  );
  const partyFor = (id: string) => (parties as any[]).find((row) => String(row.id) === String(id));
  const verdict = classifyDuplicateIdentity(
    { fullName: partyFor(candidateId)?.full_name, dateOfBirth: partyFor(candidateId)?.date_of_birth },
    { fullName: partyFor(matchedCandidateId)?.full_name, dateOfBirth: partyFor(matchedCandidateId)?.date_of_birth },
  );

  const scope = type === "aadhaar" ? "Aadhaar" : type === "pan" ? "PAN" : "bank account";
  // ON DUPLICATE KEY UPDATE against uq_candidate_alert_type — see
  // 442_candidate_fraud_alert_unique_constraint.sql. Same guard as the other
  // call sites: a repeat duplicate-check hit refreshes severity/details/
  // matched_candidate_id on the existing row rather than adding another open
  // alert, and never overwrites a status HR already reviewed away from 'open'.
  await db.execute(
    `INSERT INTO candidate_fraud_alert (id, candidate_id, alert_type, severity, matched_candidate_id, details)
     VALUES (?, ?, ?, ?, ?, ?) AS new_alert
     ON DUPLICATE KEY UPDATE
       severity = new_alert.severity,
       matched_candidate_id = new_alert.matched_candidate_id,
       details = new_alert.details,
       status = CASE WHEN candidate_fraud_alert.status = 'open' THEN 'open' ELSE candidate_fraud_alert.status END,
       updated_at = NOW()`,
    [
      randomUUID(),
      candidateId,
      // Same person: recorded so a reviewer can see the history, at a severity
      // that does not block the hire. Different people: the original signal.
      verdict.samePerson
        ? "REPEAT_APPLICANT"
        : type === "aadhaar" ? "DUPLICATE_AADHAAR" : type === "pan" ? "DUPLICATE_PAN" : "DUPLICATE_BANK_ACCOUNT",
      verdict.severity,
      matchedCandidateId,
      JSON.stringify({
        message: verdict.samePerson
          ? `This ${scope} matches an earlier record for the same person — ${verdict.reason}. Not treated as fraud.`
          : `The same ${scope} is used by another candidate — ${verdict.reason}`,
        scope,
        samePerson: verdict.samePerson,
      }),
    ]
  );

  return { isDuplicate: !verdict.samePerson, matchedCandidateId };
}
