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

const OUT_DIR = path.resolve(process.cwd(), "private-storage", "document-templates");
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const { code } of TEMPLATE_DEFINITIONS) {
  const buffer = buildTemplateDocx(code);
  fs.writeFileSync(path.join(OUT_DIR, `${code}-v1.docx`), buffer);
  console.log(`${code.padEnd(24)} ${String(buffer.byteLength).padStart(6)} bytes  tokens: ${templateTokens(code).join(", ")}`);
}
console.log(`
Written to ${OUT_DIR}`);
