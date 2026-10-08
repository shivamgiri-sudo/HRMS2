/**
 * Generates a complete joining-document pack for one employee, to a folder.
 *
 * This is a diagnostic: it reads the registered templates and field maps and
 * runs the same fill functions the application runs, but writes nothing back to
 * the database and touches no checklist. Use it to see exactly what a joiner
 * would receive.
 *
 *   npx tsx scripts/generate-document-pack.ts "Sofia Sultan" "C:/Users/ADMIN/Downloads/pack"
 *
 * The output contains real personal data, so it is written only where you point
 * it and is never logged: the console reports field counts and whether values
 * resolved, never the values themselves.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import {
  buildSourceContext,
  deriveFieldValue,
  renderPlaceholderDocx,
} from "../src/modules/employees/universalDigitalFormFill.service.js";
import { fillAcroFormPdf } from "../src/modules/employees/pdfAcroFormFill.service.js";
import { applyCompanySeal } from "../src/modules/employees/companySeal.service.js";

const [nameArg, outArg] = process.argv.slice(2);
if (!nameArg) {
  console.error('Usage: npx tsx scripts/generate-document-pack.ts "<employee name or code>" [output dir]');
  process.exit(1);
}
const OUT_DIR = path.resolve(outArg || path.join(process.cwd(), "document-pack"));

async function findEmployee(needle: string) {
  const like = `%${needle.trim()}%`;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, employee_code,
            COALESCE(NULLIF(TRIM(full_name), ''), TRIM(CONCAT(first_name,' ',COALESCE(last_name,'')))) AS full_name
       FROM employees
      WHERE employee_code = ?
         OR COALESCE(NULLIF(TRIM(full_name), ''), TRIM(CONCAT(first_name,' ',COALESCE(last_name,'')))) LIKE ?
      ORDER BY (employee_code = ?) DESC, created_at DESC
      LIMIT 10`,
    [needle.trim(), like, needle.trim()],
  );
  return rows as RowDataPacket[];
}

async function main() {
  const matches = await findEmployee(nameArg);
  if (!matches.length) {
    console.error(`No employee matched "${nameArg}".`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(`${matches.length} employees matched — using the first:`);
    for (const m of matches) console.log(`  ${String(m.employee_code ?? "(no code)").padEnd(12)} ${m.full_name}`);
  }
  const employee = matches[0];
  console.log(`\nGenerating pack for ${employee.full_name} (${employee.employee_code})\n`);

  const context = await buildSourceContext(String(employee.id));

  const [templates] = await db.query<RowDataPacket[]>(
    `SELECT id, document_code, document_name, fill_mode, template_storage_path
       FROM employee_joining_document_template
      WHERE is_mandatory = 1 AND active_status = 1
      ORDER BY document_code`,
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary: Array<Record<string, unknown>> = [];

  for (const template of templates as RowDataPacket[]) {
    const code = String(template.document_code);
    const [maps] = await db.query<RowDataPacket[]>(
      `SELECT * FROM document_template_field_map WHERE template_id = ? ORDER BY page_no, created_at`,
      [template.id],
    );
    const fieldMaps = maps as RowDataPacket[];

    // Exactly what synchronizeChecklistFieldValues would persist.
    const values = fieldMaps.map((map) => ({
      field_key: String(map.field_key),
      value_text: deriveFieldValue(map, context).value_text ?? "",
    }));
    const resolved = values.filter((v) => v.value_text).length;
    const blank = fieldMaps
      .filter((map, i) => !values[i].value_text && map.source_path)
      .map((map) => String(map.field_key));

    // The stored path is absolute and belongs to whichever host registered the
    // template, so fall back to the same file name in the local template
    // directory. That lets this run from a workstation against the shared
    // database without rewriting anything.
    const storedPath = String(template.template_storage_path ?? "");
    const localPath = storedPath
      ? path.resolve(process.cwd(), "private-storage", "document-templates", path.basename(storedPath))
      : "";
    const templatePath = storedPath && fs.existsSync(storedPath) ? storedPath : localPath;
    if (!templatePath || !fs.existsSync(templatePath)) {
      console.log(`${code.padEnd(22)} SKIPPED — template file not found (${path.basename(storedPath) || "no path"})`);
      summary.push({ document: code, status: "template file not found", storedPath });
      continue;
    }

    try {
      let outFile: string;
      if (String(template.fill_mode) === "acroform") {
        let content = await fillAcroFormPdf({ templatePath, fieldMaps, values, flatten: false });
        content = Buffer.from(await applyCompanySeal(content, code));
        outFile = path.join(OUT_DIR, `${code}.pdf`);
        fs.writeFileSync(outFile, content);
      } else {
        const replacements = Object.fromEntries(values.map((v) => [v.field_key, v.value_text]));
        for (const map of fieldMaps) {
          const token = map.placeholder_token ? String(map.placeholder_token).replace(/^\{\{|\}\}$/g, "") : null;
          if (token) replacements[token] = replacements[String(map.field_key)] ?? "";
        }
        const content = await renderPlaceholderDocx(templatePath, replacements);
        outFile = path.join(OUT_DIR, `${code}.docx`);
        fs.writeFileSync(outFile, content);
      }
      console.log(
        `${code.padEnd(22)} ${path.basename(outFile).padEnd(28)} ` +
        `${String(resolved).padStart(3)}/${String(fieldMaps.length).padEnd(3)} fields filled` +
        (blank.length ? `  (blank with a source: ${blank.slice(0, 4).join(", ")}${blank.length > 4 ? "…" : ""})` : ""),
      );
      summary.push({
        document: code,
        name: template.document_name,
        file: path.basename(outFile),
        fields: fieldMaps.length,
        filled: resolved,
        blankWithSource: blank,
      });
    } catch (error) {
      console.log(`${code.padEnd(22)} FAILED — ${error instanceof Error ? error.message : String(error)}`);
      summary.push({ document: code, status: "failed", error: String(error) });
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "_summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nWritten to ${OUT_DIR}`);
  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => {});
  process.exit(1);
});
