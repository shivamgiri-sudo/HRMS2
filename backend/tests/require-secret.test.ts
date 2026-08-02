import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireSecret } from "../src/utils/require-secret.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `password: process.env.X || 'actual-password'` reads like a convenience and is
 * three problems: the secret is in the repo forever, a missing variable stops
 * being an error, and a password rotation silently un-fixes itself because any
 * host missing the variable keeps using the baked-in one.
 *
 * The same shape already bit this codebase: utils/encryption.ts fell back to
 * JWT_SECRET || "", so ciphertext was written under sha256("") whenever the key
 * was absent, and nothing complained until a rotation exposed it.
 */

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED }; });
afterEach(() => { process.env = { ...SAVED }; });

describe("requireSecret", () => {
  it("returns the value when it is set", () => {
    process.env.TEST_SECRET_A = "from-env";
    expect(requireSecret("TEST_SECRET_A")).toBe("from-env");
  });

  it("falls back to a named alternative, never to a literal", () => {
    delete process.env.TEST_SECRET_A;
    process.env.TEST_SECRET_B = "second-choice";
    expect(requireSecret("TEST_SECRET_A", "TEST_SECRET_B")).toBe("second-choice");
  });

  it("throws when nothing is set, rather than connecting anyway", () => {
    delete process.env.TEST_SECRET_A;
    delete process.env.TEST_SECRET_B;
    expect(() => requireSecret("TEST_SECRET_A", "TEST_SECRET_B")).toThrow(/is not set/);
  });

  it("treats empty string as unset", () => {
    // An empty password is how sha256("") happened in encryption.ts.
    process.env.TEST_SECRET_A = "";
    expect(() => requireSecret("TEST_SECRET_A")).toThrow(/is not set/);
  });

  it("names what it looked for, so the fix is obvious", () => {
    delete process.env.TEST_SECRET_A;
    delete process.env.TEST_SECRET_B;
    expect(() => requireSecret("TEST_SECRET_A", "TEST_SECRET_B"))
      .toThrow(/TEST_SECRET_A, TEST_SECRET_B/);
  });
});

describe("no shipped source carries a hardcoded database password", () => {
  // The regression guard. Both sites below were live on main until this commit;
  // without this test nothing stops the next `|| 'password'` being added.
  const GUARDED = [
    "src/db/lms-mysql.ts",
    "src/workers/apr-vicidial-sync.worker.ts",
    "src/utils/encryption.ts",
  ];

  for (const rel of GUARDED) {
    it(`${rel} resolves credentials from the environment only`, () => {
      const file = path.join(ROOT, rel);
      if (!fs.existsSync(file)) return;
      const src = fs.readFileSync(file, "utf8");

      // A quoted literal on the right-hand side of a password/user fallback.
      const fallback = /(password|user)\s*:\s*[^,\n]*(\|\||\?\?)\s*['"][^'"]+['"]/i;
      expect(
        fallback.test(src),
        `${rel} falls back to a literal credential. A missing environment variable must fail, ` +
        `not silently connect — and a baked-in password survives rotation.`,
      ).toBe(false);
    });
  }
});
