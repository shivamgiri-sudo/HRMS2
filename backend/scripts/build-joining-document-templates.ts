/**
 * Writes the joining-document DOCX templates to private storage.
 *
 * Content and layout live in
 * src/modules/employees/joiningDocumentTemplates.ts. This script only puts them
 * on disk, so it can be re-run on any environment after deployment.
 *
 *   npx tsx scripts/build-joining-document-templates.ts
 */
import fs from "fs";
import path from "path";
import { TEMPLATE_DEFINITIONS, buildTemplateDocx, templateTokens } from "../src/modules/employees/joiningDocumentTemplates.js";
import { buildEpfDeclarationPdf } from "../src/modules/employees/epfDeclarationForm.js";

const OUT_DIR = path.resolve(process.cwd(), "private-storage", "document-templates");
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const { code } of TEMPLATE_DEFINITIONS) {
  const buffer = buildTemplateDocx(code);
  fs.writeFileSync(path.join(OUT_DIR, `${code}-v1.docx`), buffer);
  console.log(`${code.padEnd(24)} ${String(buffer.byteLength).padStart(6)} bytes  tokens: ${templateTokens(code).join(", ")}`);
}

// The statutory EPF form is a fillable AcroForm PDF, not a DOCX — the supplied
// EPFO original is a flat scan with no form fields, so it cannot be filled.
const epf = await buildEpfDeclarationPdf();
fs.writeFileSync(path.join(OUT_DIR, "EPF_DECLARATION-v1.pdf"), epf);
console.log(`${"EPF_DECLARATION".padEnd(24)} ${String(epf.byteLength).padStart(6)} bytes  (fillable AcroForm)`);
console.log(`
Written to ${OUT_DIR}`);
