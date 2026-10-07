import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// auth_user.email, employees.email/official_email/employee_code are all utf8mb4_unicode_ci, so
// `col = ?` is already case-insensitive. Wrapping the column in LOWER()/UPPER() made the login
// lookups full scans (EXPLAIN: type=index over 1762 auth_user rows) with no result difference.
const dir = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(dir, "..", f), "utf8");

describe("auth lookups keep the identifier column bare so indexes apply", () => {
  it.each(["auth.service.ts", "auth.routes.ts"])(
    "%s has no LOWER()/UPPER() around identity columns",
    (f) => {
      const src = read(f);
      expect(src).not.toMatch(/LOWER\((au\.)?email\)\s*=\s*LOWER\(\?\)/);
      expect(src).not.toMatch(/LOWER\(official_email\)\s*=\s*LOWER\(\?\)/);
      expect(src).not.toMatch(/UPPER\(e\.employee_code\)\s*=\s*UPPER\(\?\)/);
    },
  );
});
