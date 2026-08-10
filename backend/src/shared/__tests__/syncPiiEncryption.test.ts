import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKERS = path.join(here, "..", "..", "workers", "domains");

/**
 * The keys are read once at module init, so each case has to set the environment BEFORE
 * importing. vi.resetModules() + dynamic import is the only way to exercise both the real-key
 * and dev-key paths in one file.
 */
async function loadWith(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = key;
  const mod = await import("../syncPiiEncryption.js");
  const fe = await import("../fieldEncryption.js");
  mod.__resetDevKeyWarningForTests();
  return { mod, fe };
}

const REAL_KEY = "a".repeat(64);
const DEV_KEY = "0".repeat(64);

describe("encryptPanForSync", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("produces ciphertext that decrypts back to the original PAN", async () => {
    const { mod, fe } = await loadWith(REAL_KEY);
    const ct = mod.encryptPanForSync("ABCDE1234F");
    expect(ct).toBeTypeOf("string");
    expect(ct).not.toContain("ABCDE1234F");        // never stored in the clear
    expect(fe.decryptField(ct as string)).toBe("ABCDE1234F");
  });

  it("trims before encrypting, so padding does not change the stored value", async () => {
    const { mod, fe } = await loadWith(REAL_KEY);
    expect(fe.decryptField(mod.encryptPanForSync("  ABCDE1234F  ") as string)).toBe("ABCDE1234F");
  });

  it("returns null when there is nothing to encrypt", async () => {
    const { mod } = await loadWith(REAL_KEY);
    expect(mod.encryptPanForSync(null)).toBeNull();
    expect(mod.encryptPanForSync(undefined)).toBeNull();
    expect(mod.encryptPanForSync("")).toBeNull();
    expect(mod.encryptPanForSync("   ")).toBeNull();
  });

  it("REFUSES to encrypt under the all-zeros dev key, and warns once", async () => {
    // This is the case that matters. loadKey() silently substitutes the dev key whenever
    // FIELD_ENCRYPTION_KEY is absent and NODE_ENV is not production, so a sync run from a
    // dev machine would otherwise write ciphertext production can never decrypt — with
    // nothing looking broken at the time.
    const { mod } = await loadWith(DEV_KEY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(mod.encryptPanForSync("ABCDE1234F")).toBeNull();
    expect(mod.encryptPanForSync("ZZZZZ9999Z")).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);                       // warn-once, not per row
    expect(warn.mock.calls[0][0]).toContain("dev key");
  });

  it("randomises the IV, so the same PAN does not produce a repeatable ciphertext", async () => {
    // A deterministic ciphertext would leak equality: anyone reading the column could tell
    // which employees share a PAN without decrypting anything.
    const { mod } = await loadWith(REAL_KEY);
    expect(mod.encryptPanForSync("ABCDE1234F")).not.toBe(mod.encryptPanForSync("ABCDE1234F"));
  });
});

/**
 * Structural guard. The dual-write is two lines of SQL inside a 45-column INSERT, which is
 * exactly the shape of change that gets dropped by an unrelated edit to the same statement
 * and is never noticed — new employees would silently arrive with plaintext PAN and no
 * ciphertext, and no test would fail.
 */
describe("legacy sync writers keep the PAN dual-write", () => {
  const FILES = ["employee-sync-handler.ts", "employee-master-sync-handler.ts"];

  it.each(FILES)("%s inserts pan_number_encrypted alongside pan_number", (file) => {
    const sql = fs.readFileSync(path.join(WORKERS, file), "utf8");
    const insert = sql.slice(sql.indexOf("INSERT INTO employees"), sql.indexOf("ON DUPLICATE"));
    expect(insert).toContain("pan_number");
    expect(insert).toContain("pan_number_encrypted");
    expect(insert).toContain("pan_enc_key_version");
  });

  it.each(FILES)("%s maintains the ciphertext on duplicate-key update", (file) => {
    const sql = fs.readFileSync(path.join(WORKERS, file), "utf8");
    const dup = sql.slice(sql.indexOf("ON DUPLICATE"));
    expect(dup).toContain("pan_number_encrypted");
  });

  it.each(FILES)("%s routes the value through encryptPanForSync, never encryptField directly", (file) => {
    const src = fs.readFileSync(path.join(WORKERS, file), "utf8");
    expect(src).toContain("encryptPanForSync");
    // Calling encryptField directly would bypass the dev-key refusal.
    expect(src).not.toMatch(/\bencryptField\s*\(/);
  });

  it("keeps the two writers' ciphertext rule matched to their own plaintext rule", () => {
    // The two handlers deliberately differ: one fills only when empty, the other overwrites.
    // The ciphertext must follow whichever rule its own file uses for the plaintext, or the
    // two columns drift apart.
    const fill = fs.readFileSync(path.join(WORKERS, "employee-sync-handler.ts"), "utf8");
    const fillDup = fill.slice(fill.indexOf("ON DUPLICATE"));
    expect(fillDup).toContain("pan_number = IF(pan_number IS NULL");
    expect(fillDup).toContain("pan_number_encrypted = IF(pan_number_encrypted IS NULL");

    const over = fs.readFileSync(path.join(WORKERS, "employee-master-sync-handler.ts"), "utf8");
    const overDup = over.slice(over.indexOf("ON DUPLICATE"));
    expect(overDup).toMatch(/pan_number\s*=\s*VALUES\(pan_number\)/);
    expect(overDup).toMatch(/pan_number_encrypted\s*=\s*VALUES\(pan_number_encrypted\)/);
  });
});
