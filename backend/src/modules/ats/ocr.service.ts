import Tesseract from "tesseract.js";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

const AADHAAR_REGEX = /\b(\d{4}\s?\d{4}\s?\d{4})\b/;
const PAN_REGEX = /\b([A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z])\b/;
const ACCOUNT_REGEX = /\b(\d{9,18})\b/g;
const IFSC_REGEX = /\b([A-Z]{4}0[A-Z0-9]{6})\b/;

export interface OcrExtractionResult {
  rawText: string;
  extractedNumber: string | null;
  extractedName: string | null;
  confidence: number;
  documentType: "aadhaar" | "pan" | "cheque" | "other";
}

export async function extractFromDocument(filePath: string, docType: string): Promise<OcrExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    return { rawText: "", extractedNumber: null, extractedName: null, confidence: 0, documentType: "other" };
  }

  const { data } = await Tesseract.recognize(filePath, "eng", {
    logger: () => {},
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

  return { rawText: text, extractedNumber: null, extractedName: null, confidence, documentType: "other" };
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

  return { rawText: text, extractedNumber: number, extractedName: name, confidence, documentType: "aadhaar" };
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

  return { rawText: text, extractedNumber: number, extractedName: name, confidence, documentType: "pan" };
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
    await db.execute(
      `INSERT INTO candidate_fraud_alert (id, candidate_id, alert_type, severity, details)
       VALUES (?, ?, ?, 'high', ?)`,
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

export async function checkDuplicates(
  candidateId: string,
  type: "aadhaar" | "pan" | "bank",
  hash: string
): Promise<{ isDuplicate: boolean; matchedCandidateId?: string }> {
  if (!hash) return { isDuplicate: false };

  let query: string;
  if (type === "aadhaar") {
    query = `SELECT candidate_id FROM candidate_onboarding_profile WHERE aadhaar_number_hash = ? AND candidate_id != ? LIMIT 1`;
  } else if (type === "pan") {
    query = `SELECT candidate_id FROM candidate_onboarding_profile WHERE pan_number_hash = ? AND candidate_id != ? LIMIT 1`;
  } else {
    query = `SELECT candidate_id FROM candidate_onboarding_bank_detail WHERE account_no_hash = ? AND candidate_id != ? LIMIT 1`;
  }

  const [rows] = await db.execute<any[]>(query, [hash, candidateId]);
  if (rows.length > 0) {
    const alertId = randomUUID();
    const alertType = type === "aadhaar" ? "DUPLICATE_AADHAAR" : type === "pan" ? "DUPLICATE_PAN" : "DUPLICATE_BANK_ACCOUNT";
    await db.execute(
      `INSERT INTO candidate_fraud_alert (id, candidate_id, alert_type, severity, matched_candidate_id, details)
       VALUES (?, ?, ?, 'critical', ?, ?)`,
      [
        alertId,
        candidateId,
        alertType,
        rows[0].candidate_id,
        JSON.stringify({ message: `Same ${type} already used by another candidate` }),
      ]
    );
    return { isDuplicate: true, matchedCandidateId: rows[0].candidate_id };
  }

  return { isDuplicate: false };
}
