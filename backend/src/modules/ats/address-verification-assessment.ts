/**
 * Address verification assessment — how much a geo-tagged selfie submission can be trusted.
 *
 * Why this exists: the selfie link auto-passed only within 50 m of a reference point that is, in
 * practice, a pincode centre, so almost nothing ever cleared and HR got an undifferentiated queue
 * (live 2026-10-15: 72 submitted, 0 ever decided). The location signal alone cannot do better — a
 * pincode centre cannot confirm a doorstep — so it is combined with an independent one: the address
 * the government (DigiLocker / Aadhaar) holds for the candidate.
 *
 *   verified   exact GPS match, OR same area (<= 10 km, accuracy <= 100 m) AND the DigiLocker address
 *              agrees on pincode. Two independent signals.
 *   conflict   device was in a different city (> 50 km). Something is wrong; HR must look.
 *   needs_hr   everything else (one weak signal, no GPS, no DigiLocker address, renters whose present
 *              address legitimately differs from Aadhaar). Never auto-failed.
 *
 * Pure functions; the loaders at the bottom only read.
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { extractDigilockerDemographics, type DigilockerAddress } from "./digilocker-demographics.js";

export const EXACT_M = 50;
export const SAME_AREA_M = 10_000;
export const DIFFERENT_CITY_M = 50_000;
export const MAX_GPS_ACCURACY_M = 100;
/**
 * Radius treated as "inside the declared pincode area". The reference point is a pincode centre (live
 * 2026-10-17: 281 links, 248 distinct addresses but 137 reference points; 34 different Noida addresses in
 * pincode 201309 all carry the identical point 28.6135061, 77.3686447), so a candidate at home routinely
 * reads 1-2 km "away". Within this radius that number says nothing about the house and must not be shown
 * as a distance from the home.
 */
export const PINCODE_AREA_M = 3_000;

/** How precise the reference point is. geocodeAddress tries pincode, then city+state, then the full text. */
export type ReferencePrecision = "pincode_centre" | "city_centre" | "address";

export type AddressTier = "verified" | "needs_hr" | "conflict";
export type LocationSignal = "exact" | "same_area" | "different_area" | "different_city" | "no_gps" | "poor_accuracy";
export type DocumentSignal = "match" | "pincode_only" | "mismatch" | "no_data";

export interface DeclaredAddress {
  line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface AddressAssessment {
  tier: AddressTier;
  location: LocationSignal;
  documents: DocumentSignal;
  /** Precision of the reference point the distance was measured from; anything but "address" is approximate. */
  referencePrecision: ReferencePrecision;
  reasons: string[];
}

/**
 * Mirrors geocodeAddress' order (bgv-address-verification.routes.ts): a valid 6-digit present pincode is
 * geocoded first, then city + state. Only without either was the full address text geocoded.
 */
export function referencePrecisionFor(declared: DeclaredAddress): ReferencePrecision {
  if (/^\d{6}$/.test(String(declared.pincode ?? "").trim())) return "pincode_centre";
  if (String(declared.city ?? "").trim() && String(declared.state ?? "").trim()) return "city_centre";
  return "address";
}

/** Human wording for the GPS distance. A centroid reference is never presented as a distance from the home. */
export function describeDistance(distanceM: number | null, precision: ReferencePrecision): string {
  if (distanceM === null || !Number.isFinite(distanceM)) return "No GPS captured";
  const amount = distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(1)} km`;
  if (precision === "address") return `${amount} from the declared address area`;
  const centre = precision === "pincode_centre" ? "pincode" : "city";
  if (precision === "pincode_centre" && distanceM <= PINCODE_AREA_M) {
    return `Inside the declared pincode area (the map reference is the pincode centre, not the house, so ${amount} is not a distance from the home)`;
  }
  return `About ${amount} from the centre of the declared ${centre} (approximate: the reference is the ${centre} centre, not the house)`;
}

const STOPWORDS = new Set([
  "house", "flat", "plot", "door", "floor", "near", "opp", "opposite", "behind", "road", "street", "lane",
  "nagar", "colony", "sector", "block", "ward", "village", "post", "district", "dist", "tehsil", "taluka",
  "the", "and", "via", "p.o", "po", "ps", "india", "city", "town", "area", "main", "next", "side", "no",
]);

function tokens(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    out.add(raw);
  }
  return out;
}

const pin = (v: string | null | undefined) => {
  const m = String(v ?? "").match(/\b\d{6}\b/);
  return m ? m[0] : null;
};

export function assessLocation(distanceM: number | null, accuracyM: number | null): LocationSignal {
  if (distanceM === null || !Number.isFinite(distanceM)) return "no_gps";
  if (distanceM <= EXACT_M) return "exact";
  if (distanceM > DIFFERENT_CITY_M) return "different_city";
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM > MAX_GPS_ACCURACY_M) return "poor_accuracy";
  return distanceM <= SAME_AREA_M ? "same_area" : "different_area";
}

/** Compares the declared present address to the addresses DigiLocker returned (current and permanent). */
export function assessDocuments(declared: DeclaredAddress, govt: Array<DigilockerAddress | null>): DocumentSignal {
  const candidates = govt.filter((a): a is DigilockerAddress => !!a);
  if (!candidates.length) return "no_data";
  const declaredPin = pin(declared.pincode) ?? pin(declared.line);
  const declaredTokens = new Set([...tokens(declared.line), ...tokens(declared.city)]);
  let sawPin = false;
  let best: DocumentSignal = "mismatch";
  for (const a of candidates) {
    const govtPin = pin(a.pincode) ?? pin(a.line);
    if (govtPin) sawPin = true;
    if (!declaredPin || !govtPin || declaredPin !== govtPin) continue;
    const govtTokens = new Set([...tokens(a.line), ...tokens(a.locality), ...tokens(a.district)]);
    let shared = 0;
    for (const t of declaredTokens) if (govtTokens.has(t)) shared++;
    if (shared >= 2) return "match";
    best = "pincode_only";
  }
  if (!sawPin && best === "mismatch") return "no_data";
  return best;
}

export function assess(input: {
  distanceM: number | null;
  accuracyM: number | null;
  declared: DeclaredAddress;
  govt: Array<DigilockerAddress | null>;
}): AddressAssessment {
  const location = assessLocation(input.distanceM, input.accuracyM);
  const documents = assessDocuments(input.declared, input.govt);
  const reasons: string[] = [];
  const referencePrecision = referencePrecisionFor(input.declared);
  reasons.push(describeDistance(input.distanceM, referencePrecision));
  if (location === "poor_accuracy") reasons.push(`GPS accuracy ${Math.round(input.accuracyM ?? 0)} m is too coarse to rely on`);
  reasons.push(
    documents === "match" ? "Aadhaar address matches (pincode and locality)"
    : documents === "pincode_only" ? "Aadhaar address has the same pincode"
    : documents === "mismatch" ? "Aadhaar address is in a different pincode (may be a rented / present address)"
    : "No DigiLocker address to compare",
  );

  let tier: AddressTier = "needs_hr";
  if (location === "exact") tier = "verified";
  else if (location === "different_city") tier = "conflict";
  else if (location === "same_area" && (documents === "match" || documents === "pincode_only")) tier = "verified";
  return { tier, location, documents, referencePrecision, reasons };
}

export function summarise(a: AddressAssessment): string {
  const head = a.tier === "verified" ? "Auto-verified" : a.tier === "conflict" ? "Conflict - check" : "Needs HR check";
  return `${head}: ${a.reasons.join("; ")}`;
}

// ── Loaders (read-only) ──────────────────────────────────────────────────────────────────────

export async function loadDeclaredAddress(candidateId: string): Promise<DeclaredAddress> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT present_address_line1, present_address_line2, present_address, current_address,
            present_city, present_state, present_pincode
       FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  const p = rows[0];
  if (!p) return { line: null, city: null, state: null, pincode: null };
  const line = [p.present_address_line1, p.present_address_line2, p.present_address]
    .map((v) => (v ? String(v).trim() : ""))
    .filter(Boolean)
    .join(" ") || (p.current_address ? String(p.current_address) : null);
  return {
    line,
    city: p.present_city ? String(p.present_city) : null,
    state: p.present_state ? String(p.present_state) : null,
    pincode: p.present_pincode ? String(p.present_pincode) : null,
  };
}

export async function loadGovtAddresses(candidateId: string): Promise<Array<DigilockerAddress | null>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT CAST(result_json AS CHAR) AS rj
       FROM candidate_bgv_check
      WHERE candidate_id = ? AND check_type = 'digilocker' AND status = 'verified'
      ORDER BY updated_at DESC LIMIT 1`,
    [candidateId],
  );
  const rj = rows[0]?.rj;
  if (!rj) return [];
  try {
    const d = extractDigilockerDemographics(JSON.parse(String(rj)));
    return [d.currentAddress, d.permanentAddress];
  } catch {
    return [];
  }
}

export async function assessForCandidate(
  candidateId: string,
  distanceM: number | null,
  accuracyM: number | null,
): Promise<AddressAssessment> {
  const [declared, govt] = await Promise.all([loadDeclaredAddress(candidateId), loadGovtAddresses(candidateId)]);
  return assess({ distanceM, accuracyM, declared, govt });
}

/**
 * Records the 'address' check on candidate_bgv_check. Updates the existing row if there is one, otherwise
 * inserts WITH an id. The previous inline INSERT omitted `id`, which production's table has no default for
 * ("Field 'id' doesn't have a default value"); the error was swallowed by a fire-and-forget catch, so a
 * geo-selfie 'verified' never reached the BGV report or the appointment-letter gate.
 */
export async function upsertAddressCheck(
  candidateId: string,
  status: "verified" | "failed" | "not_run",
  verifiedAt: Date | null,
  summary: string | null,
): Promise<void> {
  const [res] = await db.execute(
    `UPDATE candidate_bgv_check
        SET status = ?, verified_at = ?, result_summary = ?, updated_at = NOW()
      WHERE candidate_id = ? AND check_type = 'address'`,
    [status, verifiedAt, summary, candidateId],
  );
  if (Number((res as { affectedRows?: number }).affectedRows ?? 0) > 0) return;
  await db.execute(
    `INSERT INTO candidate_bgv_check (id, candidate_id, check_type, status, verified_at, result_summary, updated_at)
       VALUES (?, ?, 'address', ?, ?, ?, NOW())`,
    [randomUUID(), candidateId, status, verifiedAt, summary],
  );
}
