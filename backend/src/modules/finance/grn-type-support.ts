/**
 * Which values of `grn_request.grn_type` the application can actually carry through its
 * accounting lifecycle, and one refusal for the ones it cannot.
 *
 * The enum holds four values and only two of them work end to end:
 *
 *   vendor     creates a payable on Finance Head approval.
 *   imprest    debits the branch float on Finance Head approval.
 *   provision  no lifecycle was ever built. Already failed closed at create, submit and approve,
 *              in three separately written copies of the same check.
 *   salary     added to the enum on 2026-08 purely so the db_bill migration could land its
 *              historic rows. No create branch, no payable branch, no float branch — and, unlike
 *              provision, NO GUARD. A payload naming it was accepted: it would create, submit,
 *              and then fall through the non-vendor arm of Finance Head approval to land on
 *              `approved` with nothing posted anywhere. 39,099 rows carry the type, every one of
 *              them migrated history that is already `approved` or `paid`, and therefore not
 *              reopenable — so refusing the type outright cannot strand anything that exists.
 *              It was dormant only because the form has never offered it, which is not a control.
 *
 * One list, one message shape, called from every write entry point, so a type added to the enum
 * in future is refused everywhere by default rather than being accepted everywhere by default.
 */
const UNSUPPORTED_GRN_TYPES: Record<string, string> = {
  provision:
    "PROVISION_GRN_NOT_SUPPORTED: Provision GRN accounting lifecycle is not yet implemented.",
  salary:
    "SALARY_GRN_NOT_SUPPORTED: Salary GRNs exist only as migrated history from db_bill and cannot be raised or actioned here. Raise this through Payroll.",
};

/**
 * Refuses a GRN type the lifecycle cannot complete.
 *
 * Carries `statusCode`, so `errorHandler.ts` forwards the message instead of replacing it with an
 * anonymous reference id in production — the raiser needs to be told which type is refused and
 * where to go instead, and that was exactly what the masked 500 took away.
 *
 * `action` names the step being refused ("Submission", "Approval") so the same guard reads
 * correctly wherever it is called from.
 */
export function assertGrnTypeSupported(grnType: unknown, action: string): void {
  const type = String(grnType ?? "").trim().toLowerCase();
  const reason = UNSUPPORTED_GRN_TYPES[type];
  if (!reason) return;
  throw Object.assign(new Error(`${reason} ${action} is blocked. Contact Finance Admin.`), {
    statusCode: 409,
    code: type === "salary" ? "SALARY_GRN_NOT_SUPPORTED" : "PROVISION_GRN_NOT_SUPPORTED",
  });
}
