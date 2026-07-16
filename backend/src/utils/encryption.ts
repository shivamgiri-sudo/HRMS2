import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.BANK_ENCRYPTION_KEY || process.env.JWT_SECRET || "";
  return crypto.createHash("sha256").update(key).digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(ciphertext: string): string {
  const [ivHex, encHex] = ciphertext.split(":");
  if (!ivHex || !encHex) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
