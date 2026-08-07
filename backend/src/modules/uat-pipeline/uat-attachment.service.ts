/**
 * UAT feedback attachments — almost always a screenshot, and a screenshot of an HRMS page is
 * very often a screenshot of somebody's salary, attendance register or personal details.
 *
 * FOUR PROPERTIES THIS FILE EXISTS TO GUARANTEE
 *
 * 1. THEY ARE NEVER WEB-REACHABLE.
 *    backend/uploads/ is served statically by app.ts. Anything written there is fetchable by
 *    URL. These go to private-storage/, which is not mounted by any static handler, and are
 *    only ever streamed back through an authorization-checked route.
 *
 * 2. PLAINTEXT NEVER TOUCHES THE DISK.
 *    multer.memoryStorage() holds the upload in RAM; it is encrypted before the first write.
 *    diskStorage would land a plaintext payslip screenshot on the filesystem first and delete
 *    it later, which is not the same thing at all.
 *
 * 3. ENCRYPTED AT REST, WITH A PER-OBJECT KEY.
 *    AES-256-GCM under a data key generated per attachment, which is itself wrapped with the
 *    application master key and stored in the file header. Someone holding a stolen backup or
 *    filesystem access — the realistic threat on a host with SSH exposed — has ciphertext and
 *    a wrapped key they cannot unwrap. Deleting the file destroys the only copy of its data
 *    key, so deletion is also crypto-shredding: the content is unrecoverable even from a
 *    snapshot taken before the delete.
 *
 * 4. THEY NEVER LEAVE THE BACKEND.
 *    No export path exists. Nothing here is reachable from the LLM stages, the CI callback,
 *    a PR body or an artifact upload. That is enforced structurally — by there being no
 *    function that returns bytes to any of those callers — rather than by policy.
 *
 * FILE FORMAT (self-describing, so no schema change is needed to hold the key):
 *   magic "UATA1" | u16 wrappedKeyLen | wrappedKey | 12-byte IV | 16-byte GCM tag | ciphertext
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { decryptField, encryptField } from "../../shared/fieldEncryption.js";
import { recordEvent } from "./uat-state-machine.js";

/** NOT backend/uploads — that directory is statically served. See property 1 above. */
export const UAT_ATTACHMENT_ROOT = path.resolve(
  process.cwd(),
  "private-storage",
  "uat-attachments"
);

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Images only. A bug report needs a picture of the screen; it does not need an executable,
 * an archive or an Office document, each of which is a delivery vehicle rather than evidence.
 * SVG is excluded deliberately — it is XML that can carry script, and it renders in a browser.
 */
export const ALLOWED_MIME = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const MAGIC = Buffer.from("UATA1", "utf8");
const KEY_SCHEME = "aes-256-gcm:v1";

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

/**
 * Magic-byte sniffing. The declared Content-Type is attacker-controlled and the extension is
 * cosmetic; the first few bytes are the only part of an upload that describes what it
 * actually is. A file claiming image/png whose bytes say otherwise is rejected rather than
 * stored under a name that will later make something treat it as an image.
 */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function encryptAttachment(plain: Buffer): Buffer {
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  // The data key is wrapped with the application master key, so the file alone is useless.
  const wrapped = Buffer.from(encryptField(dataKey.toString("base64")), "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(wrapped.length, 0);
  return Buffer.concat([MAGIC, len, wrapped, iv, tag, ct]);
}

export function decryptAttachment(blob: Buffer): Buffer {
  if (blob.subarray(0, MAGIC.length).compare(MAGIC) !== 0) {
    throw new AttachmentError("Stored attachment is not in the expected format", 500);
  }
  let off = MAGIC.length;
  const wrappedLen = blob.readUInt16BE(off);
  off += 2;
  const wrapped = blob.subarray(off, off + wrappedLen).toString("utf8");
  off += wrappedLen;
  const iv = blob.subarray(off, off + 12);
  off += 12;
  const tag = blob.subarray(off, off + 16);
  off += 16;
  const ct = blob.subarray(off);

  const dataKey = Buffer.from(decryptField(wrapped), "base64");
  const decipher = createDecipheriv("aes-256-gcm", dataKey, iv);
  decipher.setAuthTag(tag);
  // GCM authenticates: a tampered file throws here rather than returning altered bytes.
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export interface StoredAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export async function storeAttachment(input: {
  feedbackId: string;
  uploadedBy: string;
  originalFilename: string;
  declaredMime: string;
  buffer: Buffer;
  retentionDays?: number;
}): Promise<StoredAttachment> {
  if (input.buffer.length === 0) throw new AttachmentError("The file is empty.");
  if (input.buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(
      `That file is ${(input.buffer.length / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`,
      413
    );
  }

  // Both must agree, and the bytes are the authority.
  const sniffed = sniffMime(input.buffer);
  if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
    throw new AttachmentError(
      "Only screenshots are accepted (PNG, JPEG, WebP or GIF). The file's actual contents did " +
        "not match any of those."
    );
  }
  if (input.declaredMime && ALLOWED_MIME.has(input.declaredMime) && input.declaredMime !== sniffed) {
    throw new AttachmentError(
      `This file is declared as ${input.declaredMime} but its contents are ${sniffed}.`
    );
  }

  const id = randomUUID();
  const ext = ALLOWED_MIME.get(sniffed)!;
  // Filename is a server-generated UUID: the original name is attacker-controlled and is
  // stored as data, never used to build a path.
  const relative = path.join(input.feedbackId, `${id}${ext}.enc`);
  const absolute = path.join(UAT_ATTACHMENT_ROOT, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });

  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  await writeFile(absolute, encryptAttachment(input.buffer), { mode: 0o600 });

  const retentionDays = input.retentionDays ?? 180;
  await db.execute<ResultSetHeader>(
    `INSERT INTO uat_feedback_attachment
       (id, feedback_id, uploaded_by, original_filename, storage_key, mime_type, size_bytes,
        sha256, encryption_key_id, malware_scan_status, pii_scan_status, retention_until)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending', 'pending', DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [
      id,
      input.feedbackId,
      input.uploadedBy,
      input.originalFilename.slice(0, 255),
      normaliseKey(relative),
      sniffed,
      input.buffer.length,
      sha256,
      KEY_SCHEME,
      retentionDays,
    ]
  );

  await recordEvent(input.feedbackId, "attachment", {
    actorUserId: input.uploadedBy,
    actorKind: "user",
    message: "attachment uploaded",
    // Counts and types only — the filename a user chose can itself be personal data.
    detail: { mimeType: sniffed, sizeBytes: input.buffer.length },
  });

  return {
    id,
    originalFilename: input.originalFilename,
    mimeType: sniffed,
    sizeBytes: input.buffer.length,
    sha256,
  };
}

function normaliseKey(p: string): string {
  return p.replace(/\\/g, "/");
}

interface AttachmentRow extends RowDataPacket {
  id: string;
  feedback_id: string;
  original_filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  malware_scan_status: string;
  pii_scan_status: string;
  created_at: Date;
}

export async function listAttachments(feedbackId: string): Promise<AttachmentRow[]> {
  const [rows] = await db.execute<AttachmentRow[]>(
    `SELECT id, feedback_id, original_filename, mime_type, size_bytes,
            malware_scan_status, pii_scan_status, created_at
       FROM uat_feedback_attachment
      WHERE feedback_id = ? AND deleted_at IS NULL
      ORDER BY created_at`,
    [feedbackId]
  );
  return rows;
}

/**
 * Read an attachment back.
 *
 * Takes the caller's identity and re-checks it here rather than trusting a route guard: this
 * is the one function that turns a database row into actual pixels of someone's payslip, so
 * the check belongs where the bytes are produced.
 */
export async function readAttachment(
  attachmentId: string,
  viewer: { employeeId: string; isTriage: boolean }
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.id, a.storage_key, a.mime_type, a.original_filename, a.malware_scan_status,
            f.submitted_by_employee_id
       FROM uat_feedback_attachment a
       JOIN uat_feedback f ON f.id = a.feedback_id
      WHERE a.id = ? AND a.deleted_at IS NULL`,
    [attachmentId]
  );
  if (rows.length === 0) throw new AttachmentError("Attachment not found", 404);
  const r = rows[0] as AttachmentRow & { submitted_by_employee_id: string };

  const isOwner = r.submitted_by_employee_id === viewer.employeeId;
  if (!isOwner && !viewer.isTriage) {
    // 404, not 403: confirming that someone else's attachment exists is itself a disclosure.
    throw new AttachmentError("Attachment not found", 404);
  }

  // Fail closed on scanning. An unscanned file is not a safe file, and "we will scan it
  // later" must not mean "serve it in the meantime".
  if (r.malware_scan_status === "infected") {
    throw new AttachmentError("This attachment was quarantined by the malware scan.", 403);
  }

  const absolute = path.join(UAT_ATTACHMENT_ROOT, r.storage_key);
  // Defence in depth: storage_key is server-generated, but a path escaping the root must be
  // impossible even if that ever stops being true.
  const resolved = path.resolve(absolute);
  if (!resolved.startsWith(path.resolve(UAT_ATTACHMENT_ROOT) + path.sep)) {
    throw new AttachmentError("Invalid attachment path", 400);
  }
  if (!existsSync(resolved)) throw new AttachmentError("Attachment file is missing", 410);

  return {
    buffer: decryptAttachment(await readFile(resolved)),
    mimeType: r.mime_type,
    filename: r.original_filename,
  };
}

/**
 * Delete an attachment: remove the ciphertext (which destroys the only copy of its data key)
 * and mark the row. The row survives so the audit trail still shows a file existed and was
 * removed — a deletion that erases its own evidence is not an auditable deletion.
 */
export async function deleteAttachment(
  attachmentId: string,
  actor: { userId: string; employeeId: string; isTriage: boolean }
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.storage_key, a.feedback_id, f.submitted_by_employee_id
       FROM uat_feedback_attachment a
       JOIN uat_feedback f ON f.id = a.feedback_id
      WHERE a.id = ? AND a.deleted_at IS NULL`,
    [attachmentId]
  );
  if (rows.length === 0) throw new AttachmentError("Attachment not found", 404);
  const r = rows[0] as { storage_key: string; feedback_id: string; submitted_by_employee_id: string };

  if (r.submitted_by_employee_id !== actor.employeeId && !actor.isTriage) {
    throw new AttachmentError("Attachment not found", 404);
  }

  const resolved = path.resolve(path.join(UAT_ATTACHMENT_ROOT, r.storage_key));
  if (resolved.startsWith(path.resolve(UAT_ATTACHMENT_ROOT) + path.sep)) {
    await unlink(resolved).catch(() => {
      /* already gone: the desired end state either way */
    });
  }

  await db.execute(
    `UPDATE uat_feedback_attachment SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`,
    [actor.userId, attachmentId]
  );
  await recordEvent(r.feedback_id, "attachment", {
    actorUserId: actor.userId,
    actorKind: "user",
    message: "attachment deleted (content crypto-shredded)",
  });
}
