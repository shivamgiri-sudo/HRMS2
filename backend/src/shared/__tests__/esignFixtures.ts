/**
 * In-memory fixtures for the eSign certificate-identity tests: real X.509
 * certificates and real PKCS#7 detached signatures, embedded in minimal PDF
 * signature dictionaries that carry a correct /ByteRange. No files, no network.
 */
import forge from "node-forge";

export type Party = { cn: string; issuerCn?: string };

const KEY_BITS = 1024; // test-only: keeps keygen fast
const CONTENTS_HEX_LEN = 8192; // zero-padded like a real signature placeholder
const NUM_W = 10;

const keyCache = new Map<string, forge.pki.rsa.KeyPair>();
function keyFor(name: string): forge.pki.rsa.KeyPair {
  const hit = keyCache.get(name);
  if (hit) return hit;
  const made = forge.pki.rsa.generateKeyPair(KEY_BITS);
  keyCache.set(name, made);
  return made;
}

function makeCert(subjectCn: string, issuerCn: string, subjectKeys: forge.pki.rsa.KeyPair, issuerKeys: forge.pki.rsa.KeyPair) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = subjectKeys.publicKey;
  cert.serialNumber = "01" + Math.floor(Math.random() * 1e12).toString(16);
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: "commonName", value: subjectCn }]);
  cert.setIssuer([{ name: "commonName", value: issuerCn }]);
  cert.sign(issuerKeys.privateKey, forge.md.sha256.create());
  return cert;
}

/** Hex of a PKCS#7 detached signature whose first embedded certificate is `party`'s (self-signed unless `issuerCn` is set). */
export function signatureHex(party: Party): string {
  const keys = keyFor(party.cn);
  const issuerCn = party.issuerCn ?? party.cn;
  const issuerKeys = party.issuerCn ? keyFor(`issuer:${party.issuerCn}`) : keys;
  const cert = makeCert(party.cn, issuerCn, keys, issuerKeys);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer("signed bytes");
  p7.addCertificate(cert);
  p7.addSigner({
    key: keys.privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary").toString("hex");
}

const pad = (n: number) => String(n).padStart(NUM_W, "0");

/**
 * Appends one signature as an incremental-update section, exactly the way a
 * signer does: /ByteRange [0 <before '<'> <after '>'> <rest>] where the rest
 * runs to the end of the file as it stands once this signature is appended.
 * `coversUpTo` overrides the end for tests that pin ordering to /ByteRange.
 */
export function appendSignature(pdf: Buffer, party: Party, opts: { coversUpTo?: number } = {}): Buffer {
  const hex = signatureHex(party).padEnd(CONTENTS_HEX_LEN, "0");
  const head = `\n7 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 ${pad(0)} ${pad(0)} ${pad(0)}] /Contents <`;
  const tail = `>\n>>\nendobj\n%%EOF\n`;
  const openAt = pdf.length + head.length - 1; // offset of '<'
  const afterAt = openAt + 1 + hex.length + 1; // offset just after '>'
  const total = pdf.length + head.length + hex.length + tail.length;
  const end = opts.coversUpTo ?? total;
  const real = head.replace(
    `[0 ${pad(0)} ${pad(0)} ${pad(0)}]`,
    `[0 ${pad(openAt)} ${pad(afterAt)} ${pad(end - afterAt)}]`,
  );
  return Buffer.concat([pdf, Buffer.from(real + hex + tail, "latin1")]);
}

/** A minimal unsigned PDF-looking base. */
export function basePdf(): Buffer {
  return Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Contents 2 0 R >>\nendobj\n%%EOF\n", "latin1");
}
