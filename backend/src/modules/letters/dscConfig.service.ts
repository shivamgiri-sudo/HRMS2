/**
 * The company's signing certificate, managed by Super Admin.
 *
 * Two kinds are supported, and the difference is legally material rather than
 * cosmetic:
 *
 *   CA-issued  — a Class-3 organisation DSC from a CCA-licensed Certifying
 *                Authority. Satisfies IT Act 2000 s.3 and carries the s.85B
 *                evidentiary presumption. This is what a bank or court accepts.
 *
 *   self-signed — generated here, so the signing pipeline can be built and
 *                tested before a DSC is procured. Adobe reports "Signature
 *                validity is UNKNOWN" and no third party should rely on it.
 *
 * The kind is DERIVED by parsing the certificate — issuer versus subject, and
 * the issuer against the licensed-CA list — never taken from what the uploader
 * typed. A letter signed under a self-signed certificate carries a visible mark
 * saying so, and that mark cannot be removed without a real one.
 *
 * Private keys and passphrases are encrypted at rest and never leave this
 * module: every exported read returns metadata only.
 */
import { randomUUID, createHash } from "crypto";
import forge from "node-forge";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { encrypt, decrypt } from "../../utils/encryption.js";

/**
 * Certifying Authorities licensed by the Controller of Certifying Authorities.
 * Matched case-insensitively against the issuer, so an intermediate like
 * "eMudhra Sub CA for Class 3 Organisation 2022" still resolves.
 */
const LICENSED_CA_PATTERNS = [
  "emudhra", "e-mudhra", "sify", "safescrypt", "ncode", "(n)code", "gnfc",
  "capricorn", "vsign", "verasys", "xtratrust", "idsign", "prodigisign",
  "pantasign", "cdac", "c-dac", "nic certifying", "indiapki",
];

export type CertificateSummary = {
  id: string;
  label: string;
  subjectCn: string | null;
  issuerCn: string | null;
  serialNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprintSha256: string | null;
  isSelfSigned: boolean;
  isCaIssued: boolean;
  signerName: string;
  signerDesignation: string;
  activeStatus: boolean;
  uploadedAt: string | null;
  /** Derived: expired, or within 30 days of expiring. */
  expired: boolean;
  expiringSoon: boolean;
  /** Plain-language statement of what this certificate is worth legally. */
  legalStanding: string;
};

/** Internal only — carries key material. Never returned by a route. */
export type ActiveCertificate = {
  id: string;
  p12: Buffer;
  passphrase: string;
  signerName: string;
  signerDesignation: string;
  isCaIssued: boolean;
  isSelfSigned: boolean;
  validTo: Date | null;
};

function legalStandingFor(isCaIssued: boolean, isSelfSigned: boolean): string {
  if (isCaIssued) {
    return "CA-issued digital signature certificate. Satisfies IT Act 2000 s.3 and carries the s.85B evidentiary presumption.";
  }
  if (isSelfSigned) {
    return "Self-signed — NOT a CCA-licensed digital signature. Valid for internal tamper-evidence and testing only; PDF readers will report the signature as untrusted.";
  }
  return "Issuer is not a recognised CCA-licensed Certifying Authority. Treat as untrusted until verified.";
}

function cnOf(attrs: forge.pki.CertificateField[]): string | null {
  const cn = attrs.find((a) => a.shortName === "CN" || a.name === "commonName");
  return cn?.value ? String(cn.value) : null;
}

function issuerLooksLicensed(issuerCn: string | null, issuerO: string | null): boolean {
  const hay = `${issuerCn ?? ""} ${issuerO ?? ""}`.toLowerCase();
  return LICENSED_CA_PATTERNS.some((p) => hay.includes(p));
}

/** Parse a PKCS#12 and report what it actually contains. */
export function inspectP12(p12Buffer: Buffer, passphrase: string) {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Buffer.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);
  } catch {
    throw Object.assign(
      new Error("Could not open the certificate file. Check that it is a .pfx/.p12 and that the password is correct."),
      { statusCode: 400, code: "certificate_unreadable" },
    );
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const cert = certBags.map((b) => b.cert).find(Boolean);
  if (!cert) {
    throw Object.assign(new Error("The file contains no certificate."), { statusCode: 400, code: "certificate_missing" });
  }
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  if (!keyBags.some((b) => b.key)) {
    throw Object.assign(
      new Error("The file contains a certificate but no private key, so it cannot sign."),
      { statusCode: 400, code: "certificate_no_private_key" },
    );
  }

  const subjectCn = cnOf(cert.subject.attributes);
  const issuerCn = cnOf(cert.issuer.attributes);
  const issuerO = cert.issuer.attributes.find((a) => a.shortName === "O")?.value ?? null;

  // Self-signed when the issuer is the subject. Derived, never declared.
  const isSelfSigned =
    JSON.stringify(cert.issuer.attributes.map((a) => [a.shortName, a.value])) ===
    JSON.stringify(cert.subject.attributes.map((a) => [a.shortName, a.value]));

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprint = createHash("sha256").update(Buffer.from(der, "binary")).digest("hex")
    .toUpperCase().match(/.{2}/g)!.join(":");

  return {
    subjectCn,
    issuerCn,
    issuerO: issuerO ? String(issuerO) : null,
    serialNumber: cert.serialNumber ?? null,
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
    fingerprintSha256: fingerprint,
    isSelfSigned,
    isCaIssued: !isSelfSigned && issuerLooksLicensed(issuerCn, issuerO ? String(issuerO) : null),
  };
}

/**
 * Create a working certificate immediately, so issuance is not blocked while a
 * real DSC is procured. Clearly marked as self-signed everywhere it surfaces.
 */
export function generateSelfSignedP12(params: {
  organisation: string;
  signerName: string;
  validityYears?: number;
  passphrase: string;
}): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01" + randomUUID().replace(/-/g, "").slice(0, 18);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + (params.validityYears ?? 2));

  const attrs: forge.pki.CertificateField[] = [
    { name: "commonName", value: params.organisation },
    { name: "organizationName", value: params.organisation },
    { name: "countryName", value: "IN" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // self-signed: issuer === subject
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
    { name: "extKeyUsage", emailProtection: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], params.passphrase, {
    algorithm: "3des",
    friendlyName: params.signerName,
  });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}

function toSummary(r: RowDataPacket): CertificateSummary {
  const validTo = r.valid_to ? new Date(r.valid_to as string) : null;
  const now = Date.now();
  const isCaIssued = Number(r.is_ca_issued) === 1;
  const isSelfSigned = Number(r.is_self_signed) === 1;
  return {
    id: String(r.id),
    label: String(r.label ?? ""),
    subjectCn: (r.subject_cn as string) ?? null,
    issuerCn: (r.issuer_cn as string) ?? null,
    serialNumber: (r.serial_number as string) ?? null,
    validFrom: r.valid_from ? new Date(r.valid_from as string).toISOString() : null,
    validTo: validTo ? validTo.toISOString() : null,
    fingerprintSha256: (r.fingerprint_sha256 as string) ?? null,
    isSelfSigned,
    isCaIssued,
    signerName: String(r.signer_name ?? ""),
    signerDesignation: String(r.signer_designation ?? ""),
    activeStatus: Number(r.active_status) === 1,
    uploadedAt: r.uploaded_at ? new Date(r.uploaded_at as string).toISOString() : null,
    expired: Boolean(validTo && validTo.getTime() < now),
    expiringSoon: Boolean(validTo && validTo.getTime() >= now && validTo.getTime() - now < 30 * 24 * 3600 * 1000),
    legalStanding: legalStandingFor(isCaIssued, isSelfSigned),
  };
}

async function audit(certificateId: string | null, action: string, actorUserId: string | null, detail: unknown) {
  await db.execute(
    `INSERT INTO company_signing_certificate_audit (id, certificate_id, action, actor_user_id, detail_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
    [randomUUID(), certificateId, action, actorUserId, JSON.stringify(detail ?? {})],
  ).catch(() => undefined);
}

/** Metadata for every certificate. Never includes key material. */
export async function listCertificates(): Promise<CertificateSummary[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, label, subject_cn, issuer_cn, serial_number, valid_from, valid_to,
            fingerprint_sha256, is_self_signed, is_ca_issued, signer_name,
            signer_designation, active_status, uploaded_at
       FROM company_signing_certificate
      ORDER BY active_status DESC, uploaded_at DESC`,
  );
  return (rows as RowDataPacket[]).map(toSummary);
}

export async function storeCertificate(params: {
  label: string;
  p12: Buffer;
  passphrase: string;
  signerName: string;
  signerDesignation: string;
  actorUserId: string | null;
  activate?: boolean;
  origin: "uploaded" | "generated";
}): Promise<CertificateSummary> {
  const info = inspectP12(params.p12, params.passphrase);

  if (info.validTo.getTime() < Date.now()) {
    throw Object.assign(
      new Error(`This certificate expired on ${info.validTo.toISOString().slice(0, 10)} and cannot be used to sign.`),
      { statusCode: 400, code: "certificate_expired" },
    );
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO company_signing_certificate
       (id, label, subject_cn, issuer_cn, serial_number, valid_from, valid_to,
        fingerprint_sha256, is_self_signed, is_ca_issued, p12_encrypted,
        passphrase_encrypted, signer_name, signer_designation, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, params.label, info.subjectCn, info.issuerCn, info.serialNumber,
      info.validFrom, info.validTo, info.fingerprintSha256,
      info.isSelfSigned ? 1 : 0, info.isCaIssued ? 1 : 0,
      encrypt(params.p12.toString("base64")),
      encrypt(params.passphrase),
      params.signerName, params.signerDesignation, params.actorUserId,
    ],
  );
  await audit(id, params.origin === "generated" ? "GENERATE" : "UPLOAD", params.actorUserId, {
    label: params.label, issuerCn: info.issuerCn, isCaIssued: info.isCaIssued, isSelfSigned: info.isSelfSigned,
  });

  if (params.activate) await activateCertificate(id, params.actorUserId);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, label, subject_cn, issuer_cn, serial_number, valid_from, valid_to,
            fingerprint_sha256, is_self_signed, is_ca_issued, signer_name,
            signer_designation, active_status, uploaded_at
       FROM company_signing_certificate WHERE id = ?`, [id],
  );
  return toSummary((rows as RowDataPacket[])[0]);
}

/** Exactly one certificate is active; activating one stands the others down. */
export async function activateCertificate(id: string, actorUserId: string | null): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, valid_to FROM company_signing_certificate WHERE id = ?`, [id]);
  const row = (rows as RowDataPacket[])[0];
  if (!row) throw Object.assign(new Error("Certificate not found"), { statusCode: 404 });
  if (row.valid_to && new Date(row.valid_to as string).getTime() < Date.now()) {
    throw Object.assign(
      new Error("That certificate has expired. Upload a current one before activating."),
      { statusCode: 400, code: "certificate_expired" },
    );
  }

  await db.execute(
    `UPDATE company_signing_certificate
        SET active_status = 0, active_marker = NULL, deactivated_at = NOW()
      WHERE active_marker = 'Y'`);
  await db.execute(
    `UPDATE company_signing_certificate
        SET active_status = 1, active_marker = 'Y', deactivated_at = NULL
      WHERE id = ?`, [id]);
  await audit(id, "ACTIVATE", actorUserId, {});
}

/**
 * The credential to sign with. Internal use only — the caller receives the
 * private key, so this must never be reachable from a route.
 */
export async function getActiveCertificate(): Promise<ActiveCertificate | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, p12_encrypted, passphrase_encrypted, signer_name, signer_designation,
            is_ca_issued, is_self_signed, valid_to
       FROM company_signing_certificate
      WHERE active_marker = 'Y' LIMIT 1`,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const r = (rows as RowDataPacket[])[0];
  if (!r) return null;

  return {
    id: String(r.id),
    p12: Buffer.from(decrypt(String(r.p12_encrypted)), "base64"),
    passphrase: r.passphrase_encrypted ? decrypt(String(r.passphrase_encrypted)) : "",
    signerName: String(r.signer_name ?? ""),
    signerDesignation: String(r.signer_designation ?? ""),
    isCaIssued: Number(r.is_ca_issued) === 1,
    isSelfSigned: Number(r.is_self_signed) === 1,
    validTo: r.valid_to ? new Date(r.valid_to as string) : null,
  };
}

export async function deleteCertificate(id: string, actorUserId: string | null): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT active_status FROM company_signing_certificate WHERE id = ?`, [id]);
  const r = (rows as RowDataPacket[])[0];
  if (!r) throw Object.assign(new Error("Certificate not found"), { statusCode: 404 });
  if (Number(r.active_status) === 1) {
    throw Object.assign(
      new Error("That certificate is currently active. Activate a different one before removing it."),
      { statusCode: 409, code: "certificate_active" },
    );
  }
  await db.execute(`DELETE FROM company_signing_certificate WHERE id = ?`, [id]);
  await audit(id, "DELETE", actorUserId, {});
}
