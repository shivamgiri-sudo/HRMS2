import crypto from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

export type VaultAccessLevel = "public" | "internal" | "pii" | "payroll" | "confidential";

export interface VaultItem {
  id: string;
  uploaded_by_user: string;
  category: string;
  stored_filename: string;
  original_filename: string;
  mime_type: string | null;
  file_size_bytes: number;
  sha256_hash: string | null;
  access_level: VaultAccessLevel;
  owner_employee_id: string | null;
  owner_candidate_id: string | null;
  is_soft_deleted: number;
  created_at: Date;
}

export interface RegisterUploadInput {
  uploadedByUser: string;
  category: string;
  storedFilename: string;
  originalFilename: string;
  mimeType?: string;
  fileSizeBytes: number;
  sha256Hash?: string;
  accessLevel?: VaultAccessLevel;
  ownerEmployeeId?: string;
  ownerCandidateId?: string;
}

/** Record a newly uploaded file in the vault inventory. Called immediately after multer saves the file. */
export async function registerUpload(input: RegisterUploadInput): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO document_vault_inventory
       (id, uploaded_by_user, category, stored_filename, original_filename,
        mime_type, file_size_bytes, sha256_hash, access_level,
        owner_employee_id, owner_candidate_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.uploadedByUser,
      input.category,
      input.storedFilename,
      input.originalFilename,
      input.mimeType ?? null,
      input.fileSizeBytes,
      input.sha256Hash ?? null,
      input.accessLevel ?? "internal",
      input.ownerEmployeeId ?? null,
      input.ownerCandidateId ?? null,
    ]
  );
  return id;
}

/** Look up a vault item by its stored UUID filename. */
export async function findByStoredFilename(storedFilename: string): Promise<VaultItem | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, uploaded_by_user, category, stored_filename, original_filename,
            mime_type, file_size_bytes, sha256_hash, access_level,
            owner_employee_id, owner_candidate_id, is_soft_deleted, created_at
     FROM document_vault_inventory WHERE stored_filename = ? AND is_soft_deleted = 0`,
    [storedFilename]
  );
  return rows.length > 0 ? (rows[0] as VaultItem) : null;
}

/** Soft-delete a vault item (preserves audit history). */
export async function softDelete(storedFilename: string, deletedByUser: string): Promise<void> {
  await db.execute<ResultSetHeader>(
    `UPDATE document_vault_inventory
        SET is_soft_deleted = 1, deleted_at = NOW(), deleted_by = ?
      WHERE stored_filename = ? AND is_soft_deleted = 0`,
    [deletedByUser, storedFilename]
  );
}

// ── Download tokens ───────────────────────────────────────────

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MINUTES = 15;
const DEFAULT_MAX_USES = 1;

export interface DownloadTokenResult {
  rawToken: string;
  tokenId: string;
  expiresAt: Date;
}

/** Issue a short-lived, single-use download token for a vault item. */
export async function issueDownloadToken(opts: {
  vaultItemId: string;
  issuedTo?: string;
  issuedFor?: string;
  purpose?: string;
  ttlMinutes?: number;
  maxUses?: number;
}): Promise<DownloadTokenResult> {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const ttl = opts.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
  const id = crypto.randomUUID();

  await db.execute(
    `INSERT INTO document_download_token
       (id, token_hash, vault_item_id, issued_to, issued_for, purpose, max_uses, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tokenHash,
      opts.vaultItemId,
      opts.issuedTo ?? null,
      opts.issuedFor ?? null,
      opts.purpose ?? "download",
      opts.maxUses ?? DEFAULT_MAX_USES,
      expiresAt,
    ]
  );

  return { rawToken, tokenId: id, expiresAt };
}

export interface ResolvedToken {
  tokenId: string;
  vaultItemId: string;
  issuedTo: string | null;
}

/**
 * Validate and consume a download token.
 * Returns resolved token if valid, null otherwise.
 * Increments use_count atomically; denies if expired, revoked, or exhausted.
 */
export async function consumeDownloadToken(rawToken: string): Promise<ResolvedToken | null> {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, vault_item_id, issued_to, max_uses, use_count, expires_at, revoked_at
       FROM document_download_token
      WHERE token_hash = ?`,
    [tokenHash]
  );

  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revoked_at !== null) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  if (row.use_count >= row.max_uses) return null;

  await db.execute(
    `UPDATE document_download_token
        SET use_count = use_count + 1, last_used_at = NOW()
      WHERE id = ? AND use_count < max_uses`,
    [row.id]
  );

  return {
    tokenId: row.id,
    vaultItemId: row.vault_item_id,
    issuedTo: row.issued_to,
  };
}

// ── Access audit ──────────────────────────────────────────────

export async function logDocumentAccess(opts: {
  vaultItemId?: string;
  storedPath: string;
  actorUserId?: string;
  actorType?: string;
  action: "view" | "download" | "delete";
  accessResult: "allowed" | "denied";
  denialReason?: string;
  ipAddress?: string;
  userAgent?: string;
  tokenId?: string;
}): Promise<void> {
  await db.execute(
    `INSERT INTO document_access_log
       (vault_item_id, stored_path, actor_user_id, actor_type, action,
        access_result, denial_reason, ip_address, user_agent, token_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.vaultItemId ?? null,
      opts.storedPath,
      opts.actorUserId ?? null,
      opts.actorType ?? "employee",
      opts.action,
      opts.accessResult,
      opts.denialReason ?? null,
      opts.ipAddress ?? null,
      opts.userAgent ?? null,
      opts.tokenId ?? null,
    ]
  );
}
