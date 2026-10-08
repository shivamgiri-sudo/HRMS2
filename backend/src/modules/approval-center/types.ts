/**
 * Approval Center — one normalised view over every approval a person can act on.
 *
 * Each approval kind is an ApprovalAdapter. An adapter lists what the caller can act on by calling
 * the module's OWN list endpoint as the caller (loopback, caller's bearer token), and decides by
 * calling the module's OWN decide endpoint the same way. Authorisation, branch scope, stage
 * routing and side effects therefore stay exactly what the module's page already does; this
 * module never re-implements them.
 */

export type ApprovalAction = "approve" | "reject";

export interface ApprovalField {
  label: string;
  value: string;
  /** Rendering hint. "long" gets a full-width block (reasons, descriptions). */
  type?: "text" | "money" | "date" | "long" | "badge";
}

export interface ApprovalItem {
  /** `${kind}:${id}` — what the client sends back to decide. */
  uid: string;
  kind: string;
  kindLabel: string;
  /** Grouping chip in the popup: People, Attendance, Payroll, Finance, Recruitment, Exit, Admin. */
  category: string;
  id: string;
  title: string;
  subtitle?: string;
  requester?: { name?: string | null; code?: string | null; branch?: string | null };
  /** e.g. "Stage 2 of 3 — WFM". */
  stage?: string;
  /** EVERY component of the request, in reading order. */
  fields: ApprovalField[];
  submittedAt?: string | null;
  priority?: "high" | "normal";
  /** Exact in-app location (path + query) where the request can be seen. */
  viewPath: string;
  /** Rejecting requires a written reason. */
  rejectNeedsReason: boolean;
  /** Minimum length of the decline reason the module enforces (default 3). */
  rejectMinLength?: number;
  /** Approve button label override, e.g. "Approve & forward". */
  approveLabel?: string;
  rejectLabel?: string;
  /** Derived from meta.viewOnly: card has only a View button (decision needs input the popup cannot collect). */
  viewOnly?: boolean;
  /** Derived from meta flags: the module has no decline / no approve path from the popup. */
  noReject?: boolean;
  noApprove?: boolean;
  /** Hidden adapter payload round-tripped to decide (e.g. which stage endpoint to hit). */
  meta?: Record<string, unknown>;
}

export interface LoopbackCtx {
  userId: string;
  /** GET/POST/PATCH/PUT as the caller. Throws LoopbackError on non-2xx. */
  call<T = any>(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    opts?: { query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<T>;
}

export class LoopbackError extends Error {
  constructor(public status: number, message: string, public payload?: unknown) {
    super(message);
  }
}

export interface ApprovalAdapter {
  kind: string;
  label: string;
  category: string;
  /** Items the caller can act on right now. Must not throw for "no access" — return []. */
  list(ctx: LoopbackCtx): Promise<ApprovalItem[]>;
  decide(
    ctx: LoopbackCtx,
    item: { id: string; meta?: Record<string, unknown> },
    action: ApprovalAction,
    remarks: string,
  ): Promise<void>;
}
