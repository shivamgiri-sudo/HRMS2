/**
 * Shrink a camera photo before uploading it.
 *
 * A phone camera produces 3-8 MB JPEGs. Onboarding sent those bytes untouched,
 * so a document upload on a weak mobile connection took far longer than it
 * needed to and had far more opportunity to fail — while the live selfie, which
 * goes through a canvas and lands at ~60 KB, went through reliably every time.
 * Re-encoding documents the same way removes that asymmetry.
 *
 * Falls back to the original file whenever anything is unsupported or the result
 * is not actually smaller: never block an upload to save bandwidth.
 */
const DEFAULT_MAX_EDGE = 2000; // keeps small print on an Aadhaar/marksheet legible
const DEFAULT_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 600 * 1024;

export async function compressImageForUpload(
  file: File,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  // PDFs, HEIC and anything non-raster must pass through untouched.
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob || blob.size >= file.size) return file;

    const renamed = file.name.replace(/\.(png|webp|bmp|tiff?|jpe?g)$/i, "") + ".jpg";
    return new File([blob], renamed, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
