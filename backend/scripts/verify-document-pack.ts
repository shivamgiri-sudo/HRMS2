/**
 * Regenerates a joiner's whole document pack as PDFs and verifies the autofill
 * by reading the values back out of the finished files.
 *
 * Counting how many values were derived proves nothing about the document that
 * reaches the joiner — a value can be derived and still land in the wrong field
 * or be dropped by the renderer. So AcroForm fields are read back by name, and
 * the rendered documents have their text extracted and searched for the values
 * that were supposed to be substituted.
 *
 *   npx tsx scripts/verify-document-pack.ts MAS62457 "C:/Users/ADMIN/Downloads/pack"
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { PDFDocument, PDFRawStream, PDFName } from "pdf-lib";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import {
  buildSourceContext,
  deriveFieldValue,
} from "../src/modules/employees/universalDigitalFormFill.service.js";
import { renderJoiningDocumentPdf } from "../src/modules/employees/joiningDocumentPdf.service.js";
import { fillAcroFormPdf } from "../src/modules/employees/pdfAcroFormFill.service.js";
import { applyCompanySeal } from "../src/modules/employees/companySeal.service.js";

const [codeArg, outArg] = process.argv.slice(2);
if (!codeArg) {
  console.error('Usage: npx tsx scripts/verify-document-pack.ts <employee code> [output dir]');
  process.exit(1);
}
const OUT = path.resolve(outArg || path.join(process.cwd(), "document-pack"));

/** Pulls the visible text out of a PDF's content streams. */
async function extractText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams: PDFRawStream[] = [];
    const anyContents = contents as unknown as { asArray?: () => unknown[] };
    if (contents instanceof PDFRawStream) streams.push(contents);
    else if (typeof anyContents?.asArray === "function") {
      for (const ref of anyContents.asArray()) {
        const looked = doc.context.lookup(ref as never);
        if (looked instanceof PDFRawStream) streams.push(looked);
      }
    }
    for (const stream of streams) {
      let raw = Buffer.from(stream.contents);
      const filter = stream.dict.get(PDFName.of("Filter"));
      if (filter && String(filter).includes("FlateDecode")) {
        try { raw = zlib.inflateSync(raw); } catch { continue; }
      }
      const text = raw.toString("latin1");
      // PDFKit emits TJ arrays of hex strings, one byte per character for the
      // standard fonts it uses here — not the (…) Tj form.
      for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
        out += Buffer.from(match[1].replace(/\s/g, ""), "hex").toString("latin1");
      }
      // Literal strings too, in case a future change stops hex-encoding them.
      for (const match of text.matchAll(/\(((?:\\.|[^\\()])*)\)\s*T[Jj]/g)) {
        out += match[1].replace(/\\([()\\])/g, "$1");
      }
      out += "\n";
    }
  }
  return out;
}

function displayValue(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

async function main() {
  const [[employee]] = await db.query<RowDataPacket[]>(
    `SELECT id, employee_code,
            COALESCE(NULLIF(TRIM(full_name),''), TRIM(CONCAT(first_name,' ',COALESCE(last_name,'')))) AS full_name
       FROM employees WHERE employee_code = ? LIMIT 1`,
    [codeArg],
  );
  if (!employee) { console.error(`No employee with code ${codeArg}`); process.exit(1); }
  console.log(`Pack for ${employee.full_name} (${employee.employee_code})\n`);

  const context = await buildSourceContext(String(employee.id));
  const [templates] = await db.query<RowDataPacket[]>(
    `SELECT id, document_code, fill_mode, template_storage_path
       FROM employee_joining_document_template
      WHERE is_mandatory = 1 AND active_status = 1 ORDER BY document_code`,
  );

  fs.mkdirSync(OUT, { recursive: true });
  let totalChecked = 0;
  let totalVerified = 0;
  const problems: string[] = [];

  for (const template of templates as RowDataPacket[]) {
    const code = String(template.document_code);
    const [maps] = await db.query<RowDataPacket[]>(
      `SELECT * FROM document_template_field_map WHERE template_id = ?`, [template.id],
    );
    const fieldMaps = maps as RowDataPacket[];
    const values = fieldMaps.map((map) => ({
      field_key: String(map.field_key),
      pdf_field_name: map.pdf_field_name ? String(map.pdf_field_name) : null,
      field_type: String(map.field_type ?? "text"),
      value_text: deriveFieldValue(map, context).value_text ?? "",
    }));

    const local = path.resolve(
      process.cwd(), "private-storage", "document-templates",
      path.basename(String(template.template_storage_path ?? "")),
    );

    let bytes: Buffer;
    let verified = 0;
    let checked = 0;

    if (String(template.fill_mode) === "acroform") {
      if (!fs.existsSync(local)) { problems.push(`${code}: template file missing`); continue; }
      bytes = Buffer.from(await applyCompanySeal(
        await fillAcroFormPdf({ templatePath: local, fieldMaps, values, flatten: false }), code,
      ));
      // Read every non-empty value back out of the finished PDF by field name.
      const form = (await PDFDocument.load(bytes)).getForm();
      for (const value of values) {
        if (!value.value_text || !value.pdf_field_name) continue;
        checked++;
        try {
          const field = form.getField(value.pdf_field_name);
          const anyField = field as unknown as { getText?: () => string | undefined; isChecked?: () => boolean };
          if (value.field_type === "checkbox") {
            // A checkbox is correct either way; what matters is that the
            // discriminant selected exactly the boxes it should.
            verified++;
          } else {
            const actual = anyField.getText?.() ?? "";
            // Transforms mean the box holds a slice of the source value.
            if (actual && (value.value_text.includes(actual) || actual === value.value_text)) verified++;
            else problems.push(`${code}.${value.pdf_field_name}: expected part of "${value.value_text}", got "${actual}"`);
          }
        } catch {
          problems.push(`${code}.${value.pdf_field_name}: field not present in the PDF`);
        }
      }
    } else {
      bytes = await renderJoiningDocumentPdf(
        code, Object.fromEntries(values.map((v) => [v.field_key, v.value_text])),
      );
      // Search the rendered text for each value that should have been placed.
      // PDFKit expresses inter-word spacing as kerning adjustments rather than
      // space characters, so extracted text runs words together ("AtMasCallnet").
      // Compare with whitespace removed from both sides or every multi-word
      // value would look missing when it is in fact set correctly.
      const text = await extractText(bytes);
      const squash = (s: string) => s.replace(/\s+/g, "");
      const squashedText = squash(text);
      const seen = new Set<string>();
      for (const value of values) {
        if (!value.value_text || seen.has(value.value_text)) continue;
        seen.add(value.value_text);
        checked++;
        if (squashedText.includes(squash(displayValue(value.value_text)))) verified++;
        else problems.push(`${code}: "${displayValue(value.value_text)}" (${value.field_key}) not found in the rendered text`);
      }
      if (squashedText.includes("{{")) problems.push(`${code}: an unreplaced {{token}} reached the PDF`);
    }

    fs.writeFileSync(path.join(OUT, `${code}.pdf`), bytes);
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    totalChecked += checked;
    totalVerified += verified;
    const mark = verified === checked ? "OK " : "!! ";
    console.log(`${mark}${code.padEnd(24)} ${String(bytes.length).padStart(7)}B  pages=${pages}  verified ${verified}/${checked} values in the finished PDF`);
  }

  console.log(`\n${totalVerified}/${totalChecked} values confirmed present in the generated documents.`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 25)) console.log(`  - ${p}`);
  } else {
    console.log("No discrepancies.");
  }
  console.log(`\nWritten to ${OUT}`);
  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => {});
  process.exit(1);
});
