import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const ROUTES = "src/modules/finance/grn-smart.routes.ts";

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * Reported from production 2026-08-17: "uploaded PDF gone". multer's fileFilter rejected with
 * `callback(null, false)`, which DISCARDS the file silently — `req.files` came back empty and the
 * handler answered "At least one PDF or image is required" to someone who had just attached a PDF.
 * Neither fact that explains it (which file, what type the browser claimed) ever reached the user.
 *
 * The MIME half is the one that bites: a browser may label a .pdf as application/octet-stream, and
 * a valid invoice then vanishes with no reason given.
 */
describe("GRN document upload rejections are explained", () => {
  it("never discards a file silently", () => {
    const routes = read(ROUTES);
    const code = routes.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // The silent form: a falsy second argument tells multer to drop the file with no error.
    expect(code, "callback(null, false) drops the file without telling anyone")
      .not.toMatch(/callback\(\s*null\s*,\s*(false|[a-zA-Z]+Ok\s*&&)/);
    // Accepting is still explicit.
    expect(code).toMatch(/callback\(null,\s*true\)/);
  });

  it("rejects with a 400 naming the file and why", () => {
    const routes = read(ROUTES);
    expect(routes).toContain('code: "UNSUPPORTED_FILE_TYPE"');
    expect(routes).toContain("statusCode: 400");
    // The message must carry the filename and the offending type, not a generic string.
    expect(routes).toMatch(/file\.originalname/);
    expect(routes).toMatch(/file\.mimetype/);
  });

  it("distinguishes a bad extension from a bad MIME type", () => {
    const routes = read(ROUTES);
    expect(routes).toMatch(/extensionOk/);
    expect(routes).toMatch(/mimeTypeOk/);
    // Two different reasons, so the user is not told "wrong extension" for a MIME mismatch.
    expect(routes).toMatch(/!extensionOk\s*\n?\s*\?/);
  });

  /**
   * multer's own limit failures arrive as MulterError with no statusCode, so errorHandler.ts would
   * classify them as unexpected 500s and replace the message in production — telling someone with
   * a 25 MB scan that the server had broken.
   */
  it("translates multer's size and count limits into readable 400s", () => {
    const routes = read(ROUTES);
    expect(routes).toContain("multer.MulterError");
    expect(routes).toContain("LIMIT_FILE_SIZE");
    expect(routes).toContain("LIMIT_FILE_COUNT");
    const idx = routes.indexOf("multer.MulterError");
    expect(routes.slice(idx, idx + 700)).toContain("statusCode: 400");
  });

  it("the upload route actually uses the wrapper, not raw upload.array", () => {
    const routes = read(ROUTES);
    const code = routes.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain('uploadGrnFiles("files"');
    // A raw upload.array on a route would bypass the MulterError translation entirely.
    const rawUses = [...code.matchAll(/^\s*upload\.array\(/gm)];
    expect(rawUses, "route-level upload.array bypasses the error translation").toHaveLength(0);
  });

  it("keeps the accepted types in one place, used by both checks", () => {
    const routes = read(ROUTES);
    expect(routes).toContain("ALLOWED_UPLOAD_EXTENSIONS");
    expect(routes).toContain("ALLOWED_UPLOAD_MIME_TYPES");
    for (const ext of [".pdf", ".jpg", ".jpeg", ".png", ".webp"]) expect(routes).toContain(`"${ext}"`);
    for (const mime of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
      expect(routes).toContain(`"${mime}"`);
    }
  });
});
