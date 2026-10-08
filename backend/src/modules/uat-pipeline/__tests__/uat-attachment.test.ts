import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_MIME,
  MAX_ATTACHMENT_BYTES,
  UAT_ATTACHMENT_ROOT,
  decryptAttachment,
  encryptAttachment,
  sniffMime,
} from "../uat-attachment.service.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Minimal but genuinely-shaped file headers. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const GIF = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(16)]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii"), Buffer.alloc(16),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PDF = Buffer.concat([Buffer.from("%PDF-1.7", "ascii"), Buffer.alloc(16)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)]);

describe("attachment type detection", () => {
  it("recognises the four accepted screenshot formats by their bytes", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(GIF)).toBe("image/gif");
    expect(sniffMime(WEBP)).toBe("image/webp");
    for (const m of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(ALLOWED_MIME.has(m), `${m} should be accepted`).toBe(true);
    }
  });

  it("rejects SVG — it is scriptable XML that a browser will execute", () => {
    expect(sniffMime(SVG)).toBeNull();
    expect(ALLOWED_MIME.has("image/svg+xml")).toBe(false);
  });

  it("rejects documents and archives, which are delivery vehicles rather than evidence", () => {
    expect(sniffMime(PDF)).toBeNull();
    expect(sniffMime(ZIP)).toBeNull();
    for (const m of ["application/pdf", "application/zip", "text/html", "application/octet-stream"]) {
      expect(ALLOWED_MIME.has(m), `${m} must not be accepted`).toBe(false);
    }
  });

  it("is not fooled by a hostile payload renamed to look like an image", () => {
    // The declared type and the extension are both attacker-controlled; the bytes are not.
    const disguised = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(32)]); // PE executable
    expect(sniffMime(disguised)).toBeNull();
  });

  it("returns null for anything too short to identify", () => {
    expect(sniffMime(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
});

describe("attachment encryption at rest", () => {
  const secret = Buffer.from("PAYSLIP NET PAY 42500 EMP12345 RAMESH KUMAR", "utf8");

  it("round-trips exactly", () => {
    expect(decryptAttachment(encryptAttachment(secret)).equals(secret)).toBe(true);
  });

  it("the stored bytes do not contain the plaintext", () => {
    // The point of the exercise: a stolen backup or filesystem read yields nothing readable.
    const blob = encryptAttachment(secret);
    expect(blob.includes(Buffer.from("42500"))).toBe(false);
    expect(blob.includes(Buffer.from("RAMESH"))).toBe(false);
    expect(blob.includes(secret)).toBe(false);
  });

  it("uses a fresh data key per object, so two identical files differ on disk", () => {
    const a = encryptAttachment(secret);
    const b = encryptAttachment(secret);
    expect(a.equals(b)).toBe(false);
    // ...and both still decrypt correctly.
    expect(decryptAttachment(a).equals(secret)).toBe(true);
    expect(decryptAttachment(b).equals(secret)).toBe(true);
  });

  it("detects tampering rather than returning altered bytes", () => {
    const blob = encryptAttachment(secret);
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => decryptAttachment(tampered)).toThrow();
  });

  it("rejects a file that is not in the expected format", () => {
    expect(() => decryptAttachment(Buffer.from("not an attachment at all"))).toThrow(
      /not in the expected format/
    );
  });

  it("handles an empty payload and a large one", () => {
    expect(decryptAttachment(encryptAttachment(Buffer.alloc(0))).length).toBe(0);
    const big = Buffer.alloc(1024 * 1024, 0xab);
    expect(decryptAttachment(encryptAttachment(big)).equals(big)).toBe(true);
  });
});

describe("attachment storage location and limits", () => {
  it("stores under private-storage, never the statically-served uploads directory", () => {
    // app.ts mounts express.static on /uploads. Anything written there is fetchable by URL,
    // which for a payslip screenshot would be a straightforward data leak.
    const root = UAT_ATTACHMENT_ROOT.replace(/\\/g, "/");
    expect(root).toContain("/private-storage/uat-attachments");
    expect(root).not.toContain("/uploads");
  });

  it("caps uploads at 5 MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("attachments never leave the backend", () => {
  const moduleDir = resolve(HERE, "..");
  const service = readFileSync(resolve(moduleDir, "uat-attachment.service.ts"), "utf8");
  const routes = readFileSync(resolve(moduleDir, "uat-pipeline.routes.ts"), "utf8");
  const notifications = readFileSync(resolve(moduleDir, "uat-notification.service.ts"), "utf8");

  it("the notification payload never carries attachment bytes or storage keys", () => {
    // Notifications leave through email and push, which are not PII-controlled surfaces.
    expect(notifications).not.toMatch(/storage_key|readAttachment|attachment.*buffer/i);
  });

  it("uploads are buffered in memory, never written as plaintext first", () => {
    expect(routes).toContain("multer.memoryStorage()");
    expect(routes).not.toContain("multer.diskStorage");
  });

  it("the only write to disk goes through the encrypting path", () => {
    // A second writeFile that skipped encryptAttachment() would silently land plaintext.
    const writes = [...service.matchAll(/writeFile\(/g)].length;
    const encryptedWrites = [...service.matchAll(/writeFile\([^)]*encryptAttachment\(/g)].length;
    expect(writes, "every writeFile must encrypt").toBe(encryptedWrites);
  });

  it("the download route sets nosniff and forces a download rather than inline render", () => {
    expect(routes).toContain('"X-Content-Type-Options", "nosniff"');
    expect(routes).toMatch(/Content-Disposition[\s\S]{0,80}attachment;/);
    expect(routes).toContain('"Cache-Control", "private, no-store"');
  });

  it("the download filename is sanitised before it reaches a header", () => {
    // An unsanitised filename in Content-Disposition is a header-injection and traversal risk.
    expect(routes).toMatch(/filename\.replace\(\/\[\^A-Za-z0-9\._-\]\/g/);
  });

  it("path traversal out of the attachment root is checked explicitly", () => {
    expect(service).toContain("startsWith(path.resolve(UAT_ATTACHMENT_ROOT)");
  });
});
