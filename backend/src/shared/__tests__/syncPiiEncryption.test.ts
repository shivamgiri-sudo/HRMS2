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

async function loadWithBlindKey(blindKey: string | undefined) {
  vi.resetModules();
  process.env.FIELD_ENCRYPTION_KEY = REAL_KEY;
  if (blindKey === undefined) delete process.env.FIELD_BLIND_INDEX_KEY;
  else process.env.FIELD_BLIND_INDEX_KEY = blindKey;
  const mod = await import("../syncPiiEncryption.js");
  const fe = await import("../fieldEncryption.js");
  mod.__resetDevKeyWarningForTests();
  return { mod, fe };
}

const REAL_BLIND_KEY = "b".repeat(64);

describe("blindIndexPan", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("matches fieldEncryption.blindIndex for the same value", async () => {
    // The whole point of the index is that a row written by a route and a row written by
    // the backfill collide. If these two ever diverge, lookups silently return nothing.
    const { mod, fe } = await loadWithBlindKey(REAL_BLIND_KEY);
    expect(mod.blindIndexPan("ABCDE1234F")).toBe(fe.blindIndex("ABCDE1234F"));
  });

  it("normalises with trim only — never upper-cases", async () => {
    // scripts/statutory-identifier-encrypt-backfill.ts uses String(value).trim() and nothing
    // else. Upper-casing here would put every route-written row in a different index space
    // from every backfilled row.
    const { mod, fe } = await loadWithBlindKey(REAL_BLIND_KEY);
    expect(mod.blindIndexPan("  ABCDE1234F  ")).toBe(fe.blindIndex("ABCDE1234F"));
    expect(mod.blindIndexPan("abcde1234f")).toBe(fe.blindIndex("abcde1234f"));
    expect(mod.blindIndexPan("abcde1234f")).not.toBe(fe.blindIndex("ABCDE1234F"));
  });

  it("is deterministic, unlike the ciphertext", async () => {
    const { mod } = await loadWithBlindKey(REAL_BLIND_KEY);
    expect(mod.blindIndexPan("ABCDE1234F")).toBe(mod.blindIndexPan("ABCDE1234F"));
  });

  it("returns null when there is nothing to index", async () => {
    const { mod } = await loadWithBlindKey(REAL_BLIND_KEY);
    expect(mod.blindIndexPan(null)).toBeNull();
    expect(mod.blindIndexPan(undefined)).toBeNull();
    expect(mod.blindIndexPan("")).toBeNull();
    expect(mod.blindIndexPan("   ")).toBeNull();
  });

  it("REFUSES to index under the dev blind-index key, and warns once", async () => {
    // An index written with the wrong key is not detectably wrong — every lookup just
    // returns no rows, which the duplicate-employee guard reads as "no duplicate exists".
    const { mod } = await loadWithBlindKey(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(mod.blindIndexPan("ABCDE1234F")).toBeNull();
    expect(mod.blindIndexPan("ZZZZZ9999Z")).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("dev key");
  });
});

/**
 * Structural guard for the OTHER table. employee_statutory_info.pan_number holds 3,341
 * plaintext PANs against 0 ciphertext (measured live 2026-08-11) — migration 1123 added
 * pan_number_encrypted and pan_blind_index and nothing ever wrote them. These two routes are
 * the live writers, so if the dual-write is dropped the table starts rotting again from the
 * next HR entry and no behavioural test would catch it.
 */
describe("employee_statutory_info writers keep the PAN dual-write", () => {
  const EMPLOYEES = path.join(here, "..", "..", "modules", "employees");

  it("the HR-entry route writes ciphertext and blind index alongside the plaintext", () => {
    const src = fs.readFileSync(path.join(EMPLOYEES, "employee.routes.ts"), "utf8");
    expect(src).toContain(`addStat("pan_number_encrypted"`);
    expect(src).toContain(`addStat("pan_blind_index"`);
    expect(src).toContain("encryptPanForSync");
    expect(src).toContain("blindIndexPan");
  });

  it("the legacy statutory sync handler writes ciphertext and blind index alongside the plaintext", () => {
    // Dormant today (LEGACY_SYNC_ENABLED=false) but not harmless: its source,
    // db_bill.masjclrentry, holds 28,721 PANs (measured live 2026-08-11). Flipping that
    // flag without this would pour every one of them into employee_statutory_info as
    // plaintext with no ciphertext — re-creating the exact gap the other two writers just
    // closed. Re-enabling the flag is gated on this staying true.
    const src = fs.readFileSync(path.join(WORKERS, "statutory-sync-handler.ts"), "utf8");
    const start = src.indexOf("INSERT INTO employee_statutory_info");
    expect(start, "statutory INSERT missing").toBeGreaterThan(-1);
    const insert = src.slice(start, src.indexOf("ON DUPLICATE", start));
    expect(insert).toContain("pan_number");
    expect(insert).toContain("pan_number_encrypted");
    expect(insert).toContain("pan_blind_index");
    expect(src).toContain("encryptPanForSync");
    expect(src).toContain("blindIndexPan");
    // Direct calls would bypass the dev-key refusals.
    expect(src).not.toMatch(/\bencryptField\s*\(/);
    expect(src).not.toMatch(/\bblindIndex\s*\(/);
  });

  it("keys the statutory ciphertext rule to its own plaintext rule, so the columns cannot drift", () => {
    // This handler fills only when the INCOMING value is non-empty, unlike the employees
    // master handler which overwrites. The ciphertext and blind index must therefore switch
    // on VALUES(pan_number) — the plaintext's condition — and never on their own. Keying
    // them on VALUES(pan_number_encrypted) would leave the plaintext updated and the
    // ciphertext stale the first time the helper returns null.
    const src = fs.readFileSync(path.join(WORKERS, "statutory-sync-handler.ts"), "utf8");
    const dup = src.slice(src.indexOf("ON DUPLICATE"));
    expect(dup).toMatch(/pan_number_encrypted\s*=\s*IF\(\s*VALUES\(pan_number\)/);
    expect(dup).toMatch(/pan_blind_index\s*=\s*IF\(\s*VALUES\(pan_number\)/);
  });

  it("the employee-creation orchestrator writes ciphertext and blind index for new employees", () => {
    const src = fs.readFileSync(path.join(EMPLOYEES, "employee-creation-orchestrator.service.ts"), "utf8");
    const start = src.indexOf("INSERT INTO employee_statutory_info");
    expect(start).toBeGreaterThan(-1);
    const insert = src.slice(start, start + 600);
    expect(insert).toContain("pan_number");
    expect(insert).toContain("pan_number_encrypted");
    expect(insert).toContain("pan_blind_index");
    // Direct calls would bypass the dev-key refusals.
    expect(src).toContain("encryptPanForSync");
    expect(src).toContain("blindIndexPan");
    expect(src).not.toMatch(/\bencryptField\s*\(/);
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
