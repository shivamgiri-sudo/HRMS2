// backend/scripts/migrate-legacy.transforms.ts
// Pure transformation utilities for legacy employee/leave data migration.
// Zero DB dependencies — safe to unit-test in isolation.

export interface LegacyEmployeeRow {
  Id: number;
  SrNo: number | null;
  EmpCode: string;
  EmpType: string | null;
  EmpName: string;
  Fname: string | null;
  Gender: string | null;
  DOB: string | null;
  DOJ: string;
  Desig: string | null;
  Depart: string | null;
  Stream: string | null;
  Process: string | null;
  Profile: string | null;
  Location: string | null;
  SubLocation: string | null;
  Qualification: string | null;
  MaritalStatus: string | null;
  BloodG: string | null;
  PAddress: string | null;
  PCity: string | null;
  PState: string | null;
  PpinCode: string | null;
  TAddress: string | null;
  TCity: string | null;
  TState: string | null;
  TPinCode: string | null;
  PMobNo: string | null;
  PLandLine: string | null;
  TMobNo: string | null;
  TLandLine: string | null;
  EmailId: string | null;
  documentDone: string | null;
  CTCOffered: string | null;
  AcNo: string | null;
  AcBank: string | null;
  AcBranch: string | null;
  PassPortNo: string | null;
  dlNo: string | null;
  EpfNo: string | null;
  EsiNo: string | null;
  EntryDate: string | null;
  Status: string | null;
  LeftDate: string | null;
  LeftRmks: string | null;
  EmpCodeDate: string | null;
  Pwd: string | null;
  Age: string | null;
  bs: string | null;
  hra: string | null;
  conv: string | null;
  da: string | null;
  portf: string | null;
  ma: string | null;
  lta: string | null;
  mob: string | null;
  sa: string | null;
  oa: string | null;
  panno: string | null;
  NewEpfNo: string | null;
  pfelig: string | null;
  esielig: string | null;
  moballow: string | null;
  mno: string | null;
  portfolio: string | null;
  nom1: string | null;
  nom2: string | null;
  dispens: string | null;
  remarks: string | null;
  CreateDate: string | null;
  EpfDate: string | null;
  Band: string | null;
  lastUpdated: string | null;
  BiometricCode: string | null;
  ClientName: string | null;
  CostCenter: string | null;
  EmpFor: string | null;
  UpdatedBy: string | null;
  IFSCCode: string | null;
  AccHolder: string | null;
  AccType: string | null;
  OfferNo: string | null;
  package: string | null;
  Bonus: string | null;
  Gross: string | null;
  ESIC: string | null;
  EPF: string | null;
  NetInHand: string | null;
  EPFCO: string | null;
  ESICCO: string | null;
  Gratuity: string | null;
  ProfessionalTax: string | null;
  AccountFlag: string | null;
  Title: string | null;
  EsicNo: string | null;
  AppointPrintDate: string | null;
  PayMode: string | null;
  AcValidationDate: string | null;
  AcValidatedBy: string | null;
  AdminCharges: string | null;
  SourceType: string | null;
  Source: string | null;
  BoxFileNo: string | null;
  AcRejectionRemarks: string | null;
  KPIId: string | null;
  AssignDate: string | null;
  RType: string | null;
  SalaryPaymentMode: string | null;
  AadharID: string | null;
  PLI: string | null;
  OfficialEmailID: string | null;
  UAN: string | number | null;
}

export interface LegacyLeaveRow {
  Id: number;
  EmpCode: string;
  EmpLocation: string | null;
  EmpName: string | null;
  BranchName: string | null;
  CostCenter: string | null;
  LeaveFrom: string;
  LeaveTo: string;
  LeaveFor: string | null;
  LeaveType: string;
  CurrentStatus: string | null;
  Purpose: string | null;
  Address: string | null;
  Contact: number | null;
  Status: string | null;
  CL: number | null;
  ML: number | null;
  DL: number | null;
  EL: number | null;
  PTRL: number | null;
  MTRL: number | null;
  LWP: number | null;
  TotalLeave: number | null;
  DisApprovedReason: string | null;
  DisApprovedDate: string | null;
  CreateDate: string | null;
  LeaveApproveBy: string | null;
  LeaveApproveDate: string | null;
  chatId: string | null;
}

/**
 * Normalise a legacy date value to ISO YYYY-MM-DD, or null.
 *
 * Handles:
 *  - MySQL datetime strings: "2018-06-16 00:00:00" → "2018-06-16"
 *  - US format M/D/YYYY or MM/DD/YYYY: "6/9/1974" → "1974-06-09"
 *  - Zero-date sentinel: "0000-00-00 ..." → null
 *  - "NA", empty, null, undefined → null
 */
export function parseLegacyDate(str: string | null | undefined): string | null {
  if (!str) return null;
  const trimmed = str.trim();
  if (!trimmed || trimmed === 'NA') return null;
  if (trimmed.startsWith('0000')) return null;

  // MySQL datetime / ISO date: "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS"
  const mysqlDt = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mysqlDt) return mysqlDt[1];

  // US short format: M/D/YYYY or MM/DD/YYYY
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Split a full name into first and last name on the first space.
 * "SHYAM BABU JANGIR" → { firstName: "SHYAM", lastName: "BABU JANGIR" }
 */
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1).trim(),
  };
}

/**
 * Normalise a legacy gender string to the canonical enum value.
 * Anything other than "male"/"female" (case-insensitive) maps to "Other".
 */
export function normalizeGender(g: string | null | undefined): 'Male' | 'Female' | 'Other' {
  const upper = (g ?? '').toUpperCase().trim();
  if (upper === 'MALE') return 'Male';
  if (upper === 'FEMALE') return 'Female';
  return 'Other';
}

/**
 * Convert an arbitrary label to a safe master-table code:
 *  - uppercase
 *  - collapse and replace whitespace runs with underscore
 *  - strip non-alphanumeric/underscore characters (e.g. "/")
 *  - truncate to 50 characters
 */
export function toMasterCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 50);
}

/**
 * Parse a UAN (Universal Account Number) that may be stored as scientific
 * notation in Excel exports, e.g. "1.00143E+11" or the numeric 1.00143e11.
 * Returns the integer string representation, or null for empty/null input.
 */
export function parseUAN(uan: string | number | null | undefined): string | null {
  if (uan == null) return null;
  const str = String(uan).trim();
  if (str === '' || str.toLowerCase() === 'null') return null;
  // Scientific notation detection (e.g. "1.00143E+11")
  if (/[eE][+\-]/.test(str)) {
    return String(Math.round(parseFloat(str)));
  }
  return str;
}

/**
 * Sum all leave-type day columns from a legacy leave row.
 * Treats null as 0.
 */
export function sumLeaveDays(row: LegacyLeaveRow): number {
  return (
    (Number(row.CL) || 0) +
    (Number(row.ML) || 0) +
    (Number(row.DL) || 0) +
    (Number(row.EL) || 0) +
    (Number(row.PTRL) || 0) +
    (Number(row.MTRL) || 0) +
    (Number(row.LWP) || 0)
  );
}

/**
 * Normalise a legacy leave status string to the canonical enum value.
 *  "Approved"/"APPROVED" → "approved"
 *  "Rejected"/"Disapproved" → "rejected"
 *  null/empty/anything else → "pending"
 */
export function normalizeLeaveStatus(s: string | null | undefined): string {
  const lower = (s ?? '').toLowerCase().trim();
  if (lower === 'approved') return 'approved';
  if (lower === 'rejected' || lower === 'disapproved') return 'rejected';
  return 'pending';
}

/**
 * Parse a string or null value as a decimal number.
 * Returns 0 for null, empty, or non-numeric strings.
 */
export function toDecimal(v: string | null | undefined): number {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Convert a legacy YES/NO flag (or 1/0/true/false) to a MySQL TINYINT boolean.
 * Anything falsy or unrecognised → 0.
 */
export function boolFlag(v: string | null | undefined): number {
  const lower = (v ?? '').toLowerCase().trim();
  return lower === 'yes' || lower === '1' || lower === 'true' ? 1 : 0;
}

/**
 * Concatenate address components into a single string, skipping null/empty parts.
 * Returns null if all parts are null/empty.
 */
export function buildAddress(
  addr: string | null,
  city: string | null,
  state: string | null,
  pin: string | null,
): string | null {
  const parts = [addr, city, state, pin].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(', ') : null;
}
