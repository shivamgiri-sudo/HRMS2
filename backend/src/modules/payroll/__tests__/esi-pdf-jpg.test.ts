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

it.each([
  ["small source", 200, 150, 60],
  ["large source", 3000, 2000, 200],
])("keeps %s inside the 50–90 KB window", async (_n, w, h, amp) => {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++)
        raw[(y * w + x) * 3 + c] = Math.max(0, Math.min(255, ((x * 255) / w + (y * 80) / h + (Math.random() - 0.5) * amp) | 0));
  const file = path.join(os.tmpdir(), `esi-range-${Date.now()}-${w}.png`);
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
  try {
    const jpg = await toCompressedJpg(file);
    expect((await sharp(jpg).metadata()).format).toBe("jpeg");
    expect(jpg.length).toBeGreaterThanOrEqual(50 * 1024);
    expect(jpg.length).toBeLessThanOrEqual(90 * 1024);
  } finally {
    fs.rmSync(file, { force: true });
  }
}, 120000);
