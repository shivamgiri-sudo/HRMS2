import fs from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// Use process.cwd() (backend/ working directory) — works correctly in both dev and production
export const CANDIDATE_FILES_ROOT = path.resolve(process.cwd(), "private/ats-candidate-files");

fs.mkdirSync(CANDIDATE_FILES_ROOT, { recursive: true });

export type CandidateFileRecord = {
  id: string;
  candidate_id: string;
  file_type: "resume" | "selfie" | "aadhaar" | "pan" | "bank_proof" | "education" | "address_proof" | "bgv" | "court_check" | "offer" | "appointment" | "other";
  original_filename: string | null;
  stored_filename: string;
  storage_path: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  checksum_sha256: string | null;
  visibility: "private" | "candidate_token" | "hr_only";
  status: "active" | "deleted" | "quarantined";
  uploaded_by_user_id: string | null;
  uploaded_by_candidate_token_id: string | null;
  uploaded_at: string;
  migrated_from_public_url: string | null;
  candidate_id_ref?: string;
};

export type CandidateFileAccessActor =
  | { actorType: "employee"; actorUserId: string | null; actorRole: string | null; }
  | { actorType: "candidate"; actorUserId: null; actorRole: null; candidateId: string };

export function buildCandidateFilePath(candidateId: string, fileId: string, originalName: string): { storagePath: string; storedFilename: string } {
  const ext = path.extname(originalName).toLowerCase();
  const candidateDir = path.join(CANDIDATE_FILES_ROOT, candidateId);
  fs.mkdirSync(candidateDir, { recursive: true });
  const storedFilename = `${fileId}${ext}`;
  return {
    storedFilename,
    storagePath: path.join(candidateDir, storedFilename),
  };
}

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Resolve a stored candidate-file path to a file that exists on THIS machine.
 *
 * storage_path is written absolute at upload time, so a file uploaded from a
 * developer's Windows box against the shared database records e.g.
 *
 *   C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private\ats-candidate-files\<id>\<file>
 *
 * which can never exist on the Linux production server. Verified live 2026-08-16:
 * 5 of 2,238 ats_candidate_file rows carry such a path. For those, the download
 * route's fs.existsSync() returns false and the caller gets a 404 "File not found"
 * that is indistinguishable from a genuinely deleted file — and the denial is
 * audited as "Stored file missing on disk", so the log agrees with the wrong story.
 *
 * This mirrors resolveTemplateFile() in employees/joiningDocumentTemplatePath.ts,
 * which already solved exactly this for document templates after foreign absolute
 * paths there blocked e-signing for three weeks.
 *
 * The fallback is rebuilt from candidate_id + stored_filename rather than by
 * parsing storage_path: both are authoritative columns, and buildCandidateFilePath
 * composes the location from precisely those two values. Parsing would also have to
 * split on both separators, since a backslash is an ordinary filename character on
 * Linux and path.basename() would return the whole string.
 *
 * Returns null when nothing readable is found, so callers keep their existing
 * not-found behaviour rather than proceeding with a bad path.
 */
export function resolveCandidateFilePath(file: {
  storage_path?: unknown;
  candidate_id?: unknown;
  stored_filename?: unknown;
}): string | null {
  const stored = String(file.storage_path ?? "").trim();
  if (stored && safeIsFile(stored)) return stored;

  const candidateId = String(file.candidate_id ?? "").trim();
  const fileName = String(file.stored_filename ?? "").trim();
  if (!candidateId || !fileName) return null;

  // Guard against a stored_filename that somehow carries separators — the joined
  // path must stay inside the candidate's own directory.
  const safeName = fileName.split(/[\\/]/).pop();
  if (!safeName) return null;

  const candidate = path.join(CANDIDATE_FILES_ROOT, candidateId, safeName);
  const expectedDir = path.join(CANDIDATE_FILES_ROOT, candidateId);
  if (!path.resolve(candidate).startsWith(path.resolve(expectedDir))) return null;

  return safeIsFile(candidate) ? candidate : null;
}

function safeIsFile(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export async function persistCandidateFile(input: {
  candidateId: string;
  fileType: CandidateFileRecord["file_type"];
  originalFilename: string;
  mimeType: string | undefined;
  buffer: Buffer;
  visibility?: CandidateFileRecord["visibility"];
  uploadedByUserId?: string | null;
  uploadedByCandidateTokenId?: string | null;
  migratedFromPublicUrl?: string | null;
}): Promise<CandidateFileRecord> {
  const fileId = randomUUID();
  const { storagePath, storedFilename } = buildCandidateFilePath(input.candidateId, fileId, input.originalFilename);
  fs.writeFileSync(storagePath, input.buffer);

  const checksum = hashBuffer(input.buffer);
  const visibility = input.visibility ?? "private";
  const uploadedByUserId = input.uploadedByUserId ?? null;
  const uploadedByCandidateTokenId = input.uploadedByCandidateTokenId ?? null;
  const migratedFromPublicUrl = input.migratedFromPublicUrl ?? null;

  await db.execute(
    `INSERT INTO ats_candidate_file
      (id, candidate_id, file_type, original_filename, stored_filename, storage_path, mime_type, file_size_bytes, checksum_sha256,
       visibility, status, uploaded_by_user_id, uploaded_by_candidate_token_id, migrated_from_public_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      fileId,
      input.candidateId,
      input.fileType,
      input.originalFilename,
      storedFilename,
      storagePath,
      input.mimeType ?? null,
      input.buffer.byteLength,
      checksum,
      visibility,
      uploadedByUserId,
      uploadedByCandidateTokenId,
      migratedFromPublicUrl,
    ]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ats_candidate_file WHERE id = ? LIMIT 1`,
    [fileId]
  );
  return (rows as CandidateFileRecord[])[0];
}

export async function findCandidateFileById(fileId: string): Promise<CandidateFileRecord | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ats_candidate_file WHERE id = ? LIMIT 1`,
    [fileId]
  );
  return (rows as CandidateFileRecord[])[0] ?? null;
}

export async function auditCandidateFileAccess(input: {
  fileId: string;
  candidateId: string;
  actorUserId?: string | null;
  actorType: "candidate" | "employee" | "system";
  action: "view" | "download" | "preview" | "blocked";
  accessResult: "allowed" | "denied";
  denialReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await db.execute(
    `INSERT INTO ats_candidate_file_access_audit
      (id, file_id, candidate_id, actor_user_id, actor_type, action, access_result, denial_reason, ip_address, user_agent)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.fileId,
      input.candidateId,
      input.actorUserId ?? null,
      input.actorType,
      input.action,
      input.accessResult,
      input.denialReason ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ]
  );
}
