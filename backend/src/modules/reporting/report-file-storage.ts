import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../../db/mysql.js';

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads', 'reports');

function getMonthDir(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export interface StoreReportFileResult {
  fileId: string;
  storagePath: string;
  storageKey: string;
  sha256: string;
  expiresAt: Date;
}

export async function storeReportFile(params: {
  requestId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  rowCount: number;
  colCount: number;
  retentionDays: number;
}): Promise<StoreReportFileResult> {
  const fileId = randomUUID();
  const ext = path.extname(params.filename) || '.xlsx';
  const storedFilename = `${fileId}${ext}`;
  const monthDir = getMonthDir();
  const relDir = path.join(monthDir, params.requestId);
  const absDir = path.join(UPLOADS_ROOT, relDir);

  fs.mkdirSync(absDir, { recursive: true });

  const absPath = path.join(absDir, storedFilename);
  fs.writeFileSync(absPath, params.buffer);

  const sha256 = createHash('sha256').update(params.buffer).digest('hex');
  const storageKey = path.join('reports', relDir, storedFilename).replace(/\\/g, '/');
  const expiresAt = new Date(Date.now() + params.retentionDays * 24 * 60 * 60 * 1000);

  await db.execute(
    `INSERT INTO report_generated_file
       (id, report_request_id, storage_provider, storage_key, original_filename, stored_filename,
        mime_type, file_extension, file_size_bytes, sha256_checksum, encryption_status,
        generated_row_count, generated_column_count, generated_at, expires_at)
     VALUES (?,?,?,?,?,?, ?,?,?,?,'none', ?,?,NOW(),?)`,
    [
      fileId,
      params.requestId,
      'local',
      storageKey,
      params.filename,
      storedFilename,
      params.mimeType,
      ext,
      params.buffer.length,
      sha256,
      params.rowCount,
      params.colCount,
      expiresAt,
    ]
  );

  return { fileId, storagePath: absPath, storageKey, sha256, expiresAt };
}

export function resolveStoragePath(storageKey: string): string {
  return path.resolve(process.cwd(), 'uploads', storageKey);
}

export async function deleteReportFile(fileId: string): Promise<void> {
  const [rows] = await db.execute<import('mysql2').RowDataPacket[]>(
    `SELECT storage_key, deletion_status FROM report_generated_file WHERE id = ?`,
    [fileId]
  );
  if (!rows.length) return;

  const file = rows[0] as { storage_key: string; deletion_status: string | null };
  if (file.deletion_status === 'deleted') return;

  const absPath = resolveStoragePath(file.storage_key);
  let deletionError: string | null = null;

  try {
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }
  } catch (err) {
    deletionError = err instanceof Error ? err.message : String(err);
  }

  await db.execute(
    `UPDATE report_generated_file
     SET deleted_at = NOW(), deletion_status = ?, deletion_error = ?
     WHERE id = ?`,
    [deletionError ? 'failed' : 'deleted', deletionError, fileId]
  );
}
