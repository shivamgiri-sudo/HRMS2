import { Router } from "express";
import type { Response } from "express";
import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { blindIndexPan } from "../../shared/syncPiiEncryption.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { registerUpload } from "../document-vault/documentVault.service.js";
import {
  MAX_FORM16_BYTES, MAX_FORM16_FILES, OUTCOME_LABEL, extractPanFromFilename, form16DocName,
  isValidFinancialYear, looksLikePdf, summarise, type Form16Outcome,
} from "./form16-bulk.logic.js";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

// Memory storage: files are only written to disk after they have matched an employee, so a rejected
// batch leaves nothing behind. 50 files x 5 MB bounds the worst case.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FORM16_BYTES, files: MAX_FORM16_FILES },
});

export const form16BulkRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

interface FileResult {
  filename: string;
  outcome: Form16Outcome;
  label: string;
  employee_code?: string;
  employee_name?: string;
}

/** Roles that issue tax certificates. Branch scope is enforced per employee below. */
const ISSUER_ROLES = ["super_admin", "admin", "hr", "payroll_head", "payroll_hr"] as const;

// POST /api/employee-docs/form16/bulk   multipart: files[], financial_year, mode=preview|commit
form16BulkRouter.post(
  "/bulk",
  requireRole(...ISSUER_ROLES),
  (req: any, res: any, next: any) => {
    upload.array("files", MAX_FORM16_FILES)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? `Each file must be ${MAX_FORM16_BYTES / 1024 / 1024} MB or smaller` : `Upload error: ${err.message}`;
        return res.status(400).json({ success: false, message: msg });
      }
      if (err) return res.status(400).json({ success: false, message: err.message });
      next();
    });
  },
  h(async (req: AuthenticatedRequest & { files?: Express.Multer.File[] }, res: Response) => {
    const financialYear = String((req.body as Record<string, unknown>)?.financial_year ?? "");
    const mode = String((req.body as Record<string, unknown>)?.mode ?? "preview");
    if (!isValidFinancialYear(financialYear)) {
      return res.status(400).json({ success: false, message: "financial_year must look like 2025-26" });
    }
    if (mode !== "preview" && mode !== "commit") {
      return res.status(400).json({ success: false, message: "mode must be preview or commit" });
    }
    const files = req.files ?? [];
    if (!files.length) return res.status(400).json({ success: false, message: "Attach at least one PDF" });

    const docName = form16DocName(financialYear);
    const actorId = req.authUser!.id;
    const results: FileResult[] = [];
    const seenEmployees = new Set<string>();

    for (const file of files) {
      const result = (outcome: Form16Outcome, extra: Partial<FileResult> = {}): FileResult =>
        ({ filename: file.originalname, outcome, label: OUTCOME_LABEL[outcome], ...extra });

      if (!looksLikePdf(file.buffer)) { results.push(result("not_pdf")); continue; }
      const pan = extractPanFromFilename(file.originalname);
      if (!pan) { results.push(result("no_pan")); continue; }

      // Match on the blind index (the PAN is stored encrypted) and on the stored value, because the
      // index has not been filled for every employee yet.
      const [emps] = await db.execute<RowDataPacket[]>(
        `SELECT id, employee_code, full_name FROM employees
          WHERE pan_number = ? ${blindIndexPan(pan, "form16-bulk") ? "OR pan_blind_index = ?" : ""}
          LIMIT 3`,
        blindIndexPan(pan, "form16-bulk") ? [pan, blindIndexPan(pan, "form16-bulk")] : [pan],
      );
      const matches = [...new Map((emps as RowDataPacket[]).map((e) => [String(e.id), e])).values()];
      if (matches.length === 0) { results.push(result("no_employee")); continue; }
      if (matches.length > 1) { results.push(result("ambiguous")); continue; }
      const emp = matches[0];

      // Branch scope: never reveal who the PAN belongs to outside it.
      if (!(await canViewEmployee({ id: actorId }, String(emp.id)))) { results.push(result("out_of_scope")); continue; }
      const who = { employee_code: String(emp.employee_code ?? ""), employee_name: String(emp.full_name ?? "") };

      const [dups] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employee_documents WHERE employee_id = ? AND doc_type = 'form_16' AND doc_name = ? LIMIT 1",
        [emp.id, docName],
      );
      // Two files in one batch for the same person count as a duplicate of the first.
      if ((dups as RowDataPacket[]).length > 0 || seenEmployees.has(String(emp.id))) { results.push(result("duplicate", who)); continue; }
      seenEmployees.add(String(emp.id));

      if (mode === "preview") { results.push(result("ready", who)); continue; }

      const stored = `${randomUUID()}.pdf`;
      const dir = path.join(UPLOADS_ROOT, "employee-documents");
      const target = path.join(dir, stored);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, file.buffer);
        await registerUpload({
          uploadedByUser: actorId,
          category: "employee-documents",
          storedFilename: stored,
          originalFilename: file.originalname,
          mimeType: "application/pdf",
          fileSizeBytes: file.size,
          sha256Hash: createHash("sha256").update(file.buffer).digest("hex"),
          accessLevel: "pii",
          ownerEmployeeId: String(emp.id),
        });
        await db.execute(
          `INSERT INTO employee_documents
             (id, employee_id, doc_type, doc_category, doc_name, file_url, uploaded_by, verified, verified_by, verification_date)
           VALUES (?, ?, 'form_16', 'other', ?, ?, ?, 1, ?, NOW())`,
          [randomUUID(), emp.id, docName, `/api/files/employee-documents/${stored}`, actorId, actorId],
        );
        results.push(result("uploaded", who));
      } catch (err) {
        try { fs.unlinkSync(target); } catch { /* nothing was written */ }
        console.error("[form16-bulk] save failed:", err instanceof Error ? err.message : String(err));
        results.push(result("failed", who));
      }
    }

    if (mode === "commit") {
      // Counts only: no PAN, name or file name goes into the audit record.
      void logSensitiveAction({
        actor_user_id: actorId,
        action_type: "FORM16_BULK_UPLOAD",
        module_key: "payroll",
        entity_type: "employee_documents",
        entity_id: financialYear,
        change_summary: { financial_year: financialYear, ...summarise(results) },
        req,
      });
    }

    return res.json({ success: true, data: { mode, financial_year: financialYear, summary: summarise(results), results } });
  }),
);
