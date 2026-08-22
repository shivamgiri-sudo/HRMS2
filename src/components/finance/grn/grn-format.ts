import type { StampTone } from "@/components/finance/grn/StatusStamp";
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from "@/lib/date-format";

/**
 * Shared formatting and status vocabulary for the GRN page.
 *
 * Each of the four tabs used to carry its own copy of these, and they had drifted: the approval
 * queue's tone map was missing `payment_scheduled`, `consumption_reversed` and `approved`, so the
 * same GRN showed a grey "neutral" stamp in the queue and a coloured one in History. One list,
 * one set of colours, whichever surface you are looking at.
 */

/** Indian currency. Two decimals by default; History passes 0 because a timeline table reads
 *  better with whole rupees, and that difference is deliberate rather than drift. */
export function money(value: unknown, maximumFractionDigits: 0 | 2 = 2) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits,
  }).format(Number(value ?? 0));
}

/** `branch_head_approved` → `Branch Head Approved`. */
export function labelStatus(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const TONE_BY_STATUS: Record<string, StampTone> = {
  paid: "ok",
  approved: "ok",
  pending_accounts_payment: "ok",
  payment_scheduled: "ok",
  partially_paid: "ok",
  rejected: "crit",
  cancelled: "crit",
  consumption_reversed: "info",
  submitted: "warn",
  branch_head_approved: "warn",
};

/** A GRN's lifecycle status → stamp colour. Anything unrecognised stays neutral rather than
 *  guessing, so a status added on the backend degrades to grey instead of miscolouring. */
export function grnStatusTone(status: string): StampTone {
  return TONE_BY_STATUS[status] ?? "neutral";
}

/**
 * Validation / extraction / duplicate-check outcomes → stamp colour. Distinct from the GRN
 * lifecycle above: these describe one check, not the document.
 *
 * Narrower than StampTone on purpose. A check has an outcome — it passed, it warns, it failed —
 * so "neutral" is never one of the answers, and saying so lets this feed GrnAlert (which has no
 * neutral tone) without a cast.
 */
export function checkTone(value: string): "ok" | "warn" | "crit" {
  if (["passed", "completed", "matched", "overridden", "cleared"].includes(value)) return "ok";
  if (["warning", "manual_review", "near_match", "pending", "processing"].includes(value)) return "warn";
  return "crit";
}

/** Date only, DD-MM-YYYY. Delegates to the shared `@/lib/date-format` helper — kept as its own
 *  exported name here because every existing caller imports `dateLabel` from this file, not from
 *  the shared utility directly. */
export function dateLabel(value: unknown) {
  return formatDateDDMMYYYY(value);
}

/**
 * Date + time, DD-MM-YYYY HH:MM, for the History timeline where the time is the whole point.
 *
 * Returns null rather than a placeholder on a missing or unparseable value — callers branch on
 * that null to tell "this stage has not happened yet" from "this stage happened at some time".
 * Delegates to the shared `@/lib/date-format` helper, which preserves this null contract.
 */
export function dateTimeLabel(value: unknown): string | null {
  return formatDateTimeDDMMYYYY(value);
}
