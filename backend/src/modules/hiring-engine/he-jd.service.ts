/**
 * Requisition JD for the Hiring Engine: upload a JD document (.docx / .pdf / .txt) or paste text; it is parsed in the
 * BMS format and stored in he_requisition_jd (approved requisitions themselves are never edited). Without an upload,
 * the requisition's own job description + skills text are parsed instead.
 */
import type { RowDataPacket } from "mysql2";
import PizZip from "pizzip";
import { PDFParse } from "pdf-parse";
import { db } from "../../db/mysql.js";
import { parseStructuredJd, type StructuredJd } from "./he-jd-doc.js";

export const JD_MAX_BYTES = 5 * 1024 * 1024;

export async function extractJdText(fileName: string, data: Buffer): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "docx") {
    const xml = new PizZip(data).file("word/document.xml")?.asText() ?? "";
    return xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  }
  if (ext === "pdf") {
    const parser = new PDFParse({ data });
    try { return String((await parser.getText()).text ?? "").trim(); } finally { await parser.destroy(); }
  }
  if (ext === "txt" || ext === "md") return data.toString("utf8").trim();
  throw Object.assign(new Error("Upload a .docx, .pdf or .txt JD (old .doc files: save as .docx first)"), { statusCode: 400 });
}

export interface RequisitionJd { source: "uploaded" | "requisition"; sourceName: string | null; text: string; parsed: StructuredJd; updatedAt: string | null }

export async function getRequisitionJd(requisitionId: string): Promise<RequisitionJd | null> {
  const [up] = await db.execute<RowDataPacket[]>("SELECT source_name, jd_text, parsed, updated_at FROM he_requisition_jd WHERE requisition_id = ? LIMIT 1", [requisitionId]);
  if (up[0]) {
    const parsed = (typeof up[0].parsed === "string" ? JSON.parse(up[0].parsed) : up[0].parsed) as StructuredJd;
    return { source: "uploaded", sourceName: up[0].source_name, text: String(up[0].jd_text), parsed, updatedAt: up[0].updated_at ? new Date(up[0].updated_at).toISOString() : null };
  }
  const [r] = await db.execute<RowDataPacket[]>("SELECT job_description, skills_required FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  if (!r[0]) return null;
  const text = [r[0].job_description, r[0].skills_required ? `Mandatory Skills: ${r[0].skills_required}` : null].filter(Boolean).join("\n");
  return { source: "requisition", sourceName: null, text, parsed: parseStructuredJd(text), updatedAt: null };
}

export async function saveRequisitionJd(requisitionId: string, input: { fileName?: string | null; base64?: string | null; text?: string | null }, userId: string | null): Promise<RequisitionJd> {
  let text = String(input.text ?? "").trim();
  let name: string | null = null;
  if (input.base64 && input.fileName) {
    const buf = Buffer.from(input.base64, "base64");
    if (buf.length > JD_MAX_BYTES) throw Object.assign(new Error("JD file is larger than 5 MB"), { statusCode: 400 });
    text = await extractJdText(input.fileName, buf);
    name = input.fileName.slice(0, 255);
  }
  if (text.length < 20) throw Object.assign(new Error("The JD has no readable text (scanned image?). Paste the text instead."), { statusCode: 400 });
  const parsed = parseStructuredJd(text);
  await db.execute(
    `INSERT INTO he_requisition_jd (requisition_id, source_name, jd_text, parsed, updated_by) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE source_name = VALUES(source_name), jd_text = VALUES(jd_text), parsed = VALUES(parsed), updated_by = VALUES(updated_by)`,
    [requisitionId, name, text.slice(0, 200000), JSON.stringify(parsed), userId]);
  return { source: "uploaded", sourceName: name, text, parsed, updatedAt: new Date().toISOString() };
}
