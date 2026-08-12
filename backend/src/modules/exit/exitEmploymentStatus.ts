/**
 * What an exit leaves on employees.employment_status — and the matching guard list.
 *
 * WHY THIS EXISTS
 *   Completing an exit hardcoded `employment_status = 'inactive'` no matter how the person
 *   left, so an involuntary termination and a resignation were indistinguishable on the
 *   employee record. The distinction survived only inside exit_request.exit_type, and six
 *   different files already filter on statuses ('terminated', 'absconded', 'offboarded') that
 *   nothing had ever written — dead branches guarding against a state the app could not
 *   produce.
 *
 * ⚠️ WHY BOTH EXPORTS LIVE IN ONE FILE
 *   employee-activation.service.ts runs nightly and GRANTS LOGIN to anyone with
 *   active_status = 0 whose employment_status is not in its exclusion list. That list said
 *   'absconding'; writing 'absconded' here without touching it would mean the activation job
 *   no longer recognised an absconded employee and could hand their account back. The mapper
 *   and the guard list therefore have to be defined together and derived from each other, so
 *   a new terminal status cannot be added to one and forgotten in the other.
 */

/** Statuses an exit can leave behind. Anything here must never be auto-reactivated. */
export const TERMINAL_EXIT_STATUSES = ["inactive", "terminated", "absconded"] as const;

export type TerminalExitStatus = (typeof TERMINAL_EXIT_STATUSES)[number];

/**
 * Additional statuses that predate this mapper and appear in the wild — legacy migration
 * values and the older spelling. Kept in the guard so historical rows stay excluded.
 * 'absconding' is the spelling employee-activation.service.ts used before this change;
 * dropping it would un-guard any row already carrying it.
 */
export const LEGACY_TERMINAL_STATUSES = ["resigned", "exited", "offboarded", "absconding", "left", "separated"] as const;

/** Every status the nightly activation job must refuse to reactivate. */
export const NON_REACTIVATABLE_STATUSES: readonly string[] = [
  ...TERMINAL_EXIT_STATUSES,
  ...LEGACY_TERMINAL_STATUSES,
];

/** SQL-safe quoted list for an IN (...) clause. Values are compile-time literals. */
export function nonReactivatableSqlList(): string {
  return NON_REACTIVATABLE_STATUSES.map((s) => `'${s}'`).join(", ");
}

/**
 * The employment_status an exit should leave, from how the person actually left.
 *
 * Sub-type wins over type: an exit raised as involuntary whose sub-type says 'absconding' is
 * an absconding, and that is the more specific fact. 'abandonment' maps to the same status —
 * it is the same event under a different label, and having two statuses for it would mean
 * every downstream filter has to remember both.
 */
export function employmentStatusForExit(
  exitType: string | null | undefined,
  exitSubType: string | null | undefined,
): TerminalExitStatus {
  const sub = String(exitSubType ?? "").trim().toLowerCase();
  if (sub === "absconding" || sub === "abandonment") return "absconded";
  if (sub === "termination") return "terminated";

  const type = String(exitType ?? "").trim().toLowerCase();
  if (type === "involuntary") return "terminated";

  return "inactive";
}
