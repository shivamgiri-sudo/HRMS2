/**
 * Sparse, opt-in map from a notification-event.service.ts catalogue `event_code` to a
 * registered SmartPing DLT template (smartping-dlt-registry.ts) plus a function that pulls
 * that template's required variables out of the same `data` object the event's own
 * email/portal templates render against.
 *
 * Deliberately NOT a blanket "try buildSMS(eventCode, data)" for every catalogue event.
 * Investigated 2026-08-18: of 46 catalogue events, at most ~8 have a plausible match to one of
 * the 63 registered DLT templates by intent, and NONE match exactly on both key and variable
 * names without translation — catalogue and registry were built independently. A wrong guess
 * doesn't send a wrong SMS (buildSMS throws on a missing/undefined variable, caught by the
 * caller and logged, not silently mangled), but it does turn "we chose not to attempt" into an
 * indistinguishable "we tried and failed", which is exactly the visibility problem this fix is
 * closing. So this map starts with only the handful confidently verified against both the
 * catalogue's own Handlebars template (the guaranteed set of fields the caller supplies, since
 * the event's title/message would not render without them) and the registry's variableNames.
 *
 * Adding an entry here is safe and expected as more DLT templates get registered upstream with
 * SmartPing/TRAI — until then, an event absent from this map is not attempted over SMS at all
 * (dispatch.service.ts._deliver marks it status='skipped', not 'failed').
 */

import { buildSMS } from "./smartping-dlt-registry.js";

export type SmsVarBuilder = (data: Record<string, unknown> | undefined) => Record<string, string | number> | null;

interface EventSmsMapping {
  templateKey: string;
  buildVars: SmsVarBuilder;
}

/**
 * dispatch.service.ts's `send()` always sets `context.employee.name = emp.full_name`
 * unconditionally (after spreading dto.data.employee), regardless of what the caller passed —
 * so this is the one field guaranteed present for every dispatch, unlike anything the caller's
 * own `data` payload may or may not include. Every registered DLT template needs a name as its
 * first variable ("Dear {#var#}, ..."), so this is read the same way for every mapped event
 * below rather than guessing at a top-level `data.name` that may not exist.
 */
function readEmployeeName(data: Record<string, unknown> | undefined): string | undefined {
  const employee = data?.employee as Record<string, unknown> | undefined;
  const name = employee?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function readString(data: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!data) return undefined;
  for (const key of keys) {
    const v = data[key];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

export const EVENT_SMS_TEMPLATE_MAP: Readonly<Record<string, EventSmsMapping>> = {
  // notification-event.service.ts's leave_submitted template: "Your {{leave_type}} request
  // from {{from_date}} to {{to_date}} has been submitted for approval." — from_date/to_date
  // confirmed as the caller-supplied field names by that template string itself.
  leave_submitted: {
    templateKey: "leave_request_submitted",
    buildVars: (data) => {
      const name = readEmployeeName(data);
      const fromDate = readString(data, "from_date");
      const toDate = readString(data, "to_date");
      if (!name || !fromDate || !toDate) return null;
      return { name, from_date: fromDate, to_date: toDate };
    },
  },

  // "Your roster for {{period}} is now available." — registry's roster_published wants
  // [name, week]; catalogue's field is named period, not week, mapped straight across.
  roster_published: {
    templateKey: "roster_published",
    buildVars: (data) => {
      const name = readEmployeeName(data);
      const week = readString(data, "period", "week");
      if (!name || !week) return null;
      return { name, week };
    },
  },

  // "The course '{{course_name}}' has been assigned to you. Please complete it by
  // {{deadline}}." — registry's training_assigned wants [name, module_name, deadline];
  // course_name -> module_name is the only name difference, deadline matches directly.
  training_assigned: {
    templateKey: "training_assigned",
    buildVars: (data) => {
      const name = readEmployeeName(data);
      const moduleName = readString(data, "course_name", "module_name");
      const deadline = readString(data, "deadline");
      if (!name || !moduleName || !deadline) return null;
      return { name, module_name: moduleName, deadline };
    },
  },

  // "Your support ticket {{ticket_code}} has been raised for {{category}}." — registry's
  // ticket_created wants [name, ticket_id, status]; ticket_code -> ticket_id, and this event
  // only ever fires on creation so status is fixed as "Created" rather than guessed.
  support_ticket_created: {
    templateKey: "ticket_created",
    buildVars: (data) => {
      const name = readEmployeeName(data);
      const ticketId = readString(data, "ticket_code", "ticket_id");
      if (!name || !ticketId) return null;
      return { name, ticket_id: ticketId, status: "Created" };
    },
  },
};

/**
 * Resolves an event_code to {dltContentId, body}, or null when there's no mapping for this
 * event, no data to build variables from (e.g. a retry(), which does not have the original
 * dispatch's data object), or the mapped variables couldn't all be found. null means "do not
 * attempt this over SMS" — the caller must not call provider.send() and should record
 * status='skipped', not attempt-and-fail.
 */
export function resolveSmsForEvent(
  eventCode: string | undefined,
  data: Record<string, unknown> | undefined,
): { dltContentId: string; body: string } | null {
  if (!eventCode) return null;
  const mapping = EVENT_SMS_TEMPLATE_MAP[eventCode];
  if (!mapping) return null;
  const vars = mapping.buildVars(data);
  if (!vars) return null;
  try {
    const { dltContentId, body } = buildSMS(mapping.templateKey, vars);
    return { dltContentId, body };
  } catch {
    // buildSMS throws on a missing/invalid variable — treat as unmappable rather than
    // propagating, so the caller can log a clean "skipped" rather than an unhandled rejection.
    return null;
  }
}
