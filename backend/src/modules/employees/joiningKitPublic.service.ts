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
    reject("This signing link has been replaced by a newer one. Please check your email for the most recent message from MAS Callnet and use the link in that email.");
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
    // This table records initiated_at, not created_at. Ordering by a column
    // that does not exist made every real signing link answer 500 — invisible
    // to a test that only ever used an invalid token, because that path returns
    // 404 before reaching this query.
    `SELECT provider_url, status FROM employee_document_esign_transaction
      WHERE kit_id = ? AND scope = 'kit' ORDER BY initiated_at DESC LIMIT 1`,
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
 * eMudhra signing URLs are one-shot: once the signer has opened one, closing the
 * tab or reloading gives "Invalid Page" for good, and the vendor then reports the
 * session FAILED. The HRMS link must nonetheless stay usable until the signer has
 * actually signed, so every "Proceed" that finds the stored session already used
 * (or dead) starts a fresh vendor session over the same kit PDF.
 */
const DEAD_TX = ["failed", "expired", "cancelled", "abandoned_unresolved"];

type KitTx = RowDataPacket & {
  id: string; checklist_id: string; candidate_id: string | null; employee_id: string;
  client_transaction_id: string | null; status: string; provider_url: string | null;
  signer_email: string | null; initiated_by: string | null; initiated_at: Date | string;
};

async function latestKitTx(kitId: string): Promise<KitTx | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, checklist_id, candidate_id, employee_id, client_transaction_id, status,
            provider_url, signer_email, initiated_by, initiated_at
       FROM employee_document_esign_transaction
      WHERE kit_id = ? AND scope = 'kit' ORDER BY initiated_at DESC LIMIT 1`,
    [kitId],
  );
  return (rows[0] as KitTx | undefined) ?? null;
}

/**
 * Start a new vendor session for a kit whose current one was already opened or is
 * dead. Never runs for a signed kit, and first asks the vendor whether the old
 * session was in fact completed, so a signature is never discarded.
 */
async function freshProviderSession(kitId: string, old: KitTx): Promise<string | null> {
  const [lock] = await db.execute<RowDataPacket[]>(`SELECT GET_LOCK(?, 0) AS got`, [`kit-esign-${kitId}`]);
  if (!Number(lock[0]?.got)) return null; // a parallel click is already creating one
  try {
    if (old.client_transaction_id) {
      const { syncEsignStatus } = await import("../integrations/luckpay/luckpay-status.service.js");
      const synced = await syncEsignStatus(String(old.client_transaction_id)).catch(() => null);
      if (synced?.state === "completed") return "__signed__";
    }
    // A parallel click may have finished creating a session while we waited.
    const current = await latestKitTx(kitId);
    if (current && current.id !== old.id) return current.provider_url;

    const [kitRows] = await db.execute<RowDataPacket[]>(
      `SELECT f.storage_path, e.full_name, e.employee_code, b.branch_name, k.document_count
         FROM employee_joining_esign_kit k
         JOIN employee_joining_document_file f ON f.id = k.kit_file_id AND f.deleted_at IS NULL
         JOIN employees e ON e.id = k.employee_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE k.id = ? AND k.signed_file_id IS NULL LIMIT 1`,
      [kitId],
    );
    const kit = kitRows[0];
    if (!kit?.storage_path || !fs.existsSync(String(kit.storage_path))) return null;

    const { luckpayClient, esignWithUrl } = await import("../integrations/luckpay/luckpay.client.js");
    const clientTransactionId = luckpayClient.generateClientTransactionId("joining-kit");
    const r = await Promise.race([
      esignWithUrl({
        filePath: String(kit.storage_path),
        clientTransactionId,
        signedBy: String(kit.full_name ?? kit.employee_code ?? "Employee"),
        location: String(kit.branch_name ?? "India"),
        reason: `Joining Documents Kit (${Number(kit.document_count ?? 0)} documents)`,
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("eSign provider timed out after 30 s")), 30_000)),
    ]);
    if (!r.providerUrl || !/^https?:/i.test(r.providerUrl) || /fail|error|reject|declin|cancel|expire/i.test(String(r.status ?? ""))) {
      return null;
    }
    await db.execute(
      `INSERT INTO employee_document_esign_transaction
         (id, checklist_id, kit_id, scope, employee_id, candidate_id, document_code, provider,
          client_transaction_id, provider_reference_id, signer_name, signer_email,
          signer_location, signing_reason, status, provider_url, initiated_by)
       VALUES (UUID(), ?, ?, 'kit', ?, ?, 'JOINING_KIT', 'luckpay', ?, ?, ?, ?, ?, 'Joining Documents Kit', ?, ?, ?)`,
      [
        old.checklist_id, kitId, old.employee_id, old.candidate_id,
        clientTransactionId, r.providerReferenceId ?? null,
        kit.full_name ?? null, old.signer_email, kit.branch_name ?? "India",
        String(r.status ?? "initiated"), r.providerUrl, old.initiated_by,
      ],
    );
    // The burned session no longer needs polling; the fresh row is now the latest.
    await db.execute(
      `UPDATE employee_document_esign_transaction SET status = 'cancelled' WHERE id = ? AND status <> 'cancelled'`,
      [old.id],
    ).catch(() => undefined);
    return r.providerUrl;
  } finally {
    await db.execute(`SELECT RELEASE_LOCK(?)`, [`kit-esign-${kitId}`]).catch(() => undefined);
  }
}

/**
 * Hand back the provider URL. Records that the signer opened it, which is the
 * only evidence we have that the link was actually reached — and, because the
 * vendor URL is one-shot, also what tells the next call the URL is used up.
 */
export async function startKitEsign(params: {
  token: string; ipAddress?: string | null; userAgent?: string | null;
}): Promise<{ providerUrl: string | null; txStatus: string | null; message: string | null }> {
  const session = await getPublicKitSession(params.token);
  const employeeId = await kitEmployeeId(session.kitId);
  let providerUrl = session.providerUrl;
  let txStatus = session.txStatus;

  const tx = await latestKitTx(session.kitId);
  if (tx && session.status !== "signed" && !session.signedAt) {
    const [opened] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM employee_joining_document_audit_log
        WHERE employee_id = ? AND document_code = 'JOINING_KIT' AND action_type = 'KIT_ESIGN_OPENED'
          AND created_at >= ? AND new_value LIKE ?`,
      [employeeId, tx.initiated_at, `%${session.kitId}%`],
    );
    const used = Number(opened[0]?.n ?? 0) > 0;
    if (used || DEAD_TX.includes(String(tx.status).toLowerCase()) || !tx.provider_url) {
      try {
        const fresh = await freshProviderSession(session.kitId, tx);
        if (fresh === "__signed__") {
          return { providerUrl: null, txStatus: "completed",
            message: "These documents have already been signed. No further action is needed." };
        }
        if (fresh) { providerUrl = fresh; txStatus = "initiated"; }
      } catch (e) {
        console.warn("[joining-kit] fresh session failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  await db.execute(
    `INSERT INTO employee_joining_document_audit_log
       (id, employee_id, document_code, action_type, actor_type, new_value, ip_address, user_agent, created_at)
     VALUES (UUID(), ?, 'JOINING_KIT', 'KIT_ESIGN_OPENED', 'public_token', ?, ?, ?, NOW())`,
    [
      // employee_id is NOT NULL; the kit always has one.
      employeeId,
      JSON.stringify({ kitId: session.kitId, hasProviderUrl: Boolean(providerUrl) }),
      params.ipAddress ?? null,
      params.userAgent ?? null,
    ],
  ).catch((e) => {
    console.warn("[joining-kit] audit KIT_ESIGN_OPENED failed:", e instanceof Error ? e.message : e);
  });

  return {
    providerUrl,
    txStatus,
    message: providerUrl
      ? null
      : "The eSign provider is not available right now. Please try again in a few minutes, or contact HR.",
  };
}

async function kitEmployeeId(kitId: string): Promise<string> {
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM employee_joining_esign_kit WHERE id = ? LIMIT 1`, [kitId]);
  return String(r[0]?.employee_id ?? "");
}
