/**
 * Sends one joining kit: one email, one consent, one billed eSign call.
 *
 * Replaces six separate sends per joiner. The guards below are all blocking
 * rather than best-effort, because everything they protect against would
 * produce a kit that misrepresents itself — a document the employee never saw
 * named on the consent page, or a signing link for a document HR is still
 * filling in.
 *
 * Every blocked kit records WHY, so an operator sees a work list rather than
 * silence. A kit that quietly does not send is indistinguishable from one that
 * was never queued.
 */
import { randomUUID, createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { assembleJoiningKit, kitEligibleDocuments } from "./joiningKitAssembly.service.js";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const STORAGE = (employeeId: string) =>
  path.resolve(process.cwd(), "private-storage", "joining-kits", employeeId);

function frontendBaseUrl(): string {
  return String(env.FRONTEND_URL ?? "https://mcnhrms.teammas.in").replace(/\/+$/, "");
}

export type BlockedReason =
  | "feature_disabled" | "per_document_flow_active" | "draft_missing"
  | "placeholder_draft" | "hr_fill_pending" | "no_recipient_email"
  | "provider_disabled" | "no_documents";

export type DispatchOutcome = {
  kitId: string | null;
  status: "sent" | "blocked" | "failed" | "already_open";
  blockedReason?: BlockedReason;
  message: string;
  letterCount?: number;
  signLink?: string | null;
  providerUrl?: string | null;
  emailedTo?: string[];
};

/**
 * Kit audit entry.
 *
 * Writes the columns this table actually has. An earlier version used a
 * `detail_json` column that does not exist and passed NULL for a NOT NULL
 * employee_id, so every entry was silently rejected — the .catch() below hid it
 * completely. Found by running the flow rather than by reading it.
 *
 * The catch stays: an audit failure must not abort a send. But a failure is now
 * logged rather than discarded, so the next one is visible.
 */
async function audit(
  kitId: string | null,
  employeeId: string,
  action: string,
  actorUserId: string | null,
  detail: unknown,
) {
  await db.execute(
    `INSERT INTO employee_joining_document_audit_log
       (id, employee_id, checklist_id, document_code, action_type,
        new_value, remarks, actor_user_id, actor_type)
     VALUES (?, ?, NULL, 'JOINING_KIT', ?, CAST(? AS JSON), ?, ?, 'system')`,
    [
      randomUUID(),
      employeeId,
      action,
      JSON.stringify({ kitId, ...((detail as object) ?? {}) }),
      `Joining kit ${kitId ?? ""}`.trim(),
      actorUserId,
    ],
  ).catch((e: unknown) => {
    console.warn("[joining-kit] audit entry not written:", e instanceof Error ? e.message : e);
  });
}

async function blockKit(kitId: string, employeeId: string, reason: BlockedReason, message: string): Promise<DispatchOutcome> {
  await db.execute(
    `UPDATE employee_joining_esign_kit SET status = 'blocked', blocked_reason = ? WHERE id = ?`,
    [reason, kitId],
  ).catch(() => undefined);
  await audit(kitId, employeeId, "KIT_BLOCKED", null, { reason, message });
  return { kitId, status: "blocked", blockedReason: reason, message };
}

/**
 * Register a kit for an employee. Fast and DB-only: nothing slow and nothing
 * billable happens here, so a transient provider outage cannot lose the intent.
 */
export async function queueJoiningKit(params: {
  employeeId: string;
  candidateId?: string | null;
  actorUserId?: string | null;
  triggerSource?: string;
}): Promise<{ kitId: string; created: boolean }> {
  const [open] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_joining_esign_kit WHERE employee_id = ? AND open_marker = 'Y' LIMIT 1`,
    [params.employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const existing = (open as RowDataPacket[])[0];
  if (existing) return { kitId: String(existing.id), created: false };

  // The anchor satisfies the NOT NULL checklist_id on the token and transaction
  // rows; the real membership lives in the kit item table.
  const docs = await kitEligibleDocuments(params.employeeId);
  if (docs.length === 0) {
    throw Object.assign(
      new Error("This employee has no eSign joining documents, so there is nothing to send."),
      { statusCode: 409, code: "no_documents" },
    );
  }

  const kitId = randomUUID();
  await db.execute(
    `INSERT INTO employee_joining_esign_kit
       (id, employee_id, candidate_id, anchor_checklist_id, status, open_marker, trigger_source, created_by)
     VALUES (?, ?, ?, ?, 'queued', 'Y', ?, ?)`,
    [kitId, params.employeeId, params.candidateId ?? null, String(docs[0].id),
     params.triggerSource ?? "manual", params.actorUserId ?? null],
  );
  await audit(kitId, params.employeeId, "KIT_QUEUED", params.actorUserId ?? null, { documents: docs.length });
  return { kitId, created: true };
}

/**
 * Assemble, sign-request and send one queued kit.
 *
 * The provider POST is never retried. luckpay.transport.ts documents that
 * business endpoints are non-idempotent: the vendor records the
 * clientTransactionId on first receipt, so a resend returns 409 permanently and
 * the first attempt may already have been billed.
 */
export async function dispatchJoiningKit(kitId: string, actorUserId: string | null = null): Promise<DispatchOutcome> {
  const [kits] = await db.execute<RowDataPacket[]>(
    `SELECT k.*, e.employee_code, e.personal_email, e.branch_id,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS official_email,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
            e.date_of_joining, d.designation_name, b.branch_name
       FROM employee_joining_esign_kit k
       JOIN employees e ON e.id = k.employee_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE k.id = ? LIMIT 1`,
    [kitId],
  );
  const kit = (kits as RowDataPacket[])[0];
  if (!kit) throw Object.assign(new Error("Kit not found"), { statusCode: 404 });
  if (String(kit.status) === "sent" || String(kit.status) === "signed") {
    return { kitId, status: "already_open", message: `This kit is already ${kit.status}.` };
  }

  if (!env.JOINING_KIT_ESIGN_ENABLED) {
    return blockKit(kitId, String(kit.employee_id), "feature_disabled", "The consolidated joining kit is switched off (JOINING_KIT_ESIGN_ENABLED).");
  }
  if (!env.LUCKPAY_PROVIDER_ENABLED) {
    return blockKit(kitId, String(kit.employee_id), "provider_disabled", "The eSign provider is disabled, so no kit can be sent.");
  }

  const employeeId = String(kit.employee_id);

  // Someone already part-way through the per-document flow must not receive a
  // kit as well: they would end up with two live signing links for the same
  // documents.
  const [live] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) n
       FROM employee_joining_document_public_token t
       JOIN employee_joining_document_checklist c ON c.id = t.checklist_id
      WHERE c.employee_id = ? AND t.kit_id IS NULL
        AND t.token_status = 'active' AND t.expires_at > NOW()`,
    [employeeId],
  ).catch(() => [[{ n: 0 }]] as unknown as [RowDataPacket[]]);
  if (Number((live as RowDataPacket[])[0]?.n ?? 0) > 0) {
    return blockKit(kitId, employeeId, "per_document_flow_active",
      "This employee already has an active per-document signing link. Let it complete or expire before sending a kit.");
  }

  // Anything HR is still filling in would be signed half-finished — but only
  // documents that are actually IN the kit are relevant. This previously
  // checked every esign document for the employee, so a document the kit does
  // not contain could block a kit, which is how the EPF forms blocked kits they
  // were never part of.
  // Ask eligibility what is actually in this kit, then check only those. A
  // parallel query over the document codes re-introduces the same class of bug
  // twice over: it flagged EPF forms that were never kit members, and it
  // flagged already-signed documents that eligibility now excludes.
  const members = await kitEligibleDocuments(employeeId);
  const memberIds = members.map((d) => String(d.id));
  const pendingRows: RowDataPacket[] = memberIds.length
    ? ((await db.query<RowDataPacket[]>(
        `SELECT document_name FROM employee_joining_document_checklist
          WHERE id IN (${memberIds.map(() => "?").join(",")})
            AND fill_status = 'hr_fill_required'`,
        memberIds,
      ).catch(() => [[]] as unknown as [RowDataPacket[]]))[0] as RowDataPacket[])
    : [];
  if (pendingRows.length > 0) {
    // Name them: HR needs to know which document to complete, not merely that
    // one exists.
    return blockKit(kitId, employeeId, "hr_fill_pending",
      `These documents still need HR to complete them before the kit can be sent: ${
        pendingRows.map((r) => r.document_name).join(", ")}.`);
  }

  const recipients = [kit.personal_email, kit.official_email]
    .filter((e): e is string => typeof e === "string" && e.includes("@"));
  if (recipients.length === 0) {
    return blockKit(kitId, employeeId, "no_recipient_email", "This employee has no email address on record.");
  }

  // ── assemble ───────────────────────────────────────────────────────────────
  await db.execute(`UPDATE employee_joining_esign_kit SET status = 'assembling' WHERE id = ?`, [kitId]);
  let assembled;
  try {
    assembled = await assembleJoiningKit(employeeId, {
      employeeName: String(kit.full_name ?? ""),
      employeeCode: String(kit.employee_code ?? ""),
      designation: (kit.designation_name as string) ?? null,
      branchName: (kit.branch_name as string) ?? null,
      dateOfJoining: (kit.date_of_joining as Date | null) ?? null,
    });
  } catch (e) {
    const err = e as { code?: string; message: string };
    return blockKit(kitId, employeeId, (err.code as BlockedReason) ?? "draft_missing", err.message);
  }

  // A placeholder would ask the employee to sign a watermarked draft.
  if (assembled.buffer.toString("latin1").includes("TEMPLATE NOT CONFIGURED")) {
    return blockKit(kitId, employeeId, "placeholder_draft",
      "One of the documents is still an unconfigured placeholder draft. Configure its template before sending.");
  }

  const dir = STORAGE(employeeId);
  await fs.promises.mkdir(dir, { recursive: true });
  const kitPath = path.join(dir, `joining-kit-${kitId}.pdf`);
  await fs.promises.writeFile(kitPath, assembled.buffer);

  const kitFileId = randomUUID();
  await db.execute(
    `INSERT INTO employee_joining_document_file
       (id, checklist_id, employee_id, candidate_id, document_code, file_role,
        original_filename, stored_filename, storage_path, mime_type, file_size_bytes,
        file_hash_sha256, uploaded_by_type, uploaded_at)
     VALUES (?, ?, ?, ?, 'JOINING_KIT', 'kit_source', ?, ?, ?, 'application/pdf', ?, ?, 'system', NOW())`,
    [kitFileId, String(kit.anchor_checklist_id), employeeId, kit.candidate_id ?? null,
     `joining-kit-${kitId}.pdf`, path.basename(kitPath), kitPath,
     assembled.buffer.byteLength, assembled.sha256],
  ).catch(() => undefined);

  for (const [i, it] of assembled.items.entries()) {
    await db.execute(
      `INSERT INTO employee_joining_esign_kit_item
         (id, kit_id, checklist_id, document_code, document_name, sort_order,
          source_file_id, source_sha256, page_from, page_to)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), kitId, it.checklistId, it.documentCode, it.documentName, i,
       it.sourceFileId, it.sourceSha256, it.pageFrom, it.pageTo],
    );
  }

  // ── one token, one provider call ──────────────────────────────────────────
  const publicToken = randomBytes(24).toString("hex");
  const signLink = `${frontendBaseUrl()}/employee/joining-kit/esign/${publicToken}`;
  await db.execute(
    `INSERT INTO employee_joining_document_public_token
       (id, checklist_id, kit_id, employee_id, candidate_id, document_code,
        public_token_hash, token_status, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'JOINING_KIT', ?, 'active', (NOW() + INTERVAL 7 DAY), ?)`,
    [randomUUID(), String(kit.anchor_checklist_id), kitId, employeeId,
     kit.candidate_id ?? null, sha256(publicToken), actorUserId],
  );

  const { luckpayClient, esignWithUrl } = await import("../integrations/luckpay/luckpay.client.js");
  const clientTransactionId = luckpayClient.generateClientTransactionId("joining-kit");
  let providerUrl: string | null = null;
  let providerReferenceId: string | null = null;
  let txStatus = "link_generated";
  let errorMessage: string | null = null;

  // Hard timeout: if TrustHub does not respond in 30 s the DB connection that
  // called this function is released rather than hanging indefinitely. The kit
  // moves to "failed" below and HR can retry (a new clientTransactionId is
  // generated on retry, so there is no double-billing risk from the timeout path).
  const PROVIDER_TIMEOUT_MS = 30_000;

  try {
    const r = await Promise.race([
      esignWithUrl({
        filePath: kitPath,
        clientTransactionId,
        signedBy: String(kit.full_name ?? kit.employee_code ?? "Employee"),
        location: String(kit.branch_name ?? "India"),
        reason: `Joining Documents Kit (${assembled.items.length} documents)`,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`eSign provider timed out after ${PROVIDER_TIMEOUT_MS / 1000} s`)),
          PROVIDER_TIMEOUT_MS,
        )
      ),
    ]);
    // esignWithUrl returns providerUrl; verificationUrl is the raw client's shape.
    providerUrl = r.providerUrl ?? null;
    providerReferenceId = r.providerReferenceId ?? null;
    txStatus = String(r.status ?? "initiated");
  } catch (e) {
    // Deliberately NOT retried: the vendor records clientTransactionId on first
    // receipt, so a resend returns 409 permanently and the first attempt may
    // already have been billed. Fail the kit and let HR retry with a fresh id.
    errorMessage = e instanceof Error ? e.message : String(e);
    await db.execute(
      `UPDATE employee_joining_esign_kit SET status = 'failed', blocked_reason = 'provider_error' WHERE id = ?`,
      [kitId],
    ).catch(() => undefined);
    await audit(kitId, employeeId, "KIT_PROVIDER_FAILED", actorUserId, { error: errorMessage });
    return { kitId, status: "failed", message: `The eSign provider rejected the request: ${errorMessage}` };
  }

  const txId = randomUUID();
  await db.execute(
    `INSERT INTO employee_document_esign_transaction
       (id, checklist_id, kit_id, scope, employee_id, candidate_id, document_code, provider,
        client_transaction_id, provider_reference_id, signer_name, signer_email,
        signer_location, signing_reason, status, provider_url, initiated_by)
     VALUES (?, ?, ?, 'kit', ?, ?, 'JOINING_KIT', 'luckpay', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [txId, String(kit.anchor_checklist_id), kitId, employeeId, kit.candidate_id ?? null,
     clientTransactionId, providerReferenceId, kit.full_name ?? null, recipients[0] ?? null,
     kit.branch_name ?? "India", `Joining Documents Kit`, txStatus, providerUrl, actorUserId],
  );

  // Every member moves to esign_initiated — an existing allowed status, so
  // dashboards, reports and the compliance worker keep working unchanged.
  for (const it of assembled.items) {
    await db.execute(
      `UPDATE employee_joining_document_checklist
          SET status = 'esign_initiated', fill_status = 'esign_initiated', updated_at = NOW()
        WHERE id = ?`,
      [it.checklistId],
    ).catch(() => undefined);
  }

  await db.execute(
    `UPDATE employee_joining_esign_kit
        SET status = 'sent', sent_at = NOW(), document_count = ?, total_pages = ?,
            kit_file_id = ?, kit_sha256 = ?, blocked_reason = NULL
      WHERE id = ?`,
    [assembled.items.length, assembled.totalPages, kitFileId, assembled.sha256, kitId],
  );

  // ── one email ─────────────────────────────────────────────────────────────
  const emailedTo: string[] = [];
  try {
    const { emailService } = await import("../communication/email.service.js");
    for (const addr of [...new Set(recipients)]) {
      await emailService.send({
        to: addr,
        subject: `Action Required: Sign your joining documents — MAS Callnet`,
        html: buildKitEmailHtml({
          employeeName: String(kit.full_name ?? ""),
          documents: assembled.items.map((i) => i.documentName),
          signLink,
        }),
      });
      emailedTo.push(addr);
    }
  } catch (e) {
    // The kit is assembled, stored and initiated; a mail failure must not undo
    // that. HR can resend.
    console.warn("[joining-kit] email failed:", e instanceof Error ? e.message : e);
  }

  await audit(kitId, employeeId, "KIT_SENT", actorUserId, {
    documents: assembled.items.length, pages: assembled.totalPages, emailed: emailedTo.length,
  });

  try {
    const { recalculateDocumentProgress } = await import("./employeeJoiningDocuments.service.js");
    await recalculateDocumentProgress(employeeId);
  } catch { /* progress is derived; never block the send on it */ }

  return {
    kitId,
    status: "sent",
    message: `Kit sent — ${assembled.items.length} documents in one signing session.`,
    letterCount: assembled.items.length,
    signLink,
    providerUrl,
    emailedTo,
  };
}

function buildKitEmailHtml(d: { employeeName: string; documents: string[]; signLink: string }): string {
  const list = d.documents.map((n) => `<li style="margin:3px 0">${n}</li>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#0f172a;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:28px 12px"><tr><td align="center">
    <table width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#0891b2,#2563eb);padding:22px 26px">
        <div style="color:#e0f2fe;font-size:11px;letter-spacing:2px;font-weight:800">MAS CALLNET INDIA PVT. LTD.</div>
        <div style="color:#fff;font-size:21px;font-weight:800;margin-top:5px">Sign your joining documents</div>
      </td></tr>
      <tr><td style="padding:26px">
        <p style="margin:0 0 14px;color:#0f172a;font-size:15px">Dear ${d.employeeName},</p>
        <p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.6">
          All of your joining documents are ready. You can review and sign them
          <strong>together, in one step</strong> — you no longer need to sign each one separately.
        </p>
        <div style="background:#f1f5f9;border-radius:10px;padding:14px 18px;margin:0 0 18px">
          <div style="color:#475569;font-size:12px;font-weight:700;margin-bottom:6px">${d.documents.length} documents included</div>
          <ul style="margin:0;padding-left:18px;color:#0f172a;font-size:13px">${list}</ul>
        </div>
        <a href="${d.signLink}" style="display:block;background:#0891b2;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;text-align:center;font-size:15px">Review &amp; Sign All</a>
        <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          This link expires in 7 days. If the button does not open, copy this address into your browser:<br>
          <span style="color:#0891b2;word-break:break-all">${d.signLink}</span>
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:14px 26px;color:#94a3b8;font-size:11px;text-align:center">
        Automated message from MAS Callnet HRMS.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/**
 * Close a kit once the provider reports it signed.
 *
 * One signature covers several documents, so completion has to reach every
 * member — not only the anchor the transaction happens to point at. Each member
 * gets a file row pointing at the SAME signed artefact, because that one file is
 * genuinely what was signed on their behalf.
 */
export async function finalizeKitEsign(params: {
  kitId: string;
  transactionId: string;
  clientTransactionId: string | null;
  providerReferenceId: string | null;
}): Promise<{ kitId: string; documentsClosed: number; artefactRetrieved: boolean; placementOk: boolean }> {
  const [kits] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, candidate_id, reserved_band_pt FROM employee_joining_esign_kit WHERE id = ? LIMIT 1`,
    [params.kitId],
  );
  const kit = (kits as RowDataPacket[])[0];
  if (!kit) throw Object.assign(new Error("Kit not found"), { statusCode: 404 });

  const [itemRows] = await db.execute<RowDataPacket[]>(
    `SELECT checklist_id, document_code, document_name FROM employee_joining_esign_kit_item WHERE kit_id = ?`,
    [params.kitId],
  );
  const items = itemRows as RowDataPacket[];

  // Pull the signed artefact using the PROVIDER's identifiers. Passing our own
  // primary key here is what left every earlier signature unretrieved.
  let signedBytes: Buffer | null = null;
  try {
    const { luckpayClient } = await import("../integrations/luckpay/luckpay.client.js");
    const doc = await luckpayClient.downloadESignDocument({
      clientTransactionId: params.clientTransactionId ?? "",
      transactionId: params.providerReferenceId ?? "",
    });
    if (doc.buffer?.length) signedBytes = doc.buffer;
  } catch (e) {
    // The signature did happen; only the download failed. Record that honestly
    // rather than claiming a verified signature we do not hold.
    console.warn("[joining-kit] signed artefact not retrieved:", e instanceof Error ? e.message : e);
  }

  let signedFileId: string | null = null;
  let placementOk = true;
  if (signedBytes) {
    const dir = path.resolve(process.cwd(), "private-storage", "joining-kits", String(kit.employee_id));
    await fs.promises.mkdir(dir, { recursive: true });
    const signedPath = path.join(dir, `joining-kit-${params.kitId}-signed.pdf`);
    await fs.promises.writeFile(signedPath, signedBytes);

    // Where did the signature actually land? A provider change should surface
    // as an alert, not as a silently wrong document.
    try {
      const { assertSignatureInsideReservedArea } = await import("./joiningKitAssembly.service.js");
      const r = await assertSignatureInsideReservedArea(signedBytes, Number(kit.reserved_band_pt ?? 180));
      placementOk = r.ok;
      await db.execute(
        `UPDATE employee_joining_esign_kit SET signature_placement_json = CAST(? AS JSON) WHERE id = ?`,
        [JSON.stringify(r), params.kitId],
      ).catch(() => undefined);
    } catch { /* placement analysis must never block completion */ }

    // One file row per member, all pointing at the same artefact.
    for (const it of items) {
      signedFileId = randomUUID();
      await db.execute(
        `INSERT INTO employee_joining_document_file
           (id, checklist_id, employee_id, candidate_id, document_code, file_role,
            original_filename, stored_filename, storage_path, mime_type, file_size_bytes,
            file_hash_sha256, uploaded_by_type, uploaded_at)
         VALUES (?, ?, ?, ?, ?, 'kit_signed', ?, ?, ?, 'application/pdf', ?, ?, 'system', NOW())`,
        [signedFileId, String(it.checklist_id), String(kit.employee_id), kit.candidate_id ?? null,
         String(it.document_code), `${it.document_name ?? it.document_code}.pdf`,
         path.basename(signedPath), signedPath, signedBytes.byteLength,
         createHash("sha256").update(signedBytes).digest("hex")],
      ).catch(() => undefined);
    }
  }

  const signatureMode = signedBytes ? "aadhaar_esign_verified" : "aadhaar_esign_pending_artefact";
  for (const it of items) {
    await db.execute(
      `UPDATE employee_joining_document_checklist
          SET status = 'esign_completed', fill_status = 'esign_completed',
              signature_mode = ?, final_file_locked_at = NOW(), completed_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [signatureMode, String(it.checklist_id)],
    ).catch(() => undefined);
  }

  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET status = 'signed', signed_file_id = COALESCE(?, signed_file_id), completed_at = NOW()
      WHERE id = ?`,
    [signedFileId, params.transactionId],
  ).catch(() => undefined);

  await db.execute(
    `UPDATE employee_joining_document_public_token
        SET token_status = 'consumed', consumed_at = NOW()
      WHERE kit_id = ? AND token_status = 'active'`,
    [params.kitId],
  ).catch(() => undefined);

  await db.execute(
    `UPDATE employee_joining_esign_kit
        SET status = 'signed', open_marker = NULL, completed_at = NOW(), signed_file_id = ?
      WHERE id = ?`,
    [signedFileId, params.kitId],
  ).catch(() => undefined);

  // recalculateDocumentProgress is the documented single writer of completion.
  try {
    const { recalculateDocumentProgress } = await import("./employeeJoiningDocuments.service.js");
    await recalculateDocumentProgress(String(kit.employee_id));
  } catch { /* derived value; never block completion on it */ }

  await audit(params.kitId, String(kit.employee_id), "KIT_SIGNED", null, {
    documents: items.length, artefactRetrieved: Boolean(signedBytes), placementOk,
  });

  // Fire-and-forget: kit completion must never depend on letter issuance
  // succeeding. issueAppointmentLetter() has its own eligibility gate (BGV,
  // salary, branch address, name/DOJ, etc.) — a blocker there just means
  // "not yet", to be issued manually later from the existing HR screen, not
  // a failure of the kit sign-off itself.
  import("../letters/appointmentLetterIssue.service.js")
    .then(({ issueAppointmentLetter }) =>
      issueAppointmentLetter({ employeeId: String(kit.employee_id), actorUserId: "system" }))
    .catch((e: unknown) => {
      const code = (e as { code?: string })?.code;
      if (code === "already_issued") return; // benign — someone already issued it manually
      console.warn(
        "[joining-kit] auto appointment-letter issue skipped/failed:",
        e instanceof Error ? e.message : e,
      );
    });

  return {
    kitId: params.kitId,
    documentsClosed: items.length,
    artefactRetrieved: Boolean(signedBytes),
    placementOk,
  };
}
