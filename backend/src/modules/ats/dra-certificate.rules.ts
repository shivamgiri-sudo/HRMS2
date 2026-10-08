/**
 * DRA (Debt Recovery Agent) certificate: reading and judging the uploaded document.
 *
 * Pure functions, no I/O, so every rule is unit-testable. The service layer feeds them OCR /
 * PDF text and the candidate's onboarding data.
 *
 * IIBF has no public API we can call, and its portal verifies four printed details: membership /
 * registration number, certificate serial number, certificate date and the security code. This
 * module reads those four from the document and runs every check that needs no portal. It NEVER
 * returns "verified" on its own: the strongest automatic outcome is `pending` with
 * `autoChecksPassed = true`, meaning "everything readable is consistent, HR may confirm on the
 * IIBF portal". An IIBF connector can later set the final status through the service.
 */

export type DraStatus = "pending" | "verified" | "invalid" | "expired" | "mismatch";

/** Cost centres on which the DRA certificate is mandatory (SBI Credit Card process). */
export const DRA_COST_CENTRE_CODES: readonly string[] = ["BSS/OB/AHMH-JD/1050"];

export function isDraCostCentre(code: string | null | undefined): boolean {
  const c = String(code ?? "").trim().toUpperCase();
  return !!c && DRA_COST_CENTRE_CODES.includes(c);
}

export interface DraParsed {
  name: string | null;
  registrationNo: string | null;
  serialNo: string | null;
  securityCode: string | null;
  /** ISO yyyy-mm-dd */
  certificateDate: string | null;
  validUntil: string | null;
  looksLikeDra: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DATE_RE = String.raw`(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}[\s\-]+[A-Za-z]{3,9}[\s,\-]+\d{4})`;

/** dd/mm/yyyy, dd-mm-yy, dd Mon yyyy → yyyy-mm-dd, or null when it is not a real date. */
export function parseIndianDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let d: number, m: number, y: number;
  let match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (match) {
    d = +match[1]; m = +match[2]; y = +match[3];
  } else {
    match = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s,\-]+(\d{4})$/);
    if (!match) return null;
    d = +match[1]; m = MONTHS[match[2].slice(0, 3).toLowerCase()] ?? 0; y = +match[3];
  }
  if (y < 100) y += 2000;
  if (!m || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 31 Feb etc.
  return dt.toISOString().slice(0, 10);
}

const clean = (v: string | undefined | null) => (v ? v.replace(/\s+/g, "").toUpperCase() : null);

export function parseDraCertificateText(rawText: string): DraParsed {
  const text = String(rawText ?? "").replace(/\r/g, "\n");
  const flat = text.replace(/\s+/g, " ");

  const looksLikeDra =
    /\bDRA\b|debt\s*recovery\s*agent/i.test(flat) &&
    /\bIIBF\b|indian\s+institute\s+of\s+banking/i.test(flat);

  const grab = (re: RegExp) => flat.match(re)?.[1] ?? null;

  const registrationNo = clean(
    grab(/(?:membership|registration|member|reg\.?)\s*(?:no\.?|number|id)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9\/-]{4,24})/i),
  );
  const serialNo = clean(
    grab(/(?:certificate|cert\.?)\s*(?:serial\s*)?(?:no\.?|number)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9\/-]{3,29})/i) ??
      grab(/serial\s*(?:no\.?|number)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9\/-]{3,29})/i),
  );
  const securityCode = clean(grab(/security\s*(?:code|key)\s*[:\-.]?\s*([A-Z0-9]{4,16})/i));

  const certificateDate = parseIndianDate(
    grab(new RegExp(String.raw`(?:certificate\s*)?date(?:\s*of\s*(?:issue|certificate|passing|examination))?\s*[:\-.]?\s*${DATE_RE}`, "i")),
  );
  const validUntil = parseIndianDate(
    grab(new RegExp(String.raw`(?:valid(?:ity)?\s*(?:up\s*to|upto|till|until|through|date)|expiry(?:\s*date)?|expires?\s*on)\s*[:\-.]?\s*${DATE_RE}`, "i")),
  );

  let name =
    grab(/(?:certif(?:y|ies)\s+that)\s+(?:(?:mr|mrs|ms|shri|smt|dr)\.?\s+)?([A-Za-z][A-Za-z .]{2,60}?)(?=\s+(?:has|having|bearing|son|daughter|s\/o|d\/o|w\/o|holder|with|membership|registration|passed|is)\b|[,\n])/i) ??
    grab(/\bname\s*(?:of\s*(?:the\s*)?(?:candidate|member))?\s*[:\-]\s*(?:(?:mr|mrs|ms|shri|smt)\.?\s+)?([A-Za-z][A-Za-z .]{2,60}?)(?=\s{2,}|\s+(?:membership|registration|certificate|date|dob)\b|$)/i);
  name = name ? name.replace(/\s+/g, " ").trim() : null;

  return { name, registrationNo, serialNo, securityCode, certificateDate, validUntil, looksLikeDra };
}

const normName = (n: string) =>
  n.toUpperCase().replace(/\b(MR|MRS|MS|DR|SHRI|SMT)\.?\b/g, " ").replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();

/** 0..1 — share of the shorter name's tokens found in the longer (order-insensitive, tolerant of an initial). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const ta = normName(a).split(" ").filter(Boolean);
  const tb = normName(b).split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const pool = [...long];
  let hit = 0;
  for (const t of short) {
    const i = pool.findIndex((x) => x === t || (t.length === 1 && x.startsWith(t)) || (x.length === 1 && t.startsWith(x)));
    if (i >= 0) { hit++; pool.splice(i, 1); }
  }
  return hit / short.length;
}

export const NAME_MATCH_MIN = 0.6;

export interface DraDetails {
  registrationNo: string | null;
  serialNo: string | null;
  securityCode: string | null;
  /** ISO yyyy-mm-dd */
  certificateDate: string | null;
}

const alnum = (v: string | null | undefined) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Candidate-typed details vs what was read off the document. Only fields present on BOTH sides are compared. */
export function findDetailDisagreement(entered: Partial<DraDetails>, read: Partial<DraDetails>): string | null {
  const diffs: string[] = [];
  const cmp = (label: string, a?: string | null, b?: string | null) => {
    if (a && b && alnum(a) !== alnum(b)) diffs.push(`${label}: typed "${a}", certificate shows "${b}"`);
  };
  cmp("registration no.", entered.registrationNo, read.registrationNo);
  cmp("serial no.", entered.serialNo, read.serialNo);
  cmp("security code", entered.securityCode, read.securityCode);
  if (entered.certificateDate && read.certificateDate && entered.certificateDate !== read.certificateDate) {
    diffs.push(`certificate date: typed ${entered.certificateDate}, certificate shows ${read.certificateDate}`);
  }
  return diffs.length ? `Typed details differ from the certificate (${diffs.join("; ")}).` : null;
}

/** Light format checks on what the candidate typed. Returns the problems, empty when fine. */
export function validateEnteredDetails(d: Partial<DraDetails>, today: string): string[] {
  const errs: string[] = [];
  if (alnum(d.registrationNo).length < 5) errs.push("Enter the membership / registration number exactly as printed.");
  if (alnum(d.serialNo).length < 4) errs.push("Enter the certificate serial number exactly as printed.");
  if (alnum(d.securityCode).length < 4) errs.push("Enter the security code printed on the certificate.");
  if (!d.certificateDate || !/^\d{4}-\d{2}-\d{2}$/.test(d.certificateDate)) errs.push("Enter the certificate date.");
  else if (d.certificateDate > today) errs.push("Certificate date cannot be in the future.");
  return errs;
}

export interface DraEvaluationInput {
  parsed: DraParsed;
  /** Full text length, to tell "unreadable" from "readable but not a DRA certificate". */
  textLength: number;
  profileName: string | null;
  /** yyyy-mm-dd of "today" (injected for tests). */
  today: string;
  /** Another candidate already holds this registration / serial number. */
  duplicateOf?: string | null;
  /** Set when the candidate's typed details disagree with the document (see findDetailDisagreement). */
  disagreement?: string | null;
  /** Result of comparing the certificate photo with the live selfie, when it ran. */
  face?: { status: string; matched: boolean; score: number } | null;
}

export interface DraEvaluation {
  status: DraStatus;
  reason: string | null;
  nameMatchScore: number | null;
  /** True only when the document is readable, in date, matches the candidate and every IIBF detail was read. */
  autoChecksPassed: boolean;
}

export function evaluateDraCertificate(i: DraEvaluationInput): DraEvaluation {
  const { parsed: p } = i;
  const nameScore = p.name && i.profileName ? Math.round(nameSimilarity(p.name, i.profileName) * 100) : null;
  const out = (status: DraStatus, reason: string | null, autoChecksPassed = false): DraEvaluation => ({
    status, reason, nameMatchScore: nameScore, autoChecksPassed,
  });

  if (i.textLength < 20) {
    return out("pending", "The document could not be read automatically (scan too faint or an image-only PDF). HR to review it manually.");
  }
  if (!p.looksLikeDra) {
    return out("invalid", "This does not look like an IIBF DRA certificate (no DRA / IIBF wording found). Please upload the certificate issued by IIBF.");
  }
  if (i.duplicateOf) {
    return out("mismatch", `This registration / serial number is already used on another candidate's onboarding (${i.duplicateOf}).`);
  }
  if (i.disagreement) return out("mismatch", i.disagreement);
  if (p.validUntil && p.validUntil < i.today) {
    return out("expired", `The certificate expired on ${p.validUntil}.`);
  }
  if (p.name && i.profileName && nameScore! < NAME_MATCH_MIN * 100) {
    return out("mismatch", `Name on certificate "${p.name}" does not match the onboarding name "${i.profileName}".`);
  }
  if (i.face && i.face.status !== "no_face_detected" && i.face.matched === false) {
    return out("mismatch", `Photo on the certificate does not match the live selfie (score ${i.face.score}).`);
  }

  const missing: string[] = [];
  if (!p.name) missing.push("candidate name");
  if (!p.registrationNo) missing.push("membership / registration number");
  if (!p.serialNo) missing.push("certificate serial number");
  if (!p.certificateDate) missing.push("certificate date");
  if (!p.securityCode) missing.push("security code");
  if (missing.length) {
    return out("pending", `Could not read: ${missing.join(", ")}. HR to read these from the document and confirm on the IIBF portal.`);
  }
  return out(
    "pending",
    p.validUntil
      ? "Details read and consistent with the candidate. Awaiting confirmation on the IIBF portal."
      : "Details read and consistent with the candidate; no validity date is printed. Awaiting confirmation on the IIBF portal.",
    true,
  );
}

/** HR-facing label for each status. */
export const DRA_STATUS_LABEL: Record<DraStatus | "not_uploaded", string> = {
  verified: "Verified",
  pending: "Pending Verification",
  invalid: "Invalid",
  expired: "Expired",
  mismatch: "Mismatch / Verification Failed",
  not_uploaded: "Not uploaded",
};
