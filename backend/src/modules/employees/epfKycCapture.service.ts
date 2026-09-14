/**
 * EPF statutory KYC capture.
 *
 * The EPF declaration is a real EPFO filing. Page 3 of the form requires the
 * bank account number and IFSC (both marked mandatory), plus Aadhaar and PAN,
 * each with the name as printed on that document.
 *
 * This system masks PAN/Aadhaar/UAN/bank at the point of save by design, and
 * stores only the masked form plus a hash — there is no unmasked column
 * anywhere. That is correct for storage under DPDP, but it means the stored
 * values cannot be used to complete a statutory form: EPFO would receive
 * "XXXXXX1234".
 *
 * So the member supplies the real numbers at signing time. They are validated,
 * written into the generated PDF, and then discarded. Only the masked form and a
 * hash are recorded, for audit and duplicate detection — exactly what is stored
 * today. No real value is ever written to a column.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { generateChecklistDraft, type TransientFieldValues } from "./universalDigitalFormFill.service.js";
import { maskAadhaar, maskPan, maskUan, hashIdentifier } from "./employeeCompliancePrivacy.js";

export type EpfKycInput = {
  panNumber?: string | null;
  panNameAsPerKyc?: string | null;
  aadhaarNumber?: string | null;
  aadhaarNameAsPerKyc?: string | null;
  uanNumber?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankAccountName?: string | null;
};

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^[0-9]{12}$/;
const UAN_RE = /^[0-9]{12}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^[0-9]{5,20}$/;

const clean = (v: unknown) => String(v ?? "").replace(/[\s-]/g, "").trim();

/**
 * Aadhaar's Verhoeff checksum. A typo'd Aadhaar that passes a length check would
 * be filed with EPFO and rejected weeks later, so validate it properly here.
 */
const VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];

function isValidAadhaar(value: string): boolean {
  if (!AADHAAR_RE.test(value)) return false;
  if (value[0] === "0" || value[0] === "1") return false; // never issued
  let c = 0;
  const digits = value.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  return c === 0;
}

export type EpfKycValidationError = { field: string; message: string };

/** Validates without retaining anything. Returns every problem at once so the member fixes them in one pass. */
export function validateEpfKyc(input: EpfKycInput): EpfKycValidationError[] {
  const errors: EpfKycValidationError[] = [];
  const pan = clean(input.panNumber).toUpperCase();
  const aadhaar = clean(input.aadhaarNumber);
  const uan = clean(input.uanNumber);
  const account = clean(input.bankAccountNumber);
  const ifsc = clean(input.bankIfsc).toUpperCase();

  // Bank account + IFSC are marked mandatory on the EPFO form itself.
  if (!account) errors.push({ field: "bankAccountNumber", message: "Bank account number is required by EPFO." });
  else if (!ACCOUNT_RE.test(account)) errors.push({ field: "bankAccountNumber", message: "Enter digits only (5-20)." });

  if (!ifsc) errors.push({ field: "bankIfsc", message: "IFSC code is required by EPFO." });
  else if (!IFSC_RE.test(ifsc)) errors.push({ field: "bankIfsc", message: "IFSC must look like HDFC0001234." });

  if (pan && !PAN_RE.test(pan)) errors.push({ field: "panNumber", message: "PAN must look like ABCDE1234F." });
  if (aadhaar && !isValidAadhaar(aadhaar)) errors.push({ field: "aadhaarNumber", message: "Aadhaar number is not valid." });
  if (uan && !UAN_RE.test(uan)) errors.push({ field: "uanNumber", message: "UAN must be 12 digits." });

  return errors;
}

/** Maps the captured values onto the EPF template's field keys. */
function toTransientFieldValues(input: EpfKycInput): TransientFieldValues {
  const out: TransientFieldValues = {};
  const set = (k: string, v: string) => { if (v) out[k] = v; };

  set("kyc_pan_number", clean(input.panNumber).toUpperCase());
  set("kyc_aadhaar_number", clean(input.aadhaarNumber));
  set("uan", clean(input.uanNumber));
  set("kyc_bank_account_number", clean(input.bankAccountNumber));
  set("kyc_bank_ifsc", clean(input.bankIfsc).toUpperCase());
  set("bank_ifsc", clean(input.bankIfsc).toUpperCase());
  set("kyc_pan_name", String(input.panNameAsPerKyc ?? "").trim());
  set("kyc_aadhaar_name", String(input.aadhaarNameAsPerKyc ?? "").trim());
  set("kyc_bank_account_name", String(input.bankAccountName ?? "").trim());
  return out;
}

/**
 * Records only the masked form and a hash — the same shape the profile already
 * stores. Deliberately does not accept or write the raw values.
 */
async function recordMaskedAudit(employeeId: string, input: EpfKycInput): Promise<void> {
  const pan = clean(input.panNumber).toUpperCase();
  const aadhaar = clean(input.aadhaarNumber);
  const uan = clean(input.uanNumber);
  const account = clean(input.bankAccountNumber);

  await db.execute(
    `UPDATE employee_epf_compliance_profile
        SET pan_masked      = COALESCE(NULLIF(?, ''), pan_masked),
            pan_hash        = COALESCE(NULLIF(?, ''), pan_hash),
            aadhaar_masked  = COALESCE(NULLIF(?, ''), aadhaar_masked),
            uan_masked      = COALESCE(NULLIF(?, ''), uan_masked),
            uan_hash        = COALESCE(NULLIF(?, ''), uan_hash),
            updated_at      = NOW()
      WHERE employee_id = ?`,
    [
      pan ? maskPan(pan) : "",
      pan ? hashIdentifier(pan) : "",
      aadhaar ? maskAadhaar(aadhaar) : "",
      uan ? maskUan(uan) : "",
      uan ? hashIdentifier(uan) : "",
      employeeId,
    ],
  ).catch((err: unknown) => {
    console.error("[epfKycCapture] masked audit update failed:", err instanceof Error ? err.message : String(err));
  });

  await db.execute(
    `INSERT INTO employee_joining_document_audit_log
       (employee_id, action_type, actor_user_id, remarks, created_at)
     VALUES (?, 'EPF_KYC_CAPTURED', NULL, ?, NOW())`,
    [
      employeeId,
      `Statutory KYC supplied by member for the EPF declaration. Written to the generated form only; ` +
      `stored masked. Provided: ${[
        pan && "PAN", aadhaar && "Aadhaar", uan && "UAN", account && "bank account",
      ].filter(Boolean).join(", ") || "none"}.`,
    ],
  ).catch(() => undefined);
}

/**
 * Regenerates the EPF declaration with the member's real statutory numbers.
 *
 * The raw values live only in this call stack and the resulting PDF.
 */
export async function applyEpfKycAndRegenerate(params: {
  checklistId: string;
  employeeId: string;
  input: EpfKycInput;
}): Promise<{ regenerated: boolean; errors: EpfKycValidationError[] }> {
  const errors = validateEpfKyc(params.input);
  if (errors.length) return { regenerated: false, errors };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT document_code FROM employee_joining_document_checklist WHERE id = ? AND employee_id = ? LIMIT 1`,
    [params.checklistId, params.employeeId],
  );
  const documentCode = String((rows as RowDataPacket[])[0]?.document_code ?? "");
  if (documentCode !== "EPF_DECLARATION") {
    return {
      regenerated: false,
      errors: [{ field: "checklistId", message: "Statutory KYC capture applies only to the EPF declaration." }],
    };
  }

  await generateChecklistDraft(params.checklistId, null, toTransientFieldValues(params.input));
  await recordMaskedAudit(params.employeeId, params.input);

  return { regenerated: true, errors: [] };
}
