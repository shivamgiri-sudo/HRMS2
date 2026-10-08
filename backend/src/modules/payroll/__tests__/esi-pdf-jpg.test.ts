import { it, expect } from "vitest";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import fs from "fs";
import os from "os";
import path from "path";
import { toCompressedJpg } from "../esi-reg-docs.routes.js";

it("renders a PDF's first page to a JPG within 90 KB", async () => {
  const file = path.join(os.tmpdir(), `esi-pdf-${Date.now()}.pdf`);
  await new Promise<void>((resolve) => {
    const doc = new PDFDocument({ size: "A4" });
    const out = fs.createWriteStream(file);
    doc.pipe(out);
    doc.fontSize(40).text("Bank Passbook", 80, 100);
    doc.rect(60, 200, 400, 300).stroke();
    doc.end();
    out.on("finish", () => resolve());
  });
  try {
    const jpg = await toCompressedJpg(file);
    const meta = await sharp(jpg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(jpg.length).toBeLessThanOrEqual(90 * 1024);
  } finally {
    fs.rmSync(file, { force: true });
  }
}, 60000);
