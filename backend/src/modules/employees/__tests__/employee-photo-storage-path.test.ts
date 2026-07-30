import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Uploaded files were written to one directory and served from another.
 *
 * The writers resolved their directory from `__dirname`, the readers from
 * `process.cwd()`. Those agree when running TypeScript from src/, so it worked
 * locally — but the production build runs backend/dist/src/server.js, where
 * `__dirname`-relative lands in backend/dist/uploads/ while the server still
 * serves backend/uploads/. Employee photos 404'd after a refresh; tax documents
 * had the same defect, and expense receipts had it inverted (one level too far
 * up, writing to the repo root, so they 404'd in dev instead).
 *
 * These are source assertions on purpose: the divergence only appears once
 * compiled, so no test executing from src/ can observe it at runtime.
 */
describe("upload storage paths", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  const writer = read("src/modules/employees/employee.photo.compat.routes.ts");
  const server = read("src/app.ts");
  const files = read("src/modules/files/files.routes.ts");

  it("resolves the photo directory from the working directory, not the module path", () => {
    expect(writer).toContain('path.resolve(process.cwd(), "uploads", "employee-photos")');
  });

  it("never resolves the photo directory relative to __dirname", () => {
    expect(writer).not.toMatch(/PHOTOS_DIR\s*=\s*path\.resolve\(\s*__dirname/);
  });

  it("agrees with the two places that serve the files back", () => {
    // app.ts: GET /api/files/employee-photos/:filename
    expect(server).toContain('path.resolve(process.cwd(), "uploads")');
    // files.routes.ts: UPLOADS_ROOT, used by the generic /api/files/:category route
    expect(files).toContain('path.resolve(process.cwd(), "uploads")');
  });

  it("stores the URL the public file route actually serves", () => {
    expect(writer).toContain("`/api/files/employee-photos/${finalName}`");
    expect(server).toContain('app.get("/api/files/employee-photos/:filename"');
  });

  it("resolves every upload directory in the backend from the working directory", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = resolve(dir, e.name);
        if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(full);
        return e.isFile() && e.name.endsWith(".ts") ? [full] : [];
      });

    const root = resolve(process.cwd(), "src");
    // e.g. path.resolve(__dirname, "../../../uploads/employee-photos")
    const dirnameUpload = /path\.(resolve|join)\(\s*__dirname[^)]*uploads/;

    const offenders = walk(root)
      .filter((f) => dirnameUpload.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });
});
