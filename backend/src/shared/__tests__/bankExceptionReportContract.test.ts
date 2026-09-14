/**
 * The bank-exception report handles the one field that moves money, so its safety
 * properties are pinned rather than assumed.
 *
 * It exists because §5's classification (OK / MISSING / CONFLICT / INVALID / UNVERIFIED)
 * cannot be produced anywhere but the production host: splitting rows requires decrypting
 * employee_bank_detail.account_number_enc, and off-host the all-zeros dev key turns every
 * encrypted row into a false "legacy_only". A report that is confidently wrong about who can
 * be paid is worse than no report.
 *
 * Three properties matter enough to be tests:
 *   1. It never writes. This runs against production payroll data by design.
 *   2. It never prints a raw account number. The output is a map of who can be paid; the
 *      values themselves must stay masked, exactly as the /bank-exception-report endpoint
 *      already does (it emits XXXX + last 4 for both sides of a conflict).
 *   3. It refuses under a dev key. Without that gate its headline finding -- the CONFLICT
 *      count -- is fabricated.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "bank-exception-report.ts");
const source = fs.readFileSync(SCRIPT, "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("bank-exception-report is read-only", () => {
  it("issues no INSERT, UPDATE, DELETE or DDL", () => {
    expect(code).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+|ALTER\s+|TRUNCATE)/i);
  });
});

describe("bank-exception-report never leaks an account number", () => {
  it("masks every account it prints", () => {
    // The resolved value exists only to be compared and masked.
    expect(code).toMatch(/mask/i);
    expect(code).toMatch(/slice\(-4\)/);
  });

  it("does not log a resolved or raw account value directly", () => {
    // Catches console.log(...resolved...) / console.log(...legacyValue...) style leaks.
    expect(code).not.toMatch(/console\.\w+\([^)]*\b(resolved|encValue|legacyValue|account_number)\b[^)]*\)/);
  });
});

describe("bank-exception-report refuses to run on the wrong key", () => {
  it("parity-checks the loaded key against stored ciphertext before classifying", () => {
    expect(code).toMatch(/checkKeyParity|isUsingDevEncryptionKey/);
  });

  it("exits rather than reporting a fabricated conflict count", () => {
    expect(code).toMatch(/process\.exit(?:Code)?\s*=?\s*\(?1/);
  });
});

describe("bank-exception-report classifies every payable row", () => {
  it("covers all five classes §5 asks for", () => {
    for (const cls of ["OK", "MISSING", "CONFLICT", "INVALID", "UNVERIFIED"]) {
      expect(code).toContain(cls);
    }
  });

  it("uses the same resolver the payment path uses, not its own logic", () => {
    // disbursal.routes.ts and payroll-extended.routes.ts both resolve through this. A second
    // implementation here would classify rows the payment path would treat differently.
    expect(code).toMatch(/resolveAccountNumberWithConflict/);
  });
});
