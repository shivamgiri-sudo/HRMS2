/**
 * Registers the generated joining-document templates against the database.
 *
 * Why a script rather than a SQL migration: field maps are produced by
 * defaultMapsForTemplate(), which reads the DOCX and extracts its {{tokens}}.
 * Hand-written SQL would have to restate all of that and would drift from the
 * code the moment a template changes. This calls the same functions the upload
 * route calls, so what lands in the database is exactly what the fill engine
 * expects.
 *
 * Safe to re-run: each template is upserted and its maps replaced wholesale.
 * Existing checklists, generated files and signed documents are never touched.
 *
 *   npx tsx scripts/build-joining-document-templates.ts     # writes the files
 *   npx tsx scripts/register-joining-document-templates.ts  # registers them
 *
 * Pass --dry-run to print what would change without writing.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../src/db/mysql.js";
import {
  defaultMapsForTemplate,
  replaceTemplateFieldMaps,
} from "../src/modules/employees/universalDigitalFormFill.service.js";

const DRY_RUN = process.argv.includes("--dry-run");
const TEMPLATE_DIR = path.resolve(process.cwd(), "private-storage", "document-templates");
const ACTOR = "system-template-registration";

type Spec = {
  code: string;
  name: string;
  file: string;
  fillMode: "placeholder" | "acroform";
  category: string;
  esign: boolean;
};

/**
 * Every mandatory joining document. requires_hr_upload is forced to 0 for all
 * of them: each one is now generated from employee data, so asking HR to
 * hand-fill and upload a scan is exactly the manual step this removes.
 */
const SPECS: Spec[] = [
  { code: "EMPLOYMENT_CONTRACT", name: "Employment Agreement", file: "EMPLOYMENT_CONTRACT-v1.docx", fillMode: "placeholder", category: "agreement", esign: true },
  { code: "NDA_CONFIDENTIALITY", name: "Confidentiality and Non-Disclosure Agreement", file: "NDA_CONFIDENTIALITY-v1.docx", fillMode: "placeholder", category: "agreement", esign: true },
  { code: "IT_COMPLIANCE", name: "IT Compliance Declaration", file: "IT_COMPLIANCE-v1.docx", fillMode: "placeholder", category: "declaration", esign: true },
  { code: "BAMS_DECLARATION", name: "BAMS Declaration", file: "BAMS_DECLARATION-v1.docx", fillMode: "placeholder", category: "declaration", esign: true },
  { code: "PI_PROCESSING_CONSENT", name: "Personal Information Processing Consent", file: "PI_PROCESSING_CONSENT-v1.docx", fillMode: "placeholder", category: "consent", esign: true },
  { code: "ZERO_TOLERANCE_ACK", name: "Zero Tolerance Policy Acknowledgement", file: "ZERO_TOLERANCE_ACK-v1.docx", fillMode: "placeholder", category: "acknowledgement", esign: true },
  { code: "EPF_DECLARATION", name: "EPF Declaration Form (Form 11)", file: "EPF_DECLARATION-v1.pdf", fillMode: "acroform", category: "statutory", esign: true },
  { code: "EPF_NOMINATION_FORM2", name: "EPF & EPS Nomination and Declaration Form (Form 2)", file: "EPF_NOMINATION_FORM2-v1.pdf", fillMode: "acroform", category: "statutory", esign: true },
];

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
};

async function main() {
  const missing = SPECS.filter((s) => !fs.existsSync(path.join(TEMPLATE_DIR, s.file)));
  if (missing.length) {
    console.error(`Template files are not on disk in ${TEMPLATE_DIR}:`);
    for (const s of missing) console.error(`  - ${s.file}`);
    console.error("\nRun: npx tsx scripts/build-joining-document-templates.ts");
    // Registering an acroform template whose file is absent makes document
    // generation throw for every joiner instead of degrading to a placeholder,
    // so refuse rather than half-apply.
    process.exit(1);
  }

  for (const spec of SPECS) {
    const filePath = path.join(TEMPLATE_DIR, spec.file);
    const buffer = fs.readFileSync(filePath);
    const mime = MIME[path.extname(spec.file).toLowerCase()] ?? "application/octet-stream";

    const [[existing]] = await db.execute<RowDataPacket[]>(
      `SELECT id, fill_mode, template_storage_path, requires_hr_upload
         FROM employee_joining_document_template
        WHERE document_code = ? LIMIT 1`,
      [spec.code],
    );

    const maps = defaultMapsForTemplate(spec.code, spec.file, buffer);
    const before = existing
      ? `${existing.fill_mode} hr_upload=${existing.requires_hr_upload} ${existing.template_storage_path ? path.basename(String(existing.template_storage_path)) : "NO FILE"}`
      : "NOT REGISTERED";

    if (DRY_RUN) {
      console.log(`${spec.code.padEnd(24)} ${before}  ->  ${spec.fillMode} hr_upload=0 ${spec.file}  (${maps.length} maps)`);
      continue;
    }

    let templateId = existing?.id as string | undefined;
    if (templateId) {
      await db.execute<ResultSetHeader>(
        `UPDATE employee_joining_document_template
            SET document_name = ?, document_category = ?, fill_mode = ?,
                template_version = 'v1', template_storage_path = ?, template_mime_type = ?,
                requires_candidate_esign = ?, requires_hr_upload = 0,
                is_mandatory = 1, active_status = 1, updated_at = NOW()
          WHERE id = ?`,
        [spec.name, spec.category, spec.fillMode, filePath, mime, spec.esign ? 1 : 0, templateId],
      );
    } else {
      templateId = randomUUID();
      await db.execute<ResultSetHeader>(
        `INSERT INTO employee_joining_document_template
           (id, document_code, document_name, document_category, fill_mode,
            template_version, template_storage_path, template_mime_type,
            requires_candidate_esign, requires_hr_upload, requires_hr_verification,
            is_mandatory, active_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'v1', ?, ?, ?, 0, 1, 1, 1, NOW(), NOW())`,
        [templateId, spec.code, spec.name, spec.category, spec.fillMode, filePath, mime, spec.esign ? 1 : 0],
      );
    }

    await replaceTemplateFieldMaps(templateId, spec.code, ACTOR, maps);
    const autofilled = maps.filter((m) => m.source_path).length;
    console.log(
      `${spec.code.padEnd(24)} ${before}  ->  ${spec.fillMode} ${spec.file}  ` +
      `(${maps.length} maps, ${autofilled} auto-filled, ${maps.length - autofilled} completed by hand)`,
    );
  }

  if (!DRY_RUN) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT t.document_code, t.fill_mode, t.requires_hr_upload,
              COUNT(m.id) AS maps
         FROM employee_joining_document_template t
         LEFT JOIN document_template_field_map m ON m.template_id = t.id
        WHERE t.is_mandatory = 1 AND t.active_status = 1
        GROUP BY t.id ORDER BY t.document_code`,
    );
    console.log("\nMandatory documents after registration:");
    console.table(rows);
  }
  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => {});
  process.exit(1);
});
