/**
 * Pure model of the stream actions (Extend menu, confirmations, create dialog). The UI writes only through the Plan 3 routes
 * POST /api/he/requisition-streams and POST /api/he/requisition-streams/:id/change; everything here mirrors their validation so a
 * bad value is caught before the request, but the server stays authoritative and its returned stream replaces the row.
 * No React, no I/O, no regex literals (Tailwind scans source text).
 */
import { dayLabel } from "./driveChartModel";
import { TYPE_LABEL, addDaysIso, isIsoDay, isUuidShape } from "./driveCommandModel";
import type { ReadinessProblem, SourceType, StreamStatus, StreamView } from "./driveCommandTypes";
import type { RequisitionOption } from "./commandData";
import { MAX_CREATE_DAYS, WINDOW_MESSAGES, previewWindowChange, windowEnd, type ClientWindowChange } from "./streamWindowClient";

// ---- paths ---------------------------------------------------------------------------------------------------------------------------------
export const STREAMS_PATH = "/api/he/requisition-streams";
export const streamsOfRequisitionPath = (requisitionId: string): string => `${STREAMS_PATH}?requisitionId=${encodeURIComponent(requisitionId)}`;
export const streamPath = (id: string): string => `${STREAMS_PATH}/${encodeURIComponent(id)}`;
export const changePath = (id: string): string => `${streamPath(id)}/change`;
export const readinessPath = (requisitionId: string, t: SourceType): string => `/api/he/requisitions/${encodeURIComponent(requisitionId)}/readiness?sourceType=${t}`;
export const CAMPAIGNS_PATH = "/api/he/campaign-config";
export const LAUNCHES_PATH = "/api/he/launches";
/** The launches of one requisition (every non-pool drive, filtered server side). */
export const launchesPath = (requisitionCode: string): string => `${LAUNCHES_PATH}?requisition=${encodeURIComponent(requisitionCode)}`;

// ---- menu ----------------------------------------------------------------------------------------------------------------------------------
/** The brief's eight actions plus shorten, pause and resume (the change route has them; resume sends "open"). */
export type MenuAction = "extend1" | "extend3" | "extend7" | "extend_to" | "add_day" | "skip_day" | "shorten" | "pause" | "resume" | "close" | "reopen";
export interface MenuItem { action: MenuAction; label: string; enabled: boolean }

const DATE_ACTIONS: readonly MenuAction[] = ["extend_to", "add_day", "skip_day", "shorten"];
export const needsDate = (a: MenuAction): boolean => DATE_ACTIONS.includes(a);
const EXTEND_DAYS: Partial<Record<MenuAction, number>> = { extend1: 1, extend3: 3, extend7: 7 };

const labelOf = (s: Pick<StreamView, "originLabel" | "sourceType">): string => (s.originLabel || "").trim() || TYPE_LABEL[s.sourceType] || "this stream";
const statusOf = (s: { status?: unknown }): StreamStatus => (s.status === "open" || s.status === "paused" || s.status === "closed" ? s.status : "draft");

/** Closed: only Reopen. Draft / open / paused: every window change and Close; Pause only while open; Resume (open) while draft or paused. */
export function menuItems(s: StreamView): MenuItem[] {
  const st = statusOf(s);
  const live = st !== "closed";
  return [
    { action: "extend1", label: "+1 day", enabled: live },
    { action: "extend3", label: "+3 days", enabled: live },
    { action: "extend7", label: "+7 days", enabled: live },
    { action: "extend_to", label: "To a date…", enabled: live },
    { action: "add_day", label: "Add a day…", enabled: live },
    { action: "skip_day", label: "Skip a day…", enabled: live },
    { action: "shorten", label: "Shorten to a date…", enabled: live },
    { action: "pause", label: "Pause stream", enabled: st === "open" },
    { action: "resume", label: st === "draft" ? "Open stream" : "Resume stream", enabled: st === "draft" || st === "paused" },
    { action: "close", label: "Close stream", enabled: live },
    { action: "reopen", label: "Reopen", enabled: st === "closed" },
  ];
}

export interface ActionInput { date?: string; reason?: string; /** reopen only: days added when the window has ended (default 3). */ days?: number; ended?: boolean }
export interface ChangeBody { action: string; days?: number; toDate?: string; day?: string; reason?: string }

const trimmedReason = (r?: string): string | undefined => (typeof r === "string" && r.trim() ? r.trim() : undefined);

/** Request body for POST /requisition-streams/:id/change. */
export function changeBody(a: MenuAction, o: ActionInput = {}): ChangeBody {
  const reason = trimmedReason(o.reason);
  const withReason = (b: ChangeBody): ChangeBody => (reason ? { ...b, reason } : b);
  const n = EXTEND_DAYS[a];
  if (n) return withReason({ action: "extend", days: n });
  switch (a) {
    case "extend_to": return withReason({ action: "extend_to", toDate: o.date });
    case "shorten": return withReason({ action: "shorten", toDate: o.date });
    case "add_day": return withReason({ action: "add_day", day: o.date });
    case "skip_day": return withReason({ action: "skip_day", day: o.date });
    case "pause": return withReason({ action: "pause" });
    case "resume": return withReason({ action: "open" });
    case "close": return withReason({ action: "close" });
    case "reopen": return withReason(o.ended ? { action: "reopen", days: o.days ?? 3 } : { action: "reopen" });
    default: return withReason({ action: a });
  }
}

const windowOf = (s: StreamView) => ({ openFrom: s.openFrom, openDays: Number(s.openDays) || 0, add: Array.isArray(s.add) ? s.add : [], skip: Array.isArray(s.skip) ? s.skip : [] });
/** The current last day: the server's value when present, else the client computation. */
export const currentEnd = (s: StreamView): string => (isIsoDay(s.window?.to) ? s.window.to : windowEnd(windowOf(s)));
/** True when the window's last day is before today (a reopen must then add days). */
export const windowEnded = (s: StreamView, today: string): boolean => currentEnd(s) < today;

function windowChangeOf(a: MenuAction, o: ActionInput): ClientWindowChange | null {
  const n = EXTEND_DAYS[a];
  if (n) return { kind: "extend", days: n };
  if (a === "extend_to") return { kind: "extend_to", date: o.date ?? "" };
  if (a === "shorten") return { kind: "shorten", date: o.date ?? "" };
  if (a === "add_day") return { kind: "add_day", day: o.date ?? "" };
  if (a === "skip_day") return { kind: "skip_day", day: o.date ?? "" };
  if (a === "reopen" && o.ended) return { kind: "extend", days: o.days ?? 3 };
  return null;
}

/** New last day after the change, computed with the server's working-day rule; null when it cannot be computed (no / bad date). */
export function previewEnd(a: MenuAction, s: StreamView, o: ActionInput = {}): string | null {
  const c = windowChangeOf(a, o);
  if (!c) return null;
  const r = previewWindowChange(windowOf(s), c, "0000-01-01"); // wording only: the today check runs in actionErrors
  return r.ok ? r.end : null;
}

/** Client-side checks that mirror the server (limits, dates, status); empty when the request may be sent. */
export function actionErrors(a: MenuAction, s: StreamView, o: ActionInput, today: string): string[] {
  const out: string[] = [];
  const st = statusOf(s);
  const reason = o.reason ?? "";
  if (reason.length > 255) out.push("Reason must be at most 255 characters");
  if (a === "reopen") {
    if (st !== "closed") out.push(`Not allowed while the stream is ${st}`);
    if (o.ended && (!Number.isInteger(o.days ?? 3) || (o.days ?? 3) < 1 || (o.days ?? 3) > MAX_CREATE_DAYS)) { out.push(WINDOW_MESSAGES.invalid_days); return out; }
  } else if (st === "closed") { out.push("Reopen the stream first"); return out; }
  if (a === "pause" && st !== "open") out.push(`Not allowed while the stream is ${st}`);
  if (a === "resume" && st !== "draft" && st !== "paused") out.push(`Not allowed while the stream is ${st}`);
  if (needsDate(a)) {
    if (!o.date) { out.push("Pick a date"); return out; }
    if (!isIsoDay(o.date)) { out.push("Pick a valid date"); return out; }
  }
  const c = windowChangeOf(a, o);
  if (c) {
    const r = previewWindowChange(windowOf(s), c, today);
    if (!r.ok) {
      const f = r as Extract<typeof r, { ok: false }>; // explicit: the app tsconfig is not strict, so `!r.ok` does not narrow
      out.push(a === "reopen" && f.error === "before_today" ? "Extend the window when reopening" : f.message);
    }
  } else if (a === "reopen" && windowEnded(s, today)) out.push("Extend the window when reopening");
  return out;
}

export interface ConfirmText { title: string; body: string; confirm: string }

export function confirmText(a: MenuAction, s: StreamView, o: ActionInput = {}): ConfirmText {
  const label = labelOf(s);
  const oldEnd = dayLabel(currentEnd(s));
  const next = previewEnd(a, s, o);
  const newEnd = next ? dayLabel(next) : "the day you pick";
  const picked = o.date && isIsoDay(o.date) ? dayLabel(o.date) : "the day you pick";
  const moves = `The last day moves from ${oldEnd} to ${newEnd}.`;
  const n = EXTEND_DAYS[a];
  if (n) return { title: `Extend ${label} by ${n} ${n === 1 ? "day" : "days"}?`, body: `${moves} Already invited people are not invited again.`, confirm: "Extend" };
  switch (a) {
    case "extend_to": return { title: `Extend ${label} to ${picked}?`, body: `${moves} Already invited people are not invited again.`, confirm: "Extend" };
    case "shorten": return { title: `Shorten ${label}?`, body: `${moves} Later days stop being planned; days that already have a drive keep it until you close that drive.`, confirm: "Shorten" };
    case "add_day": return { title: `Add ${picked} to ${label}?`, body: `The stream also plans ${picked}. The last day is ${newEnd}.`, confirm: "Add day" };
    case "skip_day": return { title: `Skip ${picked} on ${label}?`, body: `No drive is planned from this stream on ${picked}. The last day becomes ${newEnd}.`, confirm: "Skip day" };
    case "pause": return { title: `Pause ${label}?`, body: "No new days are planned while it is paused. Days that already have a drive keep it.", confirm: "Pause" };
    case "resume": return { title: `${statusOf(s) === "draft" ? "Open" : "Resume"} ${label}?`, body: "Days in the window are planned again. The requisition is checked for readiness first.", confirm: statusOf(s) === "draft" ? "Open" : "Resume" };
    case "close": return { title: `Close ${label} now?`, body: "Future days stop being planned. Days that already have a drive keep it until you close that drive.", confirm: "Close stream" };
    case "reopen":
      return o.ended
        ? { title: `Reopen ${label}?`, body: `The window ended on ${oldEnd}. Reopening adds ${o.days ?? 3} days, so the last day becomes ${newEnd}. The requisition is checked for readiness first.`, confirm: "Reopen" }
        : { title: `Reopen ${label}?`, body: `Planning resumes for the remaining days up to ${oldEnd}. The requisition is checked for readiness first.`, confirm: "Reopen" };
    default: return { title: `Change ${label}?`, body: "", confirm: "Confirm" };
  }
}

export interface ConfirmView { stream: StreamView; ready: boolean; text: ConfirmText; errors: string[] }
/**
 * What the confirmation shows and checks: worded and validated on the freshly re-read stream when it has arrived (a stale row could
 * otherwise apply a relative change such as +3 days on top of someone else's change); not ready (no submit) until it has.
 */
export function confirmView(a: MenuAction, stale: StreamView, fresh: StreamView | null | undefined, o: ActionInput, today: string): ConfirmView {
  const s = fresh ?? stale;
  return { stream: s, ready: !!fresh, text: confirmText(a, s, o), errors: actionErrors(a, s, o, today) };
}

/** Escape inside a host dialog closes the Extend menu first, never the dialog under it, and never while a write runs. */
export const dialogEscapeAllowed = (s: { menuOpen: boolean; busy?: boolean }): boolean => !s.menuOpen && !s.busy;

/** The role="status" line after a successful change (the server's stream is the source of the dates). */
export function successText(a: MenuAction, after: StreamView, changed: boolean, o: ActionInput = {}): string {
  if (!changed) return "Nothing changed";
  const end = dayLabel(currentEnd(after));
  const day = o.date && isIsoDay(o.date) ? dayLabel(o.date) : "";
  if (EXTEND_DAYS[a] || a === "extend_to") return `Stream extended to ${end}`;
  switch (a) {
    case "shorten": return `Stream shortened to ${end}`;
    case "add_day": return `Added ${day}; the last day is ${end}`;
    case "skip_day": return `Skipped ${day}; the last day is ${end}`;
    case "pause": return "Stream paused";
    case "resume": return "Stream opened";
    case "close": return "Stream closed";
    case "reopen": return `Stream reopened; the last day is ${end}`;
    default: return "Stream changed";
  }
}

// ---- errors --------------------------------------------------------------------------------------------------------------------------------
export const STALE_MESSAGE = "The stream changed meanwhile; reload and try again"; // server MSG_CHANGED
export const STALE_TEXT = "This stream was changed by someone else: refresh and retry";
export const FORBIDDEN_TEXT = "You do not have permission for this change: it needs HR or admin access";
export const GONE_TEXT = "This stream is no longer visible to you; reload";
export const GONE_CREATE_TEXT = "That requisition or source is no longer visible to you; reload";
export const GENERIC_TEXT = "That did not work; try again";
export const OVERRIDE_HINT = "Only an admin can override blocking problems, and some problems can never be overridden.";

const SEVERITIES = new Set(["blocking", "warning"]);
/** Valid readiness problems out of an unknown list (anything malformed is dropped). */
export function problemsOf(v: unknown): ReadinessProblem[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is ReadinessProblem => !!p && typeof p === "object" && typeof (p as ReadinessProblem).code === "string"
    && SEVERITIES.has((p as ReadinessProblem).severity) && typeof (p as ReadinessProblem).message === "string");
}

/**
 * The text for a failed write. 400 / 409: the server message verbatim plus its readiness problems (a stale-version 409 gets a clearer
 * line); 403: no permission; 404: gone from view; anything else (5xx, network): generic. Duck-typed on HrmsApiError (status, message,
 * payload) so it needs no import of the API client.
 */
export function errorText(e: unknown, ctx: { what?: "change" | "create"; overrideAsked?: boolean } = {}): { text: string; problems: ReadinessProblem[] } {
  const err = (e && typeof e === "object" ? e : {}) as { status?: unknown; message?: unknown; payload?: unknown };
  const status = typeof err.status === "number" ? err.status : null;
  const message = typeof err.message === "string" && err.message.trim() ? err.message.trim() : "";
  const problems = problemsOf((err.payload as { problems?: unknown } | null | undefined)?.problems);
  if (status === 409 && message === STALE_MESSAGE) return { text: STALE_TEXT, problems: [] };
  if ((status === 400 || status === 409) && message) {
    const blocked = problems.some((p) => p.severity === "blocking");
    return { text: blocked && ctx.overrideAsked ? `${message}. ${OVERRIDE_HINT}` : message, problems };
  }
  if (status === 403) return { text: FORBIDDEN_TEXT, problems: [] };
  // a create 404 names what is missing ("Source not found", "Requisition not found"): shown exactly
  if (status === 404) return { text: ctx.what === "create" ? message || GONE_CREATE_TEXT : GONE_TEXT, problems: [] };
  return { text: GENERIC_TEXT, problems: [] };
}

// ---- create --------------------------------------------------------------------------------------------------------------------------------
export interface CreateForm {
  requisitionId: string; sourceType: SourceType; originId: string; openFrom: string; openDays: number; dailyInvites: number | null;
  open: boolean; override: boolean; reason: string;
}

export const DEFAULT_OPEN_DAYS = 7;
export function defaultCreateForm(today: string, requisitionId = "", sourceType: SourceType = "meta_live"): CreateForm {
  return { requisitionId, sourceType, originId: sourceType === "he" ? "pool" : "", openFrom: addDaysIso(today, 1), openDays: DEFAULT_OPEN_DAYS, dailyInvites: null, open: false, override: false, reason: "" };
}

/** Text of a number input: "" means not set (daily invites use the plan default); anything else must be a number. */
export function parseCount(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  return t.split("").every((c) => c >= "0" && c <= "9") ? Number(t) : Number.NaN;
}

/** The form as typed: numbers stay text until submit so an empty field is "not set", not 0. */
export interface CreateFormText {
  requisitionId: string; sourceType: SourceType; originId: string; openFrom: string; openDays: string; dailyInvites: string;
  open: boolean; override: boolean; reason: string;
}
export const toCreateForm = (t: CreateFormText): CreateForm => ({ ...t, openDays: parseCount(t.openDays) ?? Number.NaN, dailyInvites: parseCount(t.dailyInvites) });

export const BLOCKED_OPEN_TEXT = "Blocking problems stop the stream from opening: fix them, untick Open now, or ask an admin to override";

/** Mirrors the create route's validation; `problems` (from the readiness read) only matter when the stream opens now. */
export const NO_LIVE_SOURCE = "No campaign is linked to this requisition";
export const NO_OLD_SOURCE = "No old Meta drive exists for this requisition yet";
export const LINK_CAMPAIGN_HINT = "Link a campaign to this requisition in Meta Campaigns first";

/** Why no source is chosen, by source type; `count` is how many sources the picker lists (undefined: not known). */
export function sourceError(t: SourceType, count?: number): string {
  if (t === "meta_live") return count === 0 ? NO_LIVE_SOURCE : "Pick a Live Meta campaign";
  if (t === "meta_old") return count === 0 ? NO_OLD_SOURCE : "Pick an old Meta drive";
  return "Pick a source";
}

export function createErrors(f: CreateForm, today: string, problems: ReadinessProblem[] = [], neverOverride: string[] = [], originCount?: number): string[] {
  const out: string[] = [];
  if (!isUuidShape(f.requisitionId || null)) out.push("Pick a requisition");
  // an old-data re-run's origin is a launch drive id (uuid); a typed id is checked for that shape before the request
  if (!(f.sourceType in TYPE_LABEL) || !f.originId || f.originId.length > 64) out.push(sourceError(f.sourceType, originCount));
  else if (f.sourceType === "meta_old" && !isUuidShape(f.originId)) out.push("That is not a valid launch drive id");
  if (!isIsoDay(f.openFrom)) out.push("Pick a valid start date");
  else if (f.openFrom < today) out.push("Start date cannot be before today");
  if (!Number.isInteger(f.openDays) || f.openDays < 1 || f.openDays > MAX_CREATE_DAYS) out.push("Days must be a whole number from 1 to 60");
  if (f.dailyInvites != null && (!Number.isInteger(f.dailyInvites) || f.dailyInvites < 1 || f.dailyInvites > 500)) out.push("Daily invites must be a whole number from 1 to 500");
  if (f.reason.length > 255) out.push("Reason must be at most 255 characters");
  if (f.open && problems.some((p) => p.severity === "blocking") && !(f.override && canOverride(problems, neverOverride))) out.push(BLOCKED_OPEN_TEXT);
  return out;
}

/** Request body for POST /requisition-streams. Override is sent only when ticked AND allowed by the readiness read (the server ignores it for non-admins). */
export function createBody(f: CreateForm, problems: ReadinessProblem[] = [], neverOverride: string[] = []): Record<string, unknown> {
  const reason = trimmedReason(f.reason);
  // defence in depth: the override is sent only when the readiness read says every blocking problem may be overridden
  const override = f.open && f.override && canOverride(problems, neverOverride);
  return {
    requisitionId: f.requisitionId, sourceType: f.sourceType, originId: f.originId, openFrom: f.openFrom, openDays: f.openDays,
    dailyInvites: f.dailyInvites, open: f.open, ...(override ? { override: true } : {}), ...(reason ? { reason } : {}),
  };
}

export interface CampaignOption { campaignId: string; campaignName: string; requisitionCode: string | null; status?: string }
export interface LaunchOption { driveId: string; label: string; requisition: string; kind: string; date?: string; lined?: number }
export const POOL_OPTION = { id: "pool", label: "Pool: ATS history" } as const;

/** Origins the create route accepts for this requisition: its linked campaigns, its campaign / batch launches, or the pool. */
export function originOptions(t: SourceType, req: { code: string }, campaigns: CampaignOption[], launches: LaunchOption[]): Array<{ id: string; label: string }> {
  const code = (req?.code ?? "").trim();
  if (t === "he") return [{ ...POOL_OPTION }];
  if (!code) return [];
  if (t === "meta_live") {
    return (Array.isArray(campaigns) ? campaigns : []).filter((c) => c && c.campaignId && c.requisitionCode === code)
      .map((c) => ({ id: String(c.campaignId), label: String(c.campaignName || c.campaignId) }));
  }
  // the route accepts every non-pool drive of the requisition (kinds campaign, batch, meta ...), so list them all
  return (Array.isArray(launches) ? launches : []).filter((l) => l && l.driveId && l.requisition === code && l.kind !== "pool" && l.kind !== "he")
    .map((l) => {
      const name = (l.label ?? "").trim();
      const when = l.date && isIsoDay(l.date) ? dayLabel(l.date) : "";
      if (name) return { id: String(l.driveId), label: when ? `${name} (${when})` : name };
      if (l.kind === "meta") {
        const n = Number(l.lined);
        const people = Number.isFinite(n) && n > 0 ? ` (${n} ${n === 1 ? "person" : "people"})` : "";
        return { id: String(l.driveId), label: `Meta drive${when ? ` ${when}` : ""}${people}` };
      }
      return { id: String(l.driveId), label: when ? `Re-run ${when}` : "Re-run" };
    });
}

export interface LiveEmptyState { message: string; others: Array<{ id: string; name: string; linkedTo: string | null }>; hint: string }
/** Live Meta with nothing to pick: the cause, the active campaigns and the requisition each is linked to, and what to do. */
export function liveEmptyState(code: string, campaigns: CampaignOption[]): LiveEmptyState {
  const c = (code ?? "").trim();
  const others = (Array.isArray(campaigns) ? campaigns : []).filter((x) => x && x.campaignId && x.status === "active")
    .map((x) => ({ id: String(x.campaignId), name: String(x.campaignName || x.campaignId), linkedTo: x.requisitionCode || null }));
  return { message: c ? `${NO_LIVE_SOURCE} (${c})` : NO_LIVE_SOURCE, others, hint: LINK_CAMPAIGN_HINT };
}

/** The override box shows only when there is something to override and every blocking problem is overridable. */
export function canOverride(problems: ReadinessProblem[], neverOverride: string[]): boolean {
  const blocking = problemsOf(problems).filter((p) => p.severity === "blocking");
  return blocking.length > 0 && blocking.every((p) => !neverOverride.includes(p.code));
}

export interface Readiness { problems: ReadinessProblem[]; neverOverride: string[] }
/** The readiness read's data, defensively; null when unusable. */
export function parseReadiness(data: unknown): Readiness | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { problems?: unknown; neverOverride?: unknown };
  if (!Array.isArray(d.problems)) return null;
  return { problems: problemsOf(d.problems), neverOverride: Array.isArray(d.neverOverride) ? d.neverOverride.filter((x): x is string => typeof x === "string") : [] };
}

/** Blocking first, then warnings; each with its word (status is never colour alone). */
export function problemRows(problems: ReadinessProblem[]): Array<ReadinessProblem & { word: "Blocking" | "Warning" }> {
  const list = problemsOf(problems);
  return [...list.filter((p) => p.severity === "blocking"), ...list.filter((p) => p.severity === "warning")]
    .map((p) => ({ ...p, word: p.severity === "blocking" ? "Blocking" : "Warning" }));
}

/** The insight's requisition as the only (locked) option, labelled from the filter options when it is there, else by its code. */
export function presetOptions(options: RequisitionOption[], preset: { id: string; code: string } | null | undefined, lock: boolean): { requisitions: RequisitionOption[]; lock: boolean } {
  if (!preset || !preset.id) return { requisitions: options, lock };
  const known = options.find((r) => r.id === preset.id);
  const code = preset.code || known?.code || "";
  return { requisitions: [{ id: preset.id, label: known?.label || code || "This requisition", branch: known?.branch ?? "", code }], lock: true };
}

export function createSuccessText(s: Pick<StreamView, "status"> | null | undefined): string {
  return s?.status === "open" ? "Stream created and opened" : "Stream created as a draft; open it from its row's Extend menu";
}

/** Streams of a row: the requisition's streams of the row's type, live ones first. */
export function rowStreams(all: unknown, sourceType: SourceType): StreamView[] {
  if (!Array.isArray(all)) return [];
  const rank: Record<StreamStatus, number> = { open: 0, paused: 1, draft: 2, closed: 3 };
  return (all as StreamView[]).filter((s) => s && typeof s.id === "string" && s.sourceType === sourceType)
    .sort((a, b) => rank[statusOf(a)] - rank[statusOf(b)] || labelOf(a).localeCompare(labelOf(b)));
}

export const STATUS_WORD: Record<StreamStatus, string> = { draft: "Draft", open: "Open", paused: "Paused", closed: "Closed" };
export { labelOf as streamLabel, statusOf as streamStatus };
