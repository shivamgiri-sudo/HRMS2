/**
 * The eight real blood groups, and the only values any HRMS form may submit.
 *
 * `employees.blood_group` was a free-text box on the Profile editor until 2026-09-03.
 * Live data still carries what that produced — 'B+ve', 'O +', a bare 'A', and one row
 * reading 'SAMBHLI' — alongside 28,502 rows holding the literal string 'NA' from the
 * legacy import, which the employee ID card printed as though it were a real reading.
 *
 * The backend normalises every write through backend/src/modules/employees/bloodGroup.util.ts;
 * this list is the UI half of the same contract. Keep the two in step.
 */
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/** True when a stored value is one of the eight groups a <Select> can actually display. */
export function isKnownBloodGroup(value: string | null | undefined): value is BloodGroup {
  return !!value && (BLOOD_GROUPS as readonly string[]).includes(value);
}

/**
 * What to show on a read-only surface. Legacy placeholders ('NA', '', NULL) read as
 * "Not recorded" rather than being echoed back as if they meant something.
 */
export function displayBloodGroup(value: string | null | undefined): string | null {
  return isKnownBloodGroup(value) ? value : null;
}
