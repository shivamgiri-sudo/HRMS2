/**
 * The demographics a completed DigiLocker session hands back.
 *
 * This was assumed unavailable for a long time — the stored artefact is a PDF
 * whose text is a subset font behind a CMap, and several attempts to read it
 * produced nothing. That was the wrong place to look. The provider's JSON
 * response was being stored all along and carries everything, structured:
 *
 *   data.documentList[0]          -> name, dob, gender, id_number, document_type
 *   data.current_address_details  -> address, locality_or_post_office,
 *                                    district_or_city, state, pincode
 *   data.permanent_address_details-> same shape
 *
 * Verified against two real completed sessions in production, not sample docs.
 *
 * Everything here is defensive. The shape is the provider's, it is not
 * contractual, and a candidate's onboarding must never fail because a field
 * moved — an unreadable payload yields an empty result and the candidate types
 * what they always typed.
 */

export interface DigilockerDemographics {
  fullName: string | null;
  /** ISO yyyy-mm-dd; the provider sends dd-mm-yyyy. */
  dateOfBirth: string | null;
  /** Normalised to the spellings the rest of the system stores. */
  gender: "Male" | "Female" | "Other" | null;
  /** Last four digits only — the full number is never returned or stored here. */
  aadhaarLast4: string | null;
  currentAddress: DigilockerAddress | null;
  permanentAddress: DigilockerAddress | null;
}

export interface DigilockerAddress {
  line: string | null;
  locality: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

/** The provider sends 15-03-2005; every column here stores yyyy-mm-dd. */
function toIsoDate(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

/** "M" / "F" / "T", and the spelled-out forms, to what the system stores. */
function toGender(value: unknown): DigilockerDemographics["gender"] {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "m" || v === "male") return "Male";
  if (v === "f" || v === "female") return "Female";
  if (v === "t" || v === "o" || v === "other" || v === "transgender") return "Other";
  return null;
}

/** "xxxxxxxx5960" -> "5960". Nothing but the last four is ever taken. */
function toLast4(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function toAddress(node: unknown): DigilockerAddress | null {
  if (!node || typeof node !== "object") return null;
  const a = node as Record<string, unknown>;
  const address: DigilockerAddress = {
    line: str(a.address),
    locality: str(a.locality_or_post_office),
    district: str(a.district_or_city),
    state: str(a.state),
    pincode: str(a.pincode),
  };
  return Object.values(address).some(Boolean) ? address : null;
}

/**
 * Pull demographics out of a stored DigiLocker response.
 *
 * Accepts the whole envelope or the inner `data` object, because the response
 * is stored in more than one place and they are not wrapped identically.
 */
/**
 * Fill a candidate's blank profile fields from a completed DigiLocker session.
 *
 * Blanks only, always. The candidate may have typed something before connecting
 * DigiLocker, and an authority overwriting what a person entered about
 * themselves is how you get a form nobody trusts. COALESCE(NULLIF(col,''), ?)
 * writes only where the column is NULL or empty.
 *
 * Never throws. This runs inside the DigiLocker sync, after the documents are
 * already fetched and stored; losing that because a convenience write failed
 * would be a far worse outcome than the fields staying blank.
 */
export async function applyDigilockerDemographics(
  db: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
  candidateId: string,
  demographics: DigilockerDemographics,
): Promise<string[]> {
  const filled: string[] = [];
  const set: string[] = [];
  const params: unknown[] = [];

  const put = (column: string, value: string | null, label = column) => {
    if (!value) return;
    set.push(`${column} = COALESCE(NULLIF(${column}, ''), ?)`);
    params.push(value);
    filled.push(label);
  };

  put("employee_name", demographics.fullName);
  put("full_name_aadhaar", demographics.fullName);
  put("gender", demographics.gender);
  put("aadhaar_number_masked", demographics.aadhaarLast4 ? `XXXXXXXX${demographics.aadhaarLast4}` : null, "aadhaar_masked");

  const cur = demographics.currentAddress;
  put("present_address", cur?.line ?? null);
  put("present_state", cur?.state ?? null);
  put("present_city", cur?.district ?? null);
  put("present_pincode", cur?.pincode ?? null);

  const perm = demographics.permanentAddress;
  put("permanent_address", perm?.line ?? null);
  put("permanent_state", perm?.state ?? null);
  put("permanent_city", perm?.district ?? null);
  put("permanent_pincode", perm?.pincode ?? null);

  // date_of_birth is a DATE, so '' is not a possible empty value — NULL is.
  if (demographics.dateOfBirth) {
    set.push("date_of_birth = COALESCE(date_of_birth, ?)");
    params.push(demographics.dateOfBirth);
    filled.push("date_of_birth");
  }

  if (!set.length) return [];
  await db.execute(
    `UPDATE candidate_onboarding_profile SET ${set.join(", ")}, updated_at = NOW() WHERE candidate_id = ?`,
    [...params, candidateId],
  );

  // Aadhaar is the identity authority — overwrite whatever the recruiter typed at
  // registration, since that is the most common source of garbage names like "ON NF".
  if (demographics.fullName) {
    await db.execute(
      `UPDATE ats_candidate SET full_name = ?, updated_at = NOW() WHERE id = ?`,
      [demographics.fullName.toUpperCase(), candidateId],
    );
    filled.push("ats_candidate.full_name");
  }

  return filled;
}

export function extractDigilockerDemographics(payload: unknown): DigilockerDemographics {
  const empty: DigilockerDemographics = {
    fullName: null, dateOfBirth: null, gender: null, aadhaarLast4: null,
    currentAddress: null, permanentAddress: null,
  };
  if (!payload || typeof payload !== "object") return empty;

  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;

  const list = Array.isArray(data.documentList) ? data.documentList : [];
  // Only Aadhaar carries demographics we trust; a PAN entry names the holder
  // but not their address or date of birth.
  const doc = list.find((d) => {
    const t = String((d as Record<string, unknown>)?.document_type ?? "").toUpperCase();
    return t === "AADHAAR";
  }) as Record<string, unknown> | undefined;

  if (!doc) return empty;

  return {
    fullName: str(doc.name),
    dateOfBirth: toIsoDate(doc.dob),
    gender: toGender(doc.gender),
    aadhaarLast4: toLast4(doc.id_number),
    currentAddress: toAddress(data.current_address_details),
    permanentAddress: toAddress(data.permanent_address_details),
  };
}
