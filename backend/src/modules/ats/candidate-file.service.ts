import fs from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import { fileURLToPath } from "url";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CANDIDATE_FILES_ROOT = path.resolve(__dirname, "../../../private/ats-candidate-files");

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
  return (rows as any[])[0] as CandidateFileRecord;
}

export async function findCandidateFileById(fileId: string): Promise<CandidateFileRecord | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ats_candidate_file WHERE id = ? LIMIT 1`,
    [fileId]
  );
  return ((rows as any[])[0] ?? null) as CandidateFileRecord | null;
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
