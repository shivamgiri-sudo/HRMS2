/**
 * Recipient resolution — types.
 *
 * Every notification names WHO receives it with a RecipientSpec; resolveRecipients()
 * turns that into real addresses at send time. Before this existed, each feature wrote
 * its own JOIN — exit.service.ts:20, ats-notification.helper.ts:48, payroll-hr.service.ts:457
 * and employee-creation-orchestrator.service.ts:512 all resolve "a manager" or "HR"
 * differently, and none of them agree on inactive employees or which email column wins.
 */

export type Bucket = 'to' | 'cc' | 'bcc';

/**
 * Which address to use for a person.
 *  - 'default'                : official_email -> office_email -> email
 *  - 'official_only'          : official/office email on an allowed domain, else DROP.
 *                               Required for `fin` events. 156 of 1,152 active employees
 *                               have no official email (2026-07-31), so this genuinely drops.
 *  - 'official_then_personal' : official first, personal fallback. Exists for exactly one
 *                               event — full_final_ready, where the employee has left and the
 *                               official mailbox is disabled. Do not use it anywhere else.
 */
export type EmailPolicy = 'default' | 'official_only' | 'official_then_personal';

export type RecipientSelector =
  | { kind: 'employee';            employeeId?: string; emailPolicy?: EmailPolicy }
  | { kind: 'user';                userId: string }
  | { kind: 'reporting_manager';   employeeId?: string }
  | { kind: 'skip_level_manager';  employeeId?: string }
  | { kind: 'branch_head';         branchId?: string }
  | { kind: 'branch_hr';           branchId?: string }
  | { kind: 'process_manager';     processId?: string; employeeId?: string }
  | { kind: 'payroll_hr';          branchId?: string }
  | { kind: 'wfm_spoc';            branchId?: string }
  /**
   * Ordered fallback: wfm_spoc -> role_scope(wfm, branch) -> branch_hr, stopping at the
   * first link that yields anyone. Exists because branch_wfm_spoc_config has ZERO rows in
   * production — a bare wfm_spoc selector would silently address nobody on every roster event.
   */
  | { kind: 'wfm_chain';           branchId?: string }
  | { kind: 'role_scope';          roleKeys: string[];
                                   scope?: { type: 'all' }
                                         | { type: 'branch';  branchIds: string[] }
                                         | { type: 'process'; processIds: string[] };
                                   limit?: number;
                                   /** Named guard evaluated against context before including. */
                                   conditional?: string }
  | { kind: 'tat_owner';           tatInstanceId?: string }
  | { kind: 'tat_owner_manager';   tatInstanceId?: string }
  | { kind: 'explicit_email';      email: string; name?: string };

export interface RecipientSpec {
  to: RecipientSelector[];
  cc?: RecipientSelector[];
  bcc?: RecipientSelector[];
}

export type DropReason =
  | 'no_match'            // selector resolved to no rows
  | 'inactive_employee'
  | 'no_email'
  | 'no_official_email'   // official_only policy, employee has none
  | 'invalid_domain'
  | 'duplicate'           // already present in an equal-or-higher-priority bucket
  | 'self_edge'           // would CC the person their own message is about
  | 'cap_exceeded'
  | 'unknown_role'
  | 'condition_not_met'
  | 'client_audience';    // deny-list: a client address on an internal notification

export interface ResolvedRecipient {
  bucket: Bucket;
  employeeId: string | null;
  userId: string | null;
  employeeCode: string | null;
  name: string;
  email: string;
  emailSource: 'official_email' | 'office_email' | 'email' | 'auth_user' | 'explicit';
  branchId: string | null;
  processId: string | null;
  audience: 'internal' | 'client' | 'external';
  /** e.g. "branch_head:<branchId>" — persisted for audit so a wrong CC is traceable. */
  viaSelector: string;
}

export interface DroppedRecipient {
  selector: string;
  reason: DropReason;
  /** Masked. Never a full address. */
  detail?: string;
  employeeId?: string | null;
}

export interface RecipientResolution {
  to: ResolvedRecipient[];
  cc: ResolvedRecipient[];
  bcc: ResolvedRecipient[];
  /** Every person who WOULD have been addressed and was not, with the reason. */
  dropped: DroppedRecipient[];
  truncated: boolean;
}

/** Ambient facts a spec is resolved against. Selectors omit ids and read them from here. */
export interface RecipientContext {
  employeeId?: string | null;
  userId?: string | null;
  branchId?: string | null;
  processId?: string | null;
  tatInstanceId?: string | null;
  /** Values for `conditional` guards, e.g. { amount: 6200000 }. */
  vars?: Record<string, unknown>;
}

export type Sensitivity = 'int' | 'conf' | 'fin';

export interface ResolveOptions {
  sensitivity: Sensitivity;
  context: RecipientContext;
  /** Defaults: to 20, cc 30, bcc 200. Overflow is dropped with 'cap_exceeded', never silent. */
  maxTo?: number;
  maxCc?: number;
  maxBcc?: number;
  /** Allow explicit_email outside the company allowlist. Default false. */
  allowExternal?: boolean;
  correlationId?: string;
}

export type RecipientErrorCode =
  | 'EMPTY_TO'          // nothing to send to — caller must not fall back to a default address
  | 'FIN_HAS_CC'        // a financial event about an employee named a CC (catalogue rule)
  | 'CLIENT_AUDIENCE';  // deny-list breach

export class RecipientResolutionError extends Error {
  constructor(
    public readonly code: RecipientErrorCode,
    message: string,
    public readonly resolution?: RecipientResolution,
  ) {
    super(message);
    this.name = 'RecipientResolutionError';
  }
}
