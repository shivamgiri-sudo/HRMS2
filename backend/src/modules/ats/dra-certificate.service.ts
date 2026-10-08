import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { pdfFirstPageToJpg } from "../../shared/pdfRender.js";
import { extractFromDocument } from "./ocr.service.js";
import { resolveOnboardingDocumentFile } from "./onboardingDocumentPath.js";
import {
  evaluateDraCertificate,
  isDraCostCentre,
  parseDraCertificateText,
  type DraStatus,
} from "./dra-certificate.rules.js";

/** Doc type the candidate upload form uses. Matched case-insensitively by substring everywhere. */
export const DRA_DOC_TYPE = "DRA Certificate";
export const isDraDocType = (docType: string | null | undefined) =>
  String(docType ?? "").toLowerCase().includes("dra certificate");

/**
 * Is the DRA certificate mandatory for this candidate? Only for the SBI Credit Card cost centre
 * (see DRA_COST_CENTRE_CODES), read from the candidate's latest offer. No offer yet → not required;
 * the rule switches on the moment the offer names that cost centre.
 */
export async function isDraRequired(candidateId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.cost_centre AS raw, cc.cost_centre_code AS code
       FROM ats_employment_offer o
       LEFT JOIN cost_centre_master cc ON (cc.id = o.cost_centre OR cc.cost_centre_code = o.cost_centre)
      WHERE o.candidate_id = ?
      ORDER BY o.created_at DESC LIMIT 1`,
    [candidateId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const r = (rows as RowDataPacket[])[0];
  return !!r && (isDraCostCentre(r.code) || isDraCostCentre(r.raw));
}

export interface DraCurrent {
  id: string;
  status: DraStatus;
  reason: string | null;
  autoChecksPassed: boolean;
  registrationNo: string | null;
  serialNo: string | null;
  securityCode: string | null;
  certificateDate: string | null;
  validUntil: string | null;
  extractedName: string | null;
  nameMatchScore: number | null;
  photoMatchScore: number | null;
  uploadedAt: string;
  verifiedAt: string | null;
  verificationSource: string | null;
  hrNote: string | null;
  documentId: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

function toCurrent(r: RowDataPacket): DraCurrent {
  return {
    id: r.id, status: r.status, reason: r.failure_reason ?? null, autoChecksPassed: !!r.auto_checks_passed,
    registrationNo: r.registration_no ?? null, serialNo: r.serial_no ?? null, securityCode: r.security_code ?? null,
    certificateDate: day(r.certificate_date), validUntil: day(r.valid_until), extractedName: r.extracted_name ?? null,
    nameMatchScore: r.name_match_score ?? null, photoMatchScore: r.photo_match_score ?? null,
    uploadedAt: iso(r.uploaded_at)!, verifiedAt: iso(r.verified_at), verificationSource: r.verification_source ?? null,
    hrNote: r.hr_note ?? null, documentId: r.document_id,
  };
}

export async function getCurrentDra(candidateId: string): Promise<DraCurrent | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_dra_certificate WHERE candidate_id = ? AND is_current = 1 ORDER BY uploaded_at DESC LIMIT 1`,
    [candidateId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const r = (rows as RowDataPacket[])[0];
  return r ? toCurrent(r) : null;
}

/** What the candidate portal needs: is it required, and where does the current upload stand. */
export async function getDraPortalState(candidateId: string) {
  const required = await isDraRequired(candidateId);
  if (!required) return { required: false as const, current: null };
  return { required: true as const, current: await getCurrentDra(candidateId) };
}

/**
 * Does the DRA state stop the candidate submitting? Missing upload is handled with the other mandatory
 * documents. Beyond that: an EXPIRED certificate always blocks (a printed date says so), and an INVALID /
 * MISMATCH that HR decided on blocks too. An automatic mismatch (OCR name/photo) never blocks by itself:
 * the candidate cannot fix a misread, so it is routed to HR instead.
 */
export async function draBlocksSubmission(candidateId: string): Promise<string | null> {
  if (!(await isDraRequired(candidateId))) return null;
  const cur = await getCurrentDra(candidateId);
  if (!cur) return null;
  const hrDecided = !!cur.verificationSource && cur.verificationSource.startsWith("hr");
  if (cur.status === "expired") return `Your DRA certificate has expired${cur.validUntil ? ` (${cur.validUntil})` : ""}. Please upload a valid certificate.`;
  if (hrDecided && (cur.status === "invalid" || cur.status === "mismatch")) {
    return `Your DRA certificate was rejected${cur.reason ? `: ${cur.reason}` : ""}. Please upload the correct certificate.`;
  }
  return null;
}

async function textFromFile(filePath: string, mime: string): Promise<{ text: string; imagePath: string | null; cleanup: () => void }> {
  const noop = () => undefined;
  const isPdf = mime === "application/pdf" || path.extname(filePath).toLowerCase() === ".pdf";
  if (!isPdf) {
    const ocr = await extractFromDocument(filePath, "dra certificate");
    return { text: ocr.rawText ?? "", imagePath: filePath, cleanup: noop };
  }
  // Digital IIBF e-certificates carry a real text layer: exact, no OCR error.
  let text = "";
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(await fs.promises.readFile(filePath)) });
    try { text = String((await parser.getText()).text ?? ""); } finally { await parser.destroy(); }
  } catch { /* fall through to OCR */ }
  // A scanned PDF: render page 1 and OCR it. The render is also what the photo check compares.
  const tmp = path.join(os.tmpdir(), `dra-${randomUUID()}.jpg`);
  let imagePath: string | null = null;
  try {
    await fs.promises.writeFile(tmp, await pdfFirstPageToJpg(filePath));
    imagePath = tmp;
    if (text.replace(/\s/g, "").length < 40) text = (await extractFromDocument(tmp, "dra certificate")).rawText ?? "";
  } catch { /* no render: keep whatever text we have */ }
  return { text, imagePath, cleanup: () => { if (imagePath) fs.promises.rm(imagePath, { force: true }).catch(() => undefined); } };
}

/**
 * Called (fire-and-forget) after a DRA certificate is uploaded. Reads it, runs the automatic checks and stores
 * a new history row; the previous one is kept with is_current = 0. Never throws to the caller.
 */
export async function processDraUpload(candidateId: string, documentId: string): Promise<void> {
  const [docs] = await db.execute<RowDataPacket[]>(
    `SELECT file_path, mime_type FROM candidate_onboarding_document WHERE id = ? LIMIT 1`, [documentId]);
  const doc = (docs as RowDataPacket[])[0];
  const filePath = doc ? resolveOnboardingDocumentFile(doc.file_path) : null;
  const [profiles] = await db.execute<RowDataPacket[]>(
    `SELECT employee_name FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const profileName = ((profiles as RowDataPacket[])[0]?.employee_name as string | undefined) ?? null;

  let text = "";
  let imagePath: string | null = null;
  let cleanup: () => void = () => undefined;
  if (filePath) {
    try { ({ text, imagePath, cleanup } = await textFromFile(filePath, String(doc.mime_type ?? ""))); }
    catch (e) { console.error("[DRA] read failed", documentId, (e as Error).message); }
  }

  try {
    const parsed = parseDraCertificateText(text);

    let duplicateOf: string | null = null;
    for (const [col, val] of [["registration_no", parsed.registrationNo], ["serial_no", parsed.serialNo]] as const) {
      if (!val || duplicateOf) continue;
      const [dups] = await db.execute<RowDataPacket[]>(
        `SELECT c.candidate_id, COALESCE(e.employee_code, c.candidate_id) AS ref
           FROM candidate_dra_certificate c LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = c.candidate_id
           LEFT JOIN employees e ON e.id = b.employee_id
          WHERE c.${col} = ? AND c.is_current = 1 AND c.candidate_id <> ? AND c.status <> 'invalid' LIMIT 1`,
        [val, candidateId]);
      const d = (dups as RowDataPacket[])[0];
      if (d) duplicateOf = String(d.ref);
    }

    // Photo on the certificate vs the live selfie, reusing the ATS face match (scored, not blocking by itself).
    let face: { status: string; matched: boolean; score: number } | null = null;
    if (imagePath) {
      try {
        const fm = await import("./face-match.service.js");
        if (await fm.isModelAvailable()) {
          const [selfies] = await db.execute<RowDataPacket[]>(
            `SELECT id, file_path FROM candidate_onboarding_document
              WHERE candidate_id = ? AND deleted_at IS NULL AND mime_type LIKE 'image/%'
                AND (LOWER(doc_type) LIKE '%selfie%' OR LOWER(doc_type) LIKE '%live%')
              ORDER BY uploaded_at DESC LIMIT 1`, [candidateId]);
          const s = (selfies as RowDataPacket[])[0];
          const selfiePath = s ? resolveOnboardingDocumentFile(s.file_path) : null;
          if (selfiePath) face = await fm.compareFaces(candidateId, selfiePath, imagePath, s.id, documentId);
        }
      } catch (e) { console.error("[DRA] face match failed", documentId, (e as Error).message); }
    }

    const ev = evaluateDraCertificate({
      parsed, textLength: text.replace(/\s/g, "").length, profileName,
      today: new Date().toISOString().slice(0, 10), duplicateOf, face,
    });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`UPDATE candidate_dra_certificate SET is_current = 0 WHERE candidate_id = ? AND is_current = 1`, [candidateId]);
      await conn.execute(
        `INSERT INTO candidate_dra_certificate
           (id, candidate_id, document_id, is_current, status, auto_checks_passed, registration_no, serial_no, security_code,
            certificate_date, valid_until, extracted_name, name_match_score, photo_match_score, failure_reason, verification_source)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto_ocr')`,
        [randomUUID(), candidateId, documentId, ev.status, ev.autoChecksPassed ? 1 : 0, parsed.registrationNo, parsed.serialNo,
          parsed.securityCode, parsed.certificateDate, parsed.validUntil, parsed.name, ev.nameMatchScore,
          face && face.status !== "no_face_detected" ? face.score : null, ev.reason],
      );
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  } finally {
    cleanup();
  }
}

// ── HR side ──────────────────────────────────────────────────────────────────────────────────

export interface HrDraDecision {
  result: "verified" | "invalid" | "mismatch";
  note?: string;
  registrationNo?: string;
  serialNo?: string;
  securityCode?: string;
  certificateDate?: string;
  validUntil?: string;
}

/** HR confirms (after checking the IIBF portal) or rejects the current certificate. Rejection lets the candidate re-upload. */
export async function recordHrDraDecision(candidateId: string, userId: string, d: HrDraDecision): Promise<DraCurrent> {
  const cur = await getCurrentDra(candidateId);
  if (!cur) throw Object.assign(new Error("No DRA certificate uploaded for this candidate"), { statusCode: 404 });
  if (!["verified", "invalid", "mismatch"].includes(d.result)) {
    throw Object.assign(new Error("result must be verified, invalid or mismatch"), { statusCode: 400 });
  }
  const dateOk = (v?: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!dateOk(d.certificateDate) || !dateOk(d.validUntil)) {
    throw Object.assign(new Error("Dates must be YYYY-MM-DD"), { statusCode: 400 });
  }
  const note = d.note?.trim().slice(0, 500) || null;
  if (d.result !== "verified" && !note) {
    throw Object.assign(new Error("A reason is required when rejecting a certificate"), { statusCode: 400 });
  }
  if (d.result === "verified" && d.validUntil && d.validUntil < new Date().toISOString().slice(0, 10)) {
    throw Object.assign(new Error("This certificate's validity date has passed; it cannot be marked verified"), { statusCode: 400 });
  }
  await db.execute(
    `UPDATE candidate_dra_certificate
        SET status = ?, verification_source = 'hr_iibf_portal', verified_at = NOW(), verified_by = ?, hr_note = ?,
            failure_reason = ?,
            registration_no = COALESCE(?, registration_no), serial_no = COALESCE(?, serial_no),
            security_code = COALESCE(?, security_code), certificate_date = COALESCE(?, certificate_date),
            valid_until = COALESCE(?, valid_until)
      WHERE id = ?`,
    [d.result, userId, note, d.result === "verified" ? null : note,
      d.registrationNo?.trim().toUpperCase() || null, d.serialNo?.trim().toUpperCase() || null,
      d.securityCode?.trim().toUpperCase() || null, d.certificateDate || null, d.validUntil || null, cur.id],
  );
  return (await getCurrentDra(candidateId))!;
}

export async function getDraHistory(candidateId: string): Promise<DraCurrent[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_dra_certificate WHERE candidate_id = ? ORDER BY uploaded_at DESC`, [candidateId]);
  return (rows as RowDataPacket[]).map(toCurrent);
}

/** HR list: every candidate whose offer is on the SBI cost centre, with their current certificate status. */
export async function listDraCandidates(opts: { status?: string; scopeSql: string; scopeParams: unknown[]; limit: number }) {
  const codes = (await import("./dra-certificate.rules.js")).DRA_COST_CENTRE_CODES;
  const ph = codes.map(() => "?").join(",");
  const where: string[] = [`(cc.cost_centre_code IN (${ph}) OR o.cost_centre IN (${ph}))`, `(${opts.scopeSql})`];
  const params: unknown[] = [...codes, ...codes, ...opts.scopeParams];
  if (opts.status === "not_uploaded") where.push("d.id IS NULL");
  else if (opts.status && ["pending", "verified", "invalid", "expired", "mismatch"].includes(opts.status)) {
    where.push("d.status = ?"); params.push(opts.status);
  }
  const limit = Math.max(1, Math.min(Math.floor(opts.limit) || 200, 500));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS candidate_id, c.full_name AS candidate_name, d.id AS dra_id, d.status, d.auto_checks_passed, d.failure_reason,
            d.registration_no, d.serial_no, d.valid_until, d.uploaded_at, d.verified_at, d.verification_source, d.document_id
       FROM ats_employment_offer o
       JOIN ats_candidate c ON c.id = o.candidate_id
       LEFT JOIN cost_centre_master cc ON (cc.id = o.cost_centre OR cc.cost_centre_code = o.cost_centre)
       LEFT JOIN candidate_dra_certificate d ON d.candidate_id = c.id AND d.is_current = 1
      WHERE ${where.join(" AND ")}
      ORDER BY d.uploaded_at IS NULL DESC, d.uploaded_at DESC LIMIT ${limit}`,
    params as never[],
  );
  return (rows as RowDataPacket[]).map((r) => ({
    candidateId: r.candidate_id, candidateName: r.candidate_name, status: (r.status ?? "not_uploaded") as DraStatus | "not_uploaded",
    autoChecksPassed: !!r.auto_checks_passed, reason: r.failure_reason ?? null, registrationNo: r.registration_no ?? null,
    serialNo: r.serial_no ?? null, validUntil: day(r.valid_until), uploadedAt: iso(r.uploaded_at), verifiedAt: iso(r.verified_at),
    verificationSource: r.verification_source ?? null, documentId: r.document_id ?? null,
  }));
}
