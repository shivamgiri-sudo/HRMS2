import { Router, type NextFunction, type Request, type Response } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { ZipArchive } from "archiver";
import type { Archiver as ArchiverInstance } from "archiver";
import { resolveOnboardingDocumentFile } from "../ats/onboardingDocumentPath.js";

/**
 * archiver 8 removed the callable factory.
 *
 * This module used `archiver('zip', opts)` through a CJS-interop shim:
 *
 *   const archiverLib = (ns.default ?? ns) as (format, options) => Archiver
 *
 * archiver 8.0.0 (installed) exports only classes — Archiver, ZipArchive,
 * TarArchive, JsonArchive — and no `default`. So the shim resolved to the
 * namespace OBJECT and calling it threw "archiverLib is not a function" at the
 * first line of every download. The cast is why it type-checked: it asserted a
 * call signature the module has not had since the upgrade.
 *
 * Verified against the installed package before changing it: `new
 * ZipArchive({...})` yields the same instance API this code already uses —
 * pipe, file, append, finalize.
 *
 * The identical shim is still in ats.joiningDocumentsTracker.service.ts and
 * fails the same way; flagged separately rather than fixed blind from here.
 */
function newZipArchive(): ArchiverInstance {
  return new ZipArchive({ zlib: { level: 9 } }) as unknown as ArchiverInstance;
}

const UPLOADS_ROOT = path.resolve(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  "../../../../uploads"
);

export const esiRegDocsRouter = Router();
esiRegDocsRouter.use(requireAuth);

/**
 * Async error boundary.
 *
 * Every route here was a bare `async` handler. Express 4 does not catch a
 * rejected promise from one, so it became an unhandled rejection and Node 24
 * exits the process on those — which is exactly what happened twice while
 * testing this file: one bad SQL bind and one bad archiver call each took the
 * ENTIRE backend down, not just the request. Wrapping them turns a
 * whole-service outage into a 500 on one endpoint.
 *
 * `next(err)` rather than a local response, so the existing error handler still
 * decides the body — except once the archive has begun streaming, when the
 * headers are already sent and the only honest move is to destroy the socket so
 * the client sees a truncated download instead of a valid-looking short zip.
 */
type AsyncRoute = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: AsyncRoute) => (req: Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch((err: unknown) => {
    if (res.headersSent) {
      console.error("[esi-reg-docs] failed mid-stream:", err instanceof Error ? err.message : err);
      return res.destroy();
    }
    return next(err);
  });
};

/**
 * Who may pull ESI registration packs.
 *
 * `payroll_hr` was missing and `payroll_branch` does not exist. Checked live
 * 2026-09-08: user_roles carries payroll, payroll_admin, payroll_head and
 * payroll_hr — there is no payroll_branch row anywhere, so of the three names
 * above only payroll_head (2 holders) and super_admin (6) ever worked.
 *
 * Payroll HR is the role that actually does ESI registration, and it was locked
 * out of every endpoint here. A previous session found the resulting 403s and
 * hid the tab from payroll_hr rather than granting it, which turned a broken
 * control into an invisible one. The owner confirmed on 2026-09-08 that Payroll
 * HR and the Payroll Head are exactly the two who need this, so payroll_hr is
 * granted here and the tab is shown to it again.
 *
 * payroll_branch is kept: it costs nothing while unheld, and dropping a name
 * another session may be provisioning towards would be a silent revocation.
 *
 * `payroll` IS the grant that reaches Payroll HR, and naming payroll_hr alone
 * does nothing. Proven live 2026-09-08 with a real token for sheelu.verma, who
 * holds payroll_hr in both user_roles and user_assignment_scope: the request was
 * refused, and requireRole logged her roles as [employee, hr, payroll,
 * recruiter] — no payroll_hr at all.
 *
 * The cause is DASHBOARD_ROLE_ALIASES in shared/dashboardAccessRegistry.ts,
 * which maps `payroll_hr -> payroll`. getUserRoleKeys() puts every resolved role
 * through it, so a payroll_hr user reaches requireRole already rewritten to
 * `payroll`, and a route listing "payroll_hr" can never match one. That alias
 * makes payroll_hr and payroll the same principal to every RBAC check in the
 * system, so granting `payroll` here is not a widening decision this route gets
 * to make differently — the two cannot be separated without changing the alias,
 * which is a system-wide RBAC change and deliberately not made here.
 *
 * payroll_hr is kept in the list even though it is unreachable today: it is what
 * this route MEANS, and it starts working by itself if the alias is ever removed.
 *
 * NOTE: appointmentLetter.routes.ts carries the opposite claim — "payroll_hr has
 * no alias in the role model ... requireRole('payroll') does NOT admit a
 * payroll_hr user". That is backwards, and its ISSUE_ROLES has the same hole.
 */
const ESI_ROLES = ["payroll", "payroll_hr", "payroll_branch", "payroll_head", "super_admin"] as const;

esiRegDocsRouter.get(
  "/esi-reg-docs",
  requireRole(...ESI_ROLES),
  h(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = parseInt(String(req.query.limit ?? "50"), 10);
    if (limit > 200) {
      return res.status(400).json({ error: "Maximum limit is 200" });
    }
    const offset = (page - 1) * limit;
    const branchId = req.query.branch_id as string | undefined;
    const search = req.query.search as string | undefined;

    /**
     * LIMIT/OFFSET are interpolated, not bound.
     *
     * This endpoint had never returned a row: `LIMIT ? OFFSET ?` through
     * db.execute() is a PREPARED statement, and MySQL will not accept a bound
     * parameter in those positions — it answers ER_WRONG_ARGUMENTS (errno 1210,
     * "Incorrect arguments to mysqld_stmt_execute"). The route has no error
     * wrapper, so the rejection went unhandled and took the whole backend
     * process down with it, not merely this request.
     *
     * It went unnoticed because the role list separately locked out everyone who
     * would have called it. Two bugs, each hiding the other.
     *
     * Interpolation is safe here only because both values are coerced to bounded
     * integers first and can never carry user text: limit is already rejected
     * above if > 200, page is Math.max(1, parseInt(...)). Number.isFinite guards
     * the NaN that parseInt("abc") returns, which would otherwise interpolate
     * the literal text NaN into the SQL.
     */
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

    // active_status = 1 is the load-bearing one. Without it this listed every
    // employee who ever held an ESI flag, terminated or not: 12,858 rows live on
    // 2026-09-08 against 567 who are actually on the payroll. An ESI
    // REGISTRATION queue made mostly of people who left is not a long list, it
    // is the wrong list — and the bulk download would have built document packs
    // for them.
    //
    // The population itself was inverted (found 2026-09-12): this is meant to be
    // "ESI-eligible employees who are NOT YET registered", i.e. who still need
    // registration. The condition instead read `esic_number IS NOT NULL OR
    // esi_eligible = 1`, which is "already has a number OR is flagged eligible" —
    // an OR that ADMITS anyone with a number, rather than a check that EXCLUDES
    // them. That is the opposite population: it mixed people who already have an
    // ESIC number in with people who don't, so "not registered" was never
    // isolated from "already registered" on this screen.
    //
    // Fixed to AND NOT registered: eligible per the HRMS-native flag (never a
    // wage-threshold guess — same doctrine as statutory-applicability.service.ts,
    // eligibility is a fact to be told, not inferred) AND no ESIC number on file
    // yet, checked against BOTH places a number can live. `employees.esic_number`
    // is the field this route reads for display, but a number can also be
    // recorded on `employee_statutory_info.esi_number` (see COALESCE usage in
    // reporting/executors/employee.executor.ts line 628) without ever being
    // backfilled onto `employees`. Checking only `esic_number` would have shown
    // some already-registered employees as "not registered" too.
    const whereParts: string[] = [
      `e.active_status = 1`,
      `esi.esi_eligible = 1`,
      `COALESCE(NULLIF(e.esic_number, ''), NULLIF(esi.esi_number, '')) IS NULL`,
      `e.employment_status != 'terminated'`,
    ];
    const params: unknown[] = [];

    if (branchId) {
      whereParts.push("e.branch_id = ?");
      params.push(branchId);
    }
    if (search) {
      whereParts.push("(e.employee_code LIKE ? OR CONCAT(e.first_name,' ',e.last_name) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereParts.join(" AND ");

    const [[{ total }]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM employees e
       LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
       WHERE ${whereClause}`,
      params
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id                                              AS employee_id,
         e.employee_code,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS name,
         COALESCE(b.branch_name, '')                       AS branch,
         e.esic_number,
         (SELECT COUNT(*) FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan') > 0
                                                          AS pan_ready,
         (SELECT id FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan'
          ORDER BY ed.created_at DESC LIMIT 1)            AS pan_doc_id,
         (SELECT file_url FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan'
          ORDER BY ed.created_at DESC LIMIT 1)            AS pan_file_url,
         (e.photo_url IS NOT NULL OR e.avatar_url IS NOT NULL) AS photo_ready,
         COALESCE(e.photo_url, e.avatar_url)              AS photo_url,
         (SELECT COUNT(*) FROM employee_bank_detail ebd
          WHERE ebd.employee_id = e.id
            AND ebd.ifsc_code IS NOT NULL AND ebd.ifsc_code != '') > 0
                                                          AS bank_ready
       FROM employees e
       LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       WHERE ${whereClause}
       ORDER BY e.employee_code
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    const employees = (rows as RowDataPacket[]).map((r) => ({
      ...r,
      pan_ready: !!r.pan_ready,
      photo_ready: !!r.photo_ready,
      bank_ready: !!r.bank_ready,
    }));

    return res.json({ employees, total: Number(total), page, limit });
  })
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * This used to be `generateBankInfoPdf` — the only document this route always
 * generates, and it only ever carried bank fields (name, ESIC number, masked
 * account). That is not an ESI registration document: ESIC's Declaration Form
 * needs DOB, gender, marital status, father's/husband's name, address, mobile
 * and nominee details too, and Payroll HR was getting a bank slip instead.
 *
 * Every field below already exists and is populated on `employees` — confirmed
 * live 2026-09-10 via schema-snapshot.json — this was a wiring gap, not a data
 * gap. Bank details still come from `employee_bank_detail` (the same source
 * the rest of this file uses), joined against `employees` for everything else
 * in one query rather than two.
 */
async function generateEsiDeclarationPdf(employeeId: string): Promise<Buffer> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.employee_code, e.esic_number, e.uan_number, e.epf_number,
       e.pan_number, e.aadhaar_number,
       CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS name,
       e.father_name, e.gender, e.marital_status, e.date_of_birth,
       COALESCE(e.mobile, e.personal_phone)               AS mobile,
       e.nominee_name, e.nominee_relation,
       COALESCE(e.address1, e.address_line1)               AS address1,
       COALESCE(e.address2, e.address_line2)               AS address2,
       e.city, e.state, e.pincode,
       ebd.bank_name, ebd.account_number, ebd.ifsc_code, ebd.account_type
     FROM employees e
     LEFT JOIN employee_bank_detail ebd
       ON ebd.employee_id = e.id
      AND ebd.id = (SELECT id FROM employee_bank_detail
                     WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1)
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId]
  );
  const row = (rows as RowDataPacket[])[0];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).font("Helvetica-Bold").text("ESI Registration — Declaration Form", { align: "center" });
    doc.moveDown();

    if (!row) {
      doc.fontSize(12).font("Helvetica").text("Employee record not found.");
      doc.end();
      return;
    }

    const mask = (acct: string | null) => (acct ? `****${acct.slice(-4)}` : "Not provided");
    const fmtDate = (d: unknown) => {
      if (!d) return "Not provided";
      const parsed = new Date(d as string);
      return Number.isNaN(parsed.getTime()) ? "Not provided" : parsed.toLocaleDateString("en-IN");
    };
    const val = (v: unknown) => (v === null || v === undefined || v === "" ? "Not provided" : String(v));
    const address = [row.address1, row.address2, row.city, row.state, row.pincode]
      .filter((p) => p !== null && p !== undefined && p !== "")
      .join(", ");

    const section = (title: string) => {
      doc.moveDown(0.5);
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#333").text(title);
      doc.fillColor("#000");
      doc.moveDown(0.2);
    };
    const field = (label: string, value: string) => {
      doc.fontSize(11).font("Helvetica-Bold").text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(value);
    };

    section("Employee Identity");
    field("Employee Code", val(row.employee_code));
    field("Employee Name", val(row.name));
    field("Father's / Husband's Name", val(row.father_name));
    field("Date of Birth", fmtDate(row.date_of_birth));
    field("Gender", val(row.gender));
    field("Marital Status", val(row.marital_status));
    field("Mobile Number", val(row.mobile));

    section("Statutory Identifiers");
    field("ESIC Number", val(row.esic_number ?? "Not assigned"));
    field("UAN Number", val(row.uan_number));
    field("EPF Number", val(row.epf_number));
    field("PAN Number", val(row.pan_number));
    field("Aadhaar Number", val(row.aadhaar_number));

    section("Address");
    field("Residential Address", address || "Not provided");

    section("Nominee Details");
    field("Nominee Name", val(row.nominee_name));
    field("Relation with Employee", val(row.nominee_relation));

    section("Bank Details (for ESI benefit disbursal)");
    field("Bank Name", val(row.bank_name));
    field("Account Number (Masked)", mask(row.account_number ?? null));
    field("IFSC Code", val(row.ifsc_code));
    field("Account Type", val(row.account_type));

    doc.end();
  });
}

function urlToLocalPath(fileUrl: string | null): string | null {
  if (!fileUrl) return null;
  const match = fileUrl.match(/\/api\/files\/(employee-documents|employee-photos)\/(.+)$/);
  if (!match) return null;
  return path.join(UPLOADS_ROOT, match[1], match[2]);
}

function fileExists(filePath: string | null): boolean {
  if (!filePath) return false;
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

/**
 * Build one employee's ESI registration pack into `archive`, under `prefix`.
 *
 * Single and bulk download used to carry two copies of this, which is how they
 * came to disagree: neither included the Aadhaar, but only the CSV export
 * noticed that ESI registration needs it. One builder means a document added
 * here appears in both, and the manifest can never describe a different set of
 * files from the one actually written.
 *
 * Every document is optional by design. A missing file is recorded in the
 * manifest as a named gap rather than failing the download — Payroll HR needs
 * the pack for the documents that DO exist, plus a list of what to chase.
 *
 * Returns the manifest lines so the caller can also count what was found.
 */
async function appendEsiPack(
  archive: ArchiverInstance,
  emp: { id: string; employee_code: string; name: string; photo_url?: string | null; avatar_url?: string | null },
  prefix: string,
): Promise<{ manifest: string[]; found: number; missing: number }> {
  const at = (n: string) => (prefix ? `${prefix}/${n}` : n);
  const manifest: string[] = [`ESI Registration Documents — ${emp.name} (${emp.employee_code})\n`];
  let found = 0, missing = 0;

  // doc_category is the stable axis here, not doc_type: identity holds 27,165
  // rows as 'POI' plus a handful of 'POI_1'/'POI_4', and a separate 'aadhaar'
  // category holds 2. Matching the category catches all of them.
  //
  // In practice this NEVER resolves for the ESI-eligible population: verified
  // live 2026-09-08, zero of 436 employee_documents rows in that scope carry an
  // /api/files/... URL this can read — 434 are `legacy://document_master/...`
  // markers left by a one-way db_bill import that copied the ROW but never the
  // file bytes (backend/src/modules/migration/migrateDocumentsFromLegacy.ts),
  // and 2 point at a different server's absolute filesystem path. It stays
  // first in the chain because it is the correct source for anything uploaded
  // through THIS app's own document flow, present or future.
  const byCategory = async (category: string): Promise<string | null> => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT file_url FROM employee_documents
        WHERE employee_id = ? AND doc_category = ?
        ORDER BY created_at DESC LIMIT 1`,
      [emp.id, category],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    return urlToLocalPath((rows as RowDataPacket[])[0]?.file_url ?? null);
  };

  /**
   * PAN/Aadhaar, sourced from the candidate's OWN onboarding upload.
   *
   * This is what actually resolves. Before a candidate becomes an employee,
   * they upload PAN/Aadhaar through the ATS onboarding flow into
   * `candidate_onboarding_document`, whose `file_path` is a real absolute path
   * under `private-storage/onboarding-documents/` on THIS server — verified
   * live: 1,699 real files on disk, resolvable via the same
   * `resolveOnboardingDocumentFile()` the candidate-document viewer already
   * uses (it also survives the Windows-dev-path / cwd-mismatch cases recorded
   * there). Checked live 2026-09-08: 38 of 567 ESI-eligible employees have a
   * real PAN or Aadhaar here — zero via employee_documents.
   *
   * `doc_type` is free text with several live spellings per document
   * (`pan`/`PAN Card`/`pan_card`, `Aadhaar`/`aadhaar_card`/`aadhar`), so this
   * matches on a normalised set rather than one literal string.
   */
  const fromCandidateOnboarding = async (types: string[]): Promise<string | null> => {
    const placeholders = types.map(() => "?").join(",");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT d.file_path
         FROM candidate_onboarding_document d
         JOIN ats_onboarding_bridge ab ON ab.candidate_id = d.candidate_id
        WHERE ab.employee_id = ? AND d.deleted_at IS NULL AND LOWER(d.doc_type) IN (${placeholders})
        ORDER BY d.uploaded_at DESC LIMIT 1`,
      [emp.id, ...types],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]);
    return resolveOnboardingDocumentFile((rows as RowDataPacket[])[0]?.file_path ?? null);
  };

  const docs: Array<{ label: string; localPath: string | null; note: string }> = [
    {
      label: "PAN_Card",
      localPath: (await byCategory("pan")) ?? (await fromCandidateOnboarding(["pan", "pan card", "pan_card"])),
      note: "PAN document not available — upload it on the employee profile",
    },
    // Aadhaar is mandatory for ESI registration and was in no version of this
    // pack, though the CSV export has carried the aadhaar NUMBER since
    // 2026-09-02. A number without the scan does not complete a registration.
    {
      label: "Aadhaar",
      localPath:
        (await byCategory("aadhaar")) ??
        (await byCategory("identity")) ??
        (await fromCandidateOnboarding(["aadhaar", "aadhaar_card", "aadhar"])),
      note: "Aadhaar / identity proof not available",
    },
    { label: "Photo", localPath: urlToLocalPath(emp.photo_url ?? emp.avatar_url ?? null), note: "Employee photo not available" },
  ];

  for (const d of docs) {
    if (fileExists(d.localPath)) {
      archive.file(d.localPath!, { name: at(`${d.label}${path.extname(d.localPath!)}`) });
      manifest.push(`OK  ${d.label}${path.extname(d.localPath!)}`);
      found++;
    } else {
      manifest.push(`--  ${d.note}`);
      missing++;
    }
  }

  // Always generated rather than fetched, so it exists even when nothing was
  // uploaded — which for most of this population is the only content the pack
  // would otherwise have. Carries the actual ESI Declaration Form fields (DOB,
  // gender, marital status, father's/husband's name, address, mobile, nominee),
  // not just bank details — see generateEsiDeclarationPdf().
  try {
    archive.append(await generateEsiDeclarationPdf(emp.id), { name: at("ESI_Declaration_Form.pdf") });
    manifest.push("OK  ESI_Declaration_Form.pdf");
    found++;
  } catch {
    manifest.push("--  ESI Declaration Form could not be generated");
    missing++;
  }

  manifest.push(`\n${found} document(s) included, ${missing} missing.`);
  archive.append(manifest.join("\n"), { name: at("manifest.txt") });
  return { manifest, found, missing };
}

async function writeAuditLog(
  action: string,
  performedBy: string,
  targetEmployeeId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at)
       VALUES (UUID(), ?, ?, 'payroll', 'esi_registration', ?, ?, NOW())`,
      [performedBy, action, targetEmployeeId, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[esi-reg-docs] audit log failed", err);
  }
}

// ── Route: ZIP download ───────────────────────────────────────────────────────

esiRegDocsRouter.get(
  "/esi-reg-docs/:employeeId/download",
  requireRole(...ESI_ROLES),
  h(async (req: Request, res: Response) => {
    const { employeeId } = req.params;
    const actorId = (req as any).authUser?.id ?? "unknown";

    const [[empRow]] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name,
              esic_number, photo_url, avatar_url
       FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (!empRow) return res.status(404).json({ error: "Employee not found" });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `ESI_Docs_${empRow.employee_code}_${date}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const archive = newZipArchive();
    archive.pipe(res);
    archive.on("error", (err: Error) => console.error("[esi-reg-docs] archive error", err));

    const packed = await appendEsiPack(
      archive,
      {
        id: employeeId,
        employee_code: String(empRow.employee_code ?? ""),
        name: String(empRow.name ?? ""),
        photo_url: empRow.photo_url,
        avatar_url: empRow.avatar_url,
      },
      "",
    );

    await archive.finalize();

    await writeAuditLog("esi_reg_doc_download", actorId, employeeId, {
      employee_code: empRow.employee_code,
      documents_included: packed.found,
      documents_missing: packed.missing,
    });
  })
);

// ── Route: Bulk ZIP download ──────────────────────────────────────────────────

esiRegDocsRouter.post(
  "/esi-reg-docs/bulk-download",
  requireRole(...ESI_ROLES),
  h(async (req: Request, res: Response) => {
    const { employee_ids } = req.body as { employee_ids?: string[] };
    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ error: "employee_ids must be a non-empty array" });
    }
    if (employee_ids.length > 200) {
      return res.status(400).json({ error: "Maximum 200 employees per bulk download" });
    }
    const actorId = (req as any).authUser?.id ?? "unknown";
    const date = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="ESI_Bulk_Docs_${date}.zip"`);

    const archive = newZipArchive();
    archive.pipe(res);
    archive.on("error", (err: Error) => console.error("[esi-reg-docs] bulk archive error", err));

    const placeholders = employee_ids.map(() => "?").join(",");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name,
              esic_number, photo_url, avatar_url
       FROM employees WHERE id IN (${placeholders})`,
      employee_ids
    );

    // One folder per employee inside the single zip, so Payroll HR opens the
    // archive and finds a ready-made folder per registration rather than a flat
    // pile of files they have to sort by filename.
    const index: string[] = ["Employee Code,Employee Name,Documents Included,Documents Missing"];
    for (const emp of rows as RowDataPacket[]) {
      // Sanitised, because an employee name reaches a zip ENTRY PATH here: a
      // name carrying "/" or ".." would place the file outside its own folder.
      const safeName = String(emp.name ?? "").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "_");
      const safeCode = String(emp.employee_code ?? "").replace(/[^A-Za-z0-9_-]/g, "");
      const packed = await appendEsiPack(
        archive,
        {
          id: String(emp.id),
          employee_code: String(emp.employee_code ?? ""),
          name: String(emp.name ?? ""),
          photo_url: emp.photo_url,
          avatar_url: emp.avatar_url,
        },
        `${safeCode}_${safeName}`,
      );
      index.push(`${emp.employee_code},"${String(emp.name ?? "").replace(/"/g, '""')}",${packed.found},${packed.missing}`);
    }

    // A top-level index, so a 200-employee archive can be checked without
    // opening 200 manifests to find which packs are short of a document.
    archive.append(index.join("\n"), { name: "INDEX.csv" });

    await archive.finalize();

    await writeAuditLog("esi_bulk_doc_download", actorId, null, {
      employee_ids,
      count: employee_ids.length,
    });
  })
);

// ── Route: CSV export ─────────────────────────────────────────────────────────

esiRegDocsRouter.get(
  "/esi-reg-docs/export-csv",
  requireRole(...ESI_ROLES),
  h(async (req: Request, res: Response) => {
    const actorId = (req as any).authUser?.id ?? "unknown";
    const branchId = req.query.branch_id as string | undefined;

    // Same scope as the list above, deliberately — an export that disagrees with
    // the screen it was exported from is worse than no export. See the fix note
    // on the list query above: this must select eligible-but-not-yet-registered
    // employees, not the inverted "already has a number OR eligible" population.
    const whereParts = [
      `e.active_status = 1`,
      `esi.esi_eligible = 1`,
      `COALESCE(NULLIF(e.esic_number, ''), NULLIF(esi.esi_number, '')) IS NULL`,
      `e.employment_status != 'terminated'`,
    ];
    const params: unknown[] = [];
    if (branchId) {
      whereParts.push("e.branch_id = ?");
      params.push(branchId);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.employee_code,
         CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS name,
         COALESCE(b.branch_name, '')                       AS branch,
         e.esic_number,
         e.pan_number,
         -- ESI registration needs the Aadhaar as well as the PAN, and this export never
         -- carried it. employees.aadhaar_number is the populated source (1,050 of 1,116
         -- active); employee_statutory_info.aadhaar_id is the fallback for the rows that
         -- were written through the statutory path instead. Added 2026-09-02.
         COALESCE(NULLIF(e.aadhaar_number, ''), NULLIF(esi.aadhaar_id, '')) AS aadhaar_number,
         (SELECT ebd.bank_name FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id ORDER BY ebd.created_at DESC LIMIT 1) AS bank_name,
         (SELECT ebd.account_number FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id ORDER BY ebd.created_at DESC LIMIT 1) AS account_number,
         (SELECT ebd.ifsc_code FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id ORDER BY ebd.created_at DESC LIMIT 1) AS ifsc_code,
         (SELECT ebd.account_type FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id ORDER BY ebd.created_at DESC LIMIT 1) AS account_type,
         (SELECT COUNT(*) FROM employee_documents ed WHERE ed.employee_id = e.id AND ed.doc_category = 'pan') > 0 AS pan_ready,
         (e.photo_url IS NOT NULL OR e.avatar_url IS NOT NULL) AS photo_ready,
         (SELECT COUNT(*) FROM employee_bank_detail ebd WHERE ebd.employee_id = e.id AND ebd.ifsc_code IS NOT NULL) > 0 AS bank_ready
       FROM employees e
       LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       WHERE ${whereParts.join(" AND ")}
       ORDER BY e.employee_code`,
      params
    );

    const mask = (acct: string | null) => (acct ? `****${acct.slice(-4)}` : "");

    const header = "Emp Code,Name,Branch,ESIC Number,PAN Number,Aadhaar Number,Bank Name,Account Number (Masked),IFSC Code,Account Type,PAN Ready,Photo Ready,Bank Ready\n";
    const csvRows = (rows as RowDataPacket[])
      .map((r) =>
        [
          r.employee_code,
          `"${(r.name ?? "").replace(/"/g, '""')}"`,
          `"${(r.branch ?? "").replace(/"/g, '""')}"`,
          r.esic_number ?? "",
          r.pan_number ?? "",
          r.aadhaar_number ?? "",
          `"${(r.bank_name ?? "").replace(/"/g, '""')}"`,
          mask(r.account_number ?? null),
          r.ifsc_code ?? "",
          r.account_type ?? "",
          r.pan_ready ? "Yes" : "No",
          r.photo_ready ? "Yes" : "No",
          r.bank_ready ? "Yes" : "No",
        ].join(",")
      )
      .join("\n");

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ESI_Reg_${date}.csv"`);
    res.send("\uFEFF" + header + csvRows);

    await writeAuditLog("esi_reg_csv_export", actorId, null, { branch_id: branchId ?? "all" });
  })
);
