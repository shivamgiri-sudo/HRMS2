import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { db } from "../src/db/mysql.js";
import { ensureDefaultTemplateFieldMaps } from "../src/modules/employees/universalDigitalFormFill.service.js";

const TEMPLATE_STORAGE_ROOT = path.resolve(process.cwd(), "private-storage", "document-templates");
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_NDA_PATH = path.resolve("C:\\Users\\ADMIN\\Downloads\\NDA format - Updated.docx");

type TemplateImport = {
  documentCode: string;
  documentName: string;
  category: string;
  sourceFile: string;
  requiresCandidateEsign: boolean;
  requiresHrUpload: boolean;
  fillMode: string;
};

const imports: TemplateImport[] = [
  {
    documentCode: "NDA_CONFIDENTIALITY",
    documentName: "NDA & Confidentiality Agreement",
    category: "agreement",
    sourceFile: process.env.NDA_TEMPLATE_PATH || DEFAULT_NDA_PATH,
    requiresCandidateEsign: true,
    requiresHrUpload: false,
    fillMode: "placeholder",
  },
];

function mimeTypeFromName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

async function ensureTemplate(row: TemplateImport) {
  const [existingRows] = await db.execute<Array<{ id: string }>>(
    `SELECT id FROM employee_joining_document_template WHERE document_code = ? AND template_version = 'v1' LIMIT 1`,
    [row.documentCode],
  );
  const existing = existingRows[0];
  const id = existing?.id ?? randomUUID();
  if (!existing) {
    await db.execute(
      `INSERT INTO employee_joining_document_template
         (id, document_code, document_name, document_category, template_version, requires_candidate_esign, requires_hr_upload, requires_hr_verification, is_mandatory, active_status)
       VALUES (?, ?, ?, ?, 'v1', ?, ?, 1, 1, 1)`,
      [id, row.documentCode, row.documentName, row.category, row.requiresCandidateEsign ? 1 : 0, row.requiresHrUpload ? 1 : 0],
    );
  }
  return id;
}

async function main() {
  fs.mkdirSync(TEMPLATE_STORAGE_ROOT, { recursive: true });

  for (const item of imports) {
    if (!fs.existsSync(item.sourceFile)) {
      throw new Error(
        `Original template file is missing: ${item.sourceFile}. ` +
        `Set NDA_TEMPLATE_PATH to the server-local DOCX path before running this script.`,
      );
    }

    const templateId = await ensureTemplate(item);
    const fileBuffer = fs.readFileSync(item.sourceFile);
    const ext = path.extname(item.sourceFile).toLowerCase() || ".pdf";
    const storedName = `${templateId}-${item.documentCode.toLowerCase()}-official${ext}`;
    const storagePath = path.join(TEMPLATE_STORAGE_ROOT, storedName);
    fs.writeFileSync(storagePath, fileBuffer);

    await db.execute(
      `UPDATE employee_joining_document_template
          SET document_name = ?,
              document_category = ?,
              requires_candidate_esign = ?,
              requires_hr_upload = ?,
              requires_hr_verification = 1,
              is_mandatory = 1,
              active_status = 1,
              template_storage_path = ?,
              template_mime_type = ?,
              fill_mode = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [
        item.documentName,
        item.category,
        item.requiresCandidateEsign ? 1 : 0,
        item.requiresHrUpload ? 1 : 0,
        storagePath,
        mimeTypeFromName(item.sourceFile),
        item.fillMode,
        templateId,
      ],
    );

    const maps = await ensureDefaultTemplateFieldMaps({
      templateId,
      documentCode: item.documentCode,
      actorUserId: SYSTEM_ACTOR_ID,
      fileName: item.sourceFile,
      fileBuffer,
    });

    console.log(`${item.documentCode}: imported ${path.basename(item.sourceFile)} with ${maps.length} field maps`);
  }

  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => undefined);
  process.exit(1);
});
