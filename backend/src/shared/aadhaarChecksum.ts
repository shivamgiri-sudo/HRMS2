/**
 * Aadhaar's Verhoeff checksum, shared by EPF KYC input validation
 * (employees/epfKycCapture.service.ts) and OCR cross-validation
 * (ats/ocr.service.ts). Not an official UIDAI-published algorithm, but the
 * de facto standard nearly every Aadhaar validation tool relies on — a
 * genuine 12-digit Aadhaar always satisfies it, so a number that fails is
 * either mistyped or misread, never a real Aadhaar with a mismatched name.
 */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const AADHAAR_SHAPE_RE = /^[0-9]{12}$/;

/** True for a 12-digit string that is shaped like, and checksums as, a real Aadhaar number. */
export function isValidAadhaarChecksum(value: string): boolean {
  if (!AADHAAR_SHAPE_RE.test(value)) return false;
  if (value[0] === "0" || value[0] === "1") return false; // never issued
  let c = 0;
  const digits = value.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  return c === 0;
}
