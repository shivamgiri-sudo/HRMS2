import { Router, Request, Response } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import * as _archiverNs from "archiver";
import type { ArchiverOptions, Archiver as ArchiverInstance } from "archiver";

const archiverLib = ((_archiverNs as unknown as { default?: unknown }).default ??
  _archiverNs) as (format: string, options?: ArchiverOptions) => ArchiverInstance;

const UPLOADS_ROOT = path.resolve(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  "../../../../uploads"
);

export const esiRegDocsRouter = Router();
esiRegDocsRouter.use(requireAuth);

const ESI_ROLES = ["payroll_branch", "payroll_head", "super_admin"] as const;

esiRegDocsRouter.get(
  "/esi-reg-docs",
  requireRole(...ESI_ROLES),
  async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = parseInt(String(req.query.limit ?? "50"), 10);
    if (limit > 200) {
      return res.status(400).json({ error: "Maximum limit is 200" });
    }
    const offset = (page - 1) * limit;
    const branchId = req.query.branch_id as string | undefined;
    const search = req.query.search as string | undefined;

    const whereParts: string[] = [
      `(e.esic_number IS NOT NULL OR esi.esi_eligible = 1)`,
      `e.employment_status != 'terminated'`,
    ];
    const params: unknown[] = [];

    if (branchId) {
      whereParts.push("e.branch_id = ?");
      params.push(branchId);
    }
    if (search) {
      whereParts.push("(e.emp_code LIKE ? OR CONCAT(e.first_name,' ',e.last_name) LIKE ?)");
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
         e.emp_code,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS name,
         COALESCE(b.name, e.branch, '')                   AS branch,
         e.esic_number,
         (SELECT COUNT(*) FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan'
            AND ed.document_status IN ('verified','uploaded','verification_pending')) > 0
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
       LEFT JOIN branches b ON b.id = e.branch_id
       WHERE ${whereClause}
       ORDER BY e.emp_code
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const employees = (rows as RowDataPacket[]).map((r) => ({
      ...r,
      pan_ready: !!r.pan_ready,
      photo_ready: !!r.photo_ready,
      bank_ready: !!r.bank_ready,
    }));

    return res.json({ employees, total: Number(total), page, limit });
  }
);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function generateBankInfoPdf(employeeId: string): Promise<Buffer> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ebd.bank_name, ebd.account_number, ebd.ifsc_code, ebd.account_type,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS name,
            e.emp_code, e.esic_number
     FROM employee_bank_detail ebd
     JOIN employees e ON e.id = ebd.employee_id
     WHERE ebd.employee_id = ?
     ORDER BY ebd.created_at DESC LIMIT 1`,
    [employeeId]
  );
  const row = (rows as RowDataPacket[])[0];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).font("Helvetica-Bold").text("ESI Registration — Bank Information", { align: "center" });
    doc.moveDown();

    if (!row) {
      doc.fontSize(12).font("Helvetica").text("Bank details not on record for this employee.");
    } else {
      const mask = (acct: string) => acct ? `****${acct.slice(-4)}` : "Not provided";
      doc.fontSize(12).font("Helvetica");
      const fields: [string, string][] = [
        ["Employee Code", row.emp_code ?? ""],
        ["Employee Name", row.name ?? ""],
        ["ESIC Number", row.esic_number ?? "Not assigned"],
        ["Bank Name", row.bank_name ?? ""],
        ["Account Number (Masked)", mask(row.account_number ?? "")],
        ["IFSC Code", row.ifsc_code ?? ""],
        ["Account Type", row.account_type ?? ""],
      ];
      for (const [label, value] of fields) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(value);
      }
    }
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

async function writeAuditLog(
  action: string,
  performedBy: string,
  targetEmployeeId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO payroll_audit_trail (id, action, performed_by, target_employee_id, details, created_at)
       VALUES (UUID(), ?, ?, ?, ?, NOW())`,
      [action, performedBy, targetEmployeeId, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[esi-reg-docs] audit log failed", err);
  }
}

// ── Route: ZIP download ───────────────────────────────────────────────────────

esiRegDocsRouter.get(
  "/esi-reg-docs/:employeeId/download",
  requireRole(...ESI_ROLES),
  async (req: Request, res: Response) => {
    const { employeeId } = req.params;
    const actorId = (req as any).authUser?.id ?? "unknown";

    const [[empRow]] = await db.execute<RowDataPacket[]>(
      `SELECT emp_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name,
              esic_number, photo_url, avatar_url
       FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (!empRow) return res.status(404).json({ error: "Employee not found" });

    const [[panDoc]] = await db.execute<RowDataPacket[]>(
      `SELECT file_url FROM employee_documents
       WHERE employee_id = ? AND doc_category = 'pan'
       ORDER BY created_at DESC LIMIT 1`,
      [employeeId]
    );

    const date = new Date().toISOString().slice(0, 10);
    const filename = `ESI_Docs_${empRow.emp_code}_${date}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const archive = archiverLib("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    archive.on("error", (err: Error) => console.error("[esi-reg-docs] archive error", err));

    const manifest: string[] = [`ESI Registration Documents — ${empRow.name} (${empRow.emp_code})\n`];

    const panPath = urlToLocalPath((panDoc as RowDataPacket | undefined)?.file_url ?? null);
    if (fileExists(panPath)) {
      const ext = path.extname(panPath!);
      archive.file(panPath!, { name: `PAN_Card${ext}` });
      manifest.push("✓ PAN_Card" + ext);
    } else {
      manifest.push("✗ PAN document not available — please upload in employee profile");
    }

    const photoPath = urlToLocalPath(empRow.photo_url ?? empRow.avatar_url ?? null);
    if (fileExists(photoPath)) {
      const ext = path.extname(photoPath!);
      archive.file(photoPath!, { name: `Photo${ext}` });
      manifest.push("✓ Photo" + ext);
    } else {
      manifest.push("✗ Employee photo not available");
    }

    try {
      const bankPdf = await generateBankInfoPdf(employeeId);
      archive.append(bankPdf, { name: "Bank_Information.pdf" });
      manifest.push("✓ Bank_Information.pdf");
    } catch {
      manifest.push("✗ Bank information could not be generated");
    }

    archive.append(manifest.join("\n"), { name: "manifest.txt" });
    await archive.finalize();

    await writeAuditLog("esi_reg_doc_download", actorId, employeeId, {
      emp_code: empRow.emp_code,
    });
  }
);
