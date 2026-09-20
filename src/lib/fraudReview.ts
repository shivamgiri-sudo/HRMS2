/**
 * Plain-language layer for the fraud review screen.
 *
 * The backend raises alerts with codes like DUPLICATE_AADHAAR. A reviewer needs to
 * know, in words: what looks wrong, who it involves, whether the evidence says
 * "same person" or "different people", and what they are being asked to decide.
 * Everything here is pure (no React, no network) so it can be tested on its own.
 *
 * Evidence is tagged by how much it can be trusted: government-verified values
 * (DigiLocker) outrank what a candidate typed, and anything read off a photo by
 * a machine (OCR) is labelled as possibly wrong and never treated as proof.
 */

export type Source = "govt" | "typed" | "photo" | "system";
export type RowState = "same" | "diff" | "na";
export type VerdictLevel = "different" | "same" | "unsure";
export type AlertKind = "identity" | "face" | "number" | "other";

export interface GovtIdentity {
  name: string | null;
  dob: string | null;
  gender: string | null;
  aadhaarLast4: string | null;
}

export interface IdentitySnapshot {
  candidateId: string;
  code: string | null;
  displayName: string | null;
  name: string | null;
  dob: string | null;
  gender: string | null;
  fatherName: string | null;
  mobileMasked: string | null;
  aadhaarLast4: string | null;
  panMasked: string | null;
  govt: GovtIdentity | null;
  selfieDocId: string | null;
  hasDigilockerPhoto: boolean;
  employee: { code: string; name: string | null; status: string | null; joinedOn: string | null } | null;
}

export interface IdentityComparison {
  subject: IdentitySnapshot;
  other: IdentitySnapshot | null;
  sharedMobile: boolean | null;
  sharedDevice: boolean | null;
}

export interface Cell {
  value: string;
  source: Source;
}

export interface CompareRow {
  key: string;
  label: string;
  left: Cell | null;
  right: Cell | null;
  state: RowState;
  /** How much a difference in this row weighs when deciding "different people". */
  weight: number;
}

export interface VerdictReason {
  tone: "bad" | "ok" | "warn" | "info";
  text: string;
}

export interface Verdict {
  level: VerdictLevel;
  headline: string;
  strength: string;
  reasons: VerdictReason[];
}

// ── Alert wording ────────────────────────────────────────────────────────────

interface AlertCopy {
  kind: AlertKind;
  short: string;
  title: (otherName?: string | null) => string;
}

const used = (what: string) => (n?: string | null) =>
  n ? `${what} is already used by ${n}` : `${what} is already used by someone else`;

const ALERT_COPY: Record<string, AlertCopy> = {
  DUPLICATE_AADHAAR: { kind: "identity", short: "Aadhaar number already used", title: used("This Aadhaar number") },
  DUPLICATE_PAN: { kind: "identity", short: "PAN already used", title: used("This PAN") },
  DUPLICATE_BANK_ACCOUNT: { kind: "identity", short: "Bank account already used", title: used("This bank account") },
  REPEAT_APPLICANT: {
    kind: "identity",
    short: "Applied before",
    title: (n) => (n ? `This person appears to have applied before as ${n}` : "This person appears to have applied before"),
  },
  FACE_MISMATCH: {
    kind: "face",
    short: "Selfie does not match the ID photo",
    title: () => "The selfie does not look like the photo on the ID",
  },
  DOCUMENT_NUMBER_MISMATCH: {
    kind: "number",
    short: "Typed number differs from the document",
    title: () => "The number typed differs from the number read off the document",
  },
  CHEQUE_ACCOUNT_MISMATCH: {
    kind: "number",
    short: "Cheque account number differs",
    title: () => "The account number on the cheque differs from the one typed",
  },
};

function fallbackWords(type: string): string {
  const w = type.replace(/_/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function alertKind(type: string): AlertKind {
  return ALERT_COPY[type]?.kind ?? "other";
}

export function alertShort(type: string): string {
  return ALERT_COPY[type]?.short ?? fallbackWords(type);
}

export function alertTitle(type: string, otherName?: string | null): string {
  return ALERT_COPY[type]?.title(otherName) ?? `The system flagged this profile: ${fallbackWords(type).toLowerCase()}`;
}

export interface AlertLike {
  status: string;
  severity: string;
}

/** Waiting for a decision. */
export function isUnresolved(a: AlertLike): boolean {
  return a.status === "open" || a.status === "under_review";
}

/** Unresolved and serious enough that approval / hiring must wait. */
export function isBlocking(a: AlertLike): boolean {
  const s = String(a.severity).toLowerCase();
  return isUnresolved(a) && (s === "critical" || s === "high");
}

export function waitingText(createdAt?: string | null, now: Date = new Date()): string {
  if (!createdAt) return "";
  const t = new Date(String(createdAt).replace(" ", "T"));
  if (Number.isNaN(t.getTime())) return "";
  const days = Math.floor((now.getTime() - t.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

// ── Comparison helpers ───────────────────────────────────────────────────────

export function formatDob(iso: string | null | undefined): string | null {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function tokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Indian-name tolerant: word order, dropped middle names and initials ("R. Verma" vs
 * "Rahul Verma") are fine. Two names agree when at least half the words of the
 * shorter one appear in the other.
 */
export function namesAgree(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const hit = short.filter((t) => long.some((u) => u === t || (t.length === 1 && u.startsWith(t)) || (u.length === 1 && t.startsWith(u))));
  return hit.length / short.length >= 0.5;
}

const normGender = (g: string | null | undefined): string | null => {
  const v = String(g ?? "").trim().toLowerCase();
  if (v === "m" || v === "male") return "Male";
  if (v === "f" || v === "female") return "Female";
  return v ? "Other" : null;
};

const aadhaarText = (last4: string | null) => (last4 ? `XXXX-XXXX-${last4}` : null);

interface Pick {
  cell: Cell;
  raw: string;
}

function pickName(p: IdentitySnapshot): Pick | null {
  if (p.govt?.name) return { cell: { value: p.govt.name, source: "govt" }, raw: p.govt.name };
  return p.name ? { cell: { value: p.name, source: "typed" }, raw: p.name } : null;
}
function pickDob(p: IdentitySnapshot): Pick | null {
  const iso = p.govt?.dob ?? p.dob;
  const text = formatDob(iso);
  return iso && text ? { cell: { value: text, source: p.govt?.dob ? "govt" : "typed" }, raw: iso } : null;
}
function pickGender(p: IdentitySnapshot): Pick | null {
  const g = normGender(p.govt?.gender ?? p.gender);
  return g ? { cell: { value: g, source: p.govt?.gender ? "govt" : "typed" }, raw: g } : null;
}
function pickAadhaar(p: IdentitySnapshot): Pick | null {
  const l = p.govt?.aadhaarLast4 ?? p.aadhaarLast4;
  const text = aadhaarText(l);
  return l && text ? { cell: { value: text, source: p.govt?.aadhaarLast4 ? "govt" : "typed" }, raw: l } : null;
}

function row(
  key: string,
  label: string,
  weight: number,
  l: Pick | null,
  r: Pick | null,
  eq: (a: string, b: string) => boolean,
): CompareRow {
  const state: RowState = l && r ? (eq(l.raw, r.raw) ? "same" : "diff") : "na";
  return { key, label, left: l?.cell ?? null, right: r?.cell ?? null, state, weight };
}

const exact = (a: string, b: string) => a === b;

/** This candidate on the left, the person the alert matched on the right. */
export function buildPersonRows(cmp: IdentityComparison): CompareRow[] {
  const a = cmp.subject;
  const b = cmp.other;
  if (!b) return [];
  const rows: CompareRow[] = [
    row("name", "Name", 1, pickName(a), pickName(b), namesAgree),
    row("dob", "Date of birth", 2, pickDob(a), pickDob(b), exact),
    row("gender", "Gender", 2, pickGender(a), pickGender(b), exact),
    row(
      "father",
      "Father's name",
      1,
      a.fatherName ? { cell: { value: a.fatherName, source: "typed" }, raw: a.fatherName } : null,
      b.fatherName ? { cell: { value: b.fatherName, source: "typed" }, raw: b.fatherName } : null,
      namesAgree,
    ),
    row(
      "mobile",
      "Mobile",
      0,
      a.mobileMasked ? { cell: { value: a.mobileMasked, source: "typed" }, raw: a.mobileMasked } : null,
      b.mobileMasked ? { cell: { value: b.mobileMasked, source: "typed" }, raw: b.mobileMasked } : null,
      exact,
    ),
    row("aadhaar", "Aadhaar", 3, pickAadhaar(a), pickAadhaar(b), exact),
    row(
      "pan",
      "PAN",
      2,
      a.panMasked ? { cell: { value: a.panMasked, source: "typed" }, raw: a.panMasked } : null,
      b.panMasked ? { cell: { value: b.panMasked, source: "typed" }, raw: b.panMasked } : null,
      exact,
    ),
  ];
  if (cmp.sharedDevice !== null) {
    const text = cmp.sharedDevice ? "Same phone and network" : "Different phone or network";
    rows.push({
      key: "device",
      label: "Form filled from",
      left: { value: text, source: "system" },
      right: { value: text, source: "system" },
      state: cmp.sharedDevice ? "same" : "diff",
      weight: 0,
    });
  }
  return rows;
}

/** One person: what they typed against what the government record says. */
export function buildSelfRows(p: IdentitySnapshot): CompareRow[] {
  const typed = (v: string | null, raw = v): Pick | null => (v ? { cell: { value: v, source: "typed" }, raw: raw ?? v } : null);
  const govt = (v: string | null, raw = v): Pick | null => (v ? { cell: { value: v, source: "govt" }, raw: raw ?? v } : null);
  const g = p.govt;
  return [
    row("name", "Name", 1, typed(p.name), govt(g?.name ?? null), namesAgree),
    row("dob", "Date of birth", 2, typed(formatDob(p.dob), p.dob), govt(formatDob(g?.dob ?? null), g?.dob ?? null), exact),
    row("gender", "Gender", 2, typed(normGender(p.gender)), govt(normGender(g?.gender ?? null)), exact),
    row("aadhaar", "Aadhaar", 3, typed(aadhaarText(p.aadhaarLast4), p.aadhaarLast4), govt(aadhaarText(g?.aadhaarLast4 ?? null), g?.aadhaarLast4 ?? null), exact),
  ];
}

// ── Verdict ──────────────────────────────────────────────────────────────────

export interface VerdictContext {
  kind: AlertKind;
  faceScore?: number | null;
  /** A government/bank provider positively verified the number the candidate typed. */
  numberVerifiedByProvider?: boolean;
}

function typedVsGovtProblems(p: IdentitySnapshot, who: string): VerdictReason[] {
  if (!p.govt) return [];
  const out: VerdictReason[] = [];
  const g = p.govt;
  if (g.aadhaarLast4 && p.aadhaarLast4 && g.aadhaarLast4 !== p.aadhaarLast4) {
    out.push({
      tone: "warn",
      text: `${who}: the Aadhaar typed ends ${p.aadhaarLast4}, but the government record ends ${g.aadhaarLast4}.`,
    });
  }
  const gd = g.dob;
  if (gd && p.dob && gd !== p.dob) {
    out.push({ tone: "warn", text: `${who}: the date of birth typed (${formatDob(p.dob)}) differs from the government record (${formatDob(gd)}).` });
  }
  const gg = normGender(g.gender);
  const tg = normGender(p.gender);
  if (gg && tg && gg !== tg) {
    out.push({ tone: "warn", text: `${who}: the gender typed (${tg}) differs from the government record (${gg}).` });
  }
  return out;
}

export function computeVerdict(cmp: IdentityComparison | null, ctx: VerdictContext): Verdict {
  if (ctx.kind === "face") {
    const s = ctx.faceScore;
    if (s == null) {
      return {
        level: "unsure",
        headline: "We can't tell from the data",
        strength: "No photo score is available. Compare the photos yourself.",
        reasons: [{ tone: "warn", text: "The system could not score the photos." }],
      };
    }
    if (s >= 70) {
      return {
        level: "same",
        headline: "The photos look like the same person",
        strength: "Low risk",
        reasons: [{ tone: "ok", text: `Face match is ${s}%.` }],
      };
    }
    const reasons: VerdictReason[] = [{ tone: "warn", text: `Face match is only ${s}%. A dark or blurred selfie can score low.` }];
    if (cmp) reasons.push(...typedVsGovtProblems(cmp.subject, "This candidate"));
    return { level: "unsure", headline: "We can't tell from the data", strength: "Look at the two photos yourself", reasons };
  }

  if (ctx.kind === "number") {
    if (ctx.numberVerifiedByProvider) {
      return {
        level: "same",
        headline: "Probably a misread of the document photo",
        strength: "Low risk",
        reasons: [{ tone: "ok", text: "A government or bank check confirmed the number that was typed." }],
      };
    }
    return {
      level: "unsure",
      headline: "Check the document against the typed number",
      strength: "Numbers read from photos by machine are often wrong",
      reasons: [{ tone: "warn", text: "No official check has confirmed this number yet." }],
    };
  }

  if (ctx.kind === "identity" && cmp?.other) {
    const rows = buildPersonRows(cmp);
    const diffScore = rows.filter((r) => r.state === "diff").reduce((n, r) => n + r.weight, 0);
    const sameScore = rows.filter((r) => r.state === "same").reduce((n, r) => n + r.weight, 0);
    const reasons: VerdictReason[] = [];
    for (const r of rows) {
      if (r.state === "diff" && r.weight > 0 && r.left && r.right) {
        reasons.push({ tone: "bad", text: `${r.label} differs: ${r.left.value} against ${r.right.value}.` });
      }
    }
    const self = [...typedVsGovtProblems(cmp.subject, "This candidate"), ...typedVsGovtProblems(cmp.other, "The other person")];
    reasons.push(...self);
    if (cmp.sharedMobile) reasons.push({ tone: "info", text: "They share the same mobile number." });
    if (cmp.sharedDevice) reasons.push({ tone: "info", text: "Their forms were filled from the same phone and network." });
    if (diffScore === 0 && sameScore > 0) {
      reasons.unshift({ tone: "ok", text: "Name, date of birth and gender all agree." });
    }

    if (diffScore >= 4) {
      return { level: "different", headline: "These look like two different people", strength: "Strong evidence", reasons };
    }
    if (diffScore === 0 && sameScore >= 4 && self.length === 0) {
      return { level: "same", headline: "These look like the same person", strength: "Probably the same person", reasons };
    }
    return { level: "unsure", headline: "We can't tell from the data", strength: "Compare the documents and photos yourself", reasons };
  }

  return {
    level: "unsure",
    headline: "We can't tell from the data",
    strength: "Review the evidence below",
    reasons: [{ tone: "info", text: "There is no side-by-side data for this kind of alert." }],
  };
}

// ── What the reviewer is asked to do ─────────────────────────────────────────

export const CHECKLIST_BY_KIND: Record<AlertKind, string[]> = {
  identity: ["I compared both photos", "I checked the original ID cards", "I spoke to the candidate"],
  face: ["I compared the photos myself", "I asked the candidate for a clearer selfie"],
  number: ["I looked at the document photo and compared the number"],
  other: ["I reviewed the evidence on this screen"],
};

/**
 * Saying "false alarm" against the system's own "different people" finding needs
 * more than a click: the reviewer must say what they checked.
 */
export function needsChecklist(verdict: Verdict, choice: "ok" | "bad" | "info" | null): boolean {
  return choice === "ok" && verdict.level === "different";
}

// ── Approval gate on the profile-review screen ───────────────────────────────

export interface FraudReviewInput {
  /** Alerts of any severity still waiting for a decision. */
  anyUnresolved: number;
  /** Critical or high alerts still waiting for a decision. */
  blocking: number;
  /** The reviewer has opened the review section for this candidate. */
  opened: boolean;
  /** The "I have reviewed all fraud flags" box is ticked. */
  acknowledged: boolean;
}

/**
 * A profile the system has not flagged is never held up. A flagged one can be
 * approved only once the reviewer has opened the review, decided every serious
 * alert and confirmed. The server enforces the serious-alert part as well.
 */
export function fraudReviewState(i: FraudReviewInput): { needsReview: boolean; done: boolean; pending: boolean } {
  const needsReview = i.anyUnresolved > 0;
  const done = i.opened && i.acknowledged && i.blocking === 0;
  return { needsReview, done, pending: needsReview && !done };
}
