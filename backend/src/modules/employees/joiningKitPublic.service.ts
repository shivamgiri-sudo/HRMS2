/**
 * The employee-facing half of the joining kit.
 *
 * The dispatcher mails a link to /employee/joining-kit/esign/<token>. Until this
 * existed, that link resolved to nothing — the kit could be assembled, billed
 * and mailed, and the recipient would land on a 404. Everything here is reached
 * with a bearer-less token from an email, so it is deliberately narrow: it
 * discloses only what the signer needs in order to know what they are signing,
 * and it never accepts an identifier from the caller other than the token.
 */
import { createHash } from "crypto";
import fs from "fs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export type KitSession = {
  kitId: string;
  employeeName: string;
  employeeCode: string | null;
  branchName: string | null;
  status: string;
  documentCount: number;
  totalPages: number;
  documents: Array<{ code: string; name: string; pageFrom: number; pageTo: number }>;
  providerUrl: string | null;
  txStatus: string | null;
  signedAt: string | null;
  expiresAt: string | null;
};

/** Anything that is not a live, unexpired kit token gets one flat error. */
function reject(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 404, code: "KIT_LINK_INVALID" });
}

async function resolveToken(token: string): Promise<RowDataPacket> {
  if (!token || token.length < 20) reject("This signing link is not valid.");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.id, t.kit_id, t.employee_id, t.token_status, t.expires_at
       FROM employee_joining_document_public_token t
      WHERE t.public_token_hash = ? AND t.document_code = 'JOINING_KIT'
      LIMIT 1`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) reject("This signing link is not valid.");
  if (!row.kit_id) reject("This signing link is not valid.");
  if (String(row.token_status) !== "active") {
    // Distinguish "already done" from "revoked": a signer who completed and
    // re-opened the mail should be told they are finished, not that the link
    // is broken.
    if (String(row.token_status) === "consumed") {
      throw Object.assign(new Error("These documents have already been signed. No further action is needed."),
        { statusCode: 410, code: "KIT_ALREADY_SIGNED" });
    }
    reject("This signing link is no longer active. Please ask HR to resend it.");
  }
  if (row.expires_at && new Date(String(row.expires_at)).getTime() < Date.now()) {
    throw Object.assign(new Error("This signing link has expired. Please ask HR to resend it."),
      { statusCode: 410, code: "KIT_LINK_EXPIRED" });
  }
  return row;
}

export async function getPublicKitSession(token: string): Promise<KitSession> {
  const tok = await resolveToken(token);
  const [kitRows] = await db.execute<RowDataPacket[]>(
    `SELECT k.id, k.status, k.document_count, k.total_pages, k.completed_at,
            e.full_name, e.employee_code, b.branch_name
       FROM employee_joining_esign_kit k
       JOIN employees e ON e.id = k.employee_id
  LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE k.id = ? LIMIT 1`,
    [String(tok.kit_id)],
  );
  const kit = kitRows[0];
  if (!kit) reject("This signing link is not valid.");

  const [items] = await db.execute<RowDataPacket[]>(
    `SELECT document_code, document_name, page_from, page_to
       FROM employee_joining_esign_kit_item
      WHERE kit_id = ? ORDER BY sort_order`,
    [String(tok.kit_id)],
  );

  const [tx] = await db.execute<RowDataPacket[]>(
    `SELECT provider_url, status FROM employee_document_esign_transaction
      WHERE kit_id = ? AND scope = 'kit' ORDER BY created_at DESC LIMIT 1`,
    [String(tok.kit_id)],
  );

  return {
    kitId: String(kit.id),
    employeeName: String(kit.full_name ?? ""),
    employeeCode: kit.employee_code ? String(kit.employee_code) : null,
    branchName: kit.branch_name ? String(kit.branch_name) : null,
    status: String(kit.status),
    documentCount: Number(kit.document_count ?? items.length),
    totalPages: Number(kit.total_pages ?? 0),
    documents: items.map((i) => ({
      code: String(i.document_code),
      name: String(i.document_name ?? i.document_code),
      pageFrom: Number(i.page_from),
      pageTo: Number(i.page_to),
    })),
    providerUrl: tx[0]?.provider_url ? String(tx[0].provider_url) : null,
    txStatus: tx[0]?.status ? String(tx[0].status) : null,
    signedAt: kit.completed_at ? new Date(String(kit.completed_at)).toISOString() : null,
    expiresAt: tok.expires_at ? new Date(String(tok.expires_at)).toISOString() : null,
  };
}

/**
 * The merged PDF the signer is about to sign.
 *
 * Serves the signed artefact once it exists, otherwise the draft — so the same
 * link keeps working after signing and returns what was actually signed.
 */
export async function getPublicKitFile(token: string): Promise<{
  storagePath: string; fileName: string; mimeType: string;
}> {
  const tok = await resolveToken(token).catch(async (e) => {
    // A consumed token must still be able to download its own signed copy.
    if ((e as { code?: string }).code === "KIT_ALREADY_SIGNED") {
      const [r] = await db.execute<RowDataPacket[]>(
        `SELECT kit_id, employee_id FROM employee_joining_document_public_token
          WHERE public_token_hash = ? AND document_code = 'JOINING_KIT' LIMIT 1`,
        [sha256(token)],
      );
      if (r[0]) return r[0];
    }
    throw e;
  });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT f.storage_path, f.original_filename, f.mime_type, f.file_role
       FROM employee_joining_esign_kit k
       JOIN employee_joining_document_file f
         ON f.id = COALESCE(k.signed_file_id, k.kit_file_id)
      WHERE k.id = ? AND f.deleted_at IS NULL
      LIMIT 1`,
    [String(tok.kit_id)],
  );
  const file = rows[0];
  if (!file || !file.storage_path) {
    throw Object.assign(new Error("The document file is not available. Please contact HR."),
      { statusCode: 404, code: "KIT_FILE_MISSING" });
  }
  const p = String(file.storage_path);
  if (!fs.existsSync(p)) {
    // The row can outlive the file; say so plainly rather than streaming a 0-byte
    // response that looks like a corrupt download.
    throw Object.assign(new Error("The document file is not available. Please contact HR."),
      { statusCode: 404, code: "KIT_FILE_MISSING" });
  }
  return {
    storagePath: p,
    fileName: String(file.original_filename ?? "joining-documents.pdf"),
    mimeType: String(file.mime_type ?? "application/pdf"),
  };
}

/**
 * Hand back the provider URL. Records that the signer opened it, which is the
 * only evidence we have that the link was actually reached.
 */
export async function startKitEsign(params: {
  token: string; ipAddress?: string | null; userAgent?: string | null;
}): Promise<{ providerUrl: string | null; txStatus: string | null; message: string | null }> {
  const session = await getPublicKitSession(params.token);
  await db.execute(
    `INSERT INTO employee_joining_document_audit_log
       (id, employee_id, document_code, action_type, actor_type, new_value, ip_address, user_agent, acted_at)
     VALUES (UUID(), ?, 'JOINING_KIT', 'KIT_ESIGN_OPENED', 'public_token', ?, ?, ?, NOW())`,
    [
      // employee_id is NOT NULL; the kit always has one.
      await kitEmployeeId(session.kitId),
      JSON.stringify({ kitId: session.kitId, hasProviderUrl: Boolean(session.providerUrl) }),
      params.ipAddress ?? null,
      params.userAgent ?? null,
    ],
  ).catch((e) => {
    console.warn("[joining-kit] audit KIT_ESIGN_OPENED failed:", e instanceof Error ? e.message : e);
  });

  return {
    providerUrl: session.providerUrl,
    txStatus: session.txStatus,
    message: session.providerUrl
      ? null
      : "The eSign provider is not available right now. Please contact HR — your documents can be signed manually.",
  };
}

async function kitEmployeeId(kitId: string): Promise<string> {
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM employee_joining_esign_kit WHERE id = ? LIMIT 1`, [kitId]);
  return String(r[0]?.employee_id ?? "");
}
