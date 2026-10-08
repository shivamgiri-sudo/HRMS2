import fs from "fs";

/**
 * First page of a PDF as a JPG buffer. Pure Node (pdfjs-dist + @napi-rs/canvas,
 * both ship prebuilt binaries) so production needs no poppler/system package —
 * the deploy runner there has no passwordless sudo to install one.
 */
export async function pdfFirstPageToJpg(pdfPath: string): Promise<Buffer> {
  const [{ getDocument }, { createCanvas }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("@napi-rs/canvas"),
  ]);
  const data = new Uint8Array(await fs.promises.readFile(pdfPath));
  const doc = await getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1600 / base.width) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport }).promise;
    return canvas.toBuffer("image/jpeg", 90);
  } finally {
    await doc.destroy();
  }
}
