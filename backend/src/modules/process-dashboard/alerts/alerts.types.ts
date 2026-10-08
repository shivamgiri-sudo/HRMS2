/** Process Dashboard alerts -- shared shapes and input validation (pure; scope checks that need the DB live in alerts.recipients.ts). */
import { COMPARATORS, isAnomalyKey, type Comparator } from "./alerts.evaluator.js";
import { VIEWER_ROLES } from "../pd.config.service.js";
import { PdError } from "../pd.source.js";

export const SEVERITIES = ["info", "warn", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const CHANNELS = ["in_app", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
export const FREQUENCIES = ["daily", "weekly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const MAX_RULES_PER_PROCESS = 50;
export const MAX_RECIPIENTS = 50;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface RecipientSpec { roles: string[]; tls: string[]; employeeIds: string[] }
export interface AlertRule {
  id: string; processId: string; name: string; metricKey: string; comparator: Comparator; threshold: number; windowDays: number; consecutiveDays: number;
  scopeTl: string | null; scopeLob: string | null; severity: Severity; recipients: RecipientSpec; channels: Channel[]; cooldownMinutes: number; enabled: boolean;
  lastEvaluatedAt: string | null; lastFiredAt: string | null; createdBy: string | null; createdAt: string | null; updatedAt: string | null;
}
export type RuleDraft = Omit<AlertRule, "id" | "processId" | "lastEvaluatedAt" | "lastFiredAt" | "createdBy" | "createdAt" | "updatedAt">;
export interface AlertEvent {
  id: string; ruleId: string; ruleName: string | null; processId: string; dataDate: string; firedAt: string; metricKey: string; metricValue: number | null; threshold: number | null;
  severity: Severity; message: string; context: unknown; notified: boolean; notifiedAt: string | null; notifySummary: unknown; acknowledgedBy: string | null; acknowledgedAt: string | null;
}
export interface Digest { id: string; processId: string; frequency: Frequency; sendTime: string; recipients: RecipientSpec; enabled: boolean; lastSentAt: string | null }

const bad = (msg: string): never => { throw new PdError(400, "INVALID_ALERT", msg); };
const strArr = (v: unknown, what: string, max: number, maxLen: number): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return bad(`${what} must be a list`);
  const out = [...new Set(v.map((x) => (typeof x === "string" ? x.trim() : bad(`${what} must be a list of text`))).filter(Boolean))];
  if (out.length > max) bad(`${what}: at most ${max} entries`);
  if (out.some((x) => x.length > maxLen)) bad(`${what}: entries are limited to ${maxLen} characters`);
  return out;
};

/** Shape-validates a recipients spec. Whether each person is inside the process scope is checked separately against the DB. */
export function parseRecipients(input: unknown): RecipientSpec {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const roles = [...new Set(strArr(o.roles, "recipients.roles", 10, 40).map((r) => r.toLowerCase()))];
  for (const r of roles) if (!VIEWER_ROLES.includes(r)) bad(`role "${r}" cannot be a recipient (dashboard viewer roles only)`);
  const tls = strArr(o.tls, "recipients.tls", 20, 120);
  const employeeIds = strArr(o.employeeIds, "recipients.employeeIds", MAX_RECIPIENTS, 36);
  for (const id of employeeIds) if (!UUID_RE.test(id)) bad("recipients.employeeIds must be employee ids");
  return { roles, tls, employeeIds };
}
export const recipientsEmpty = (s: RecipientSpec): boolean => !s.roles.length && !s.tls.length && !s.employeeIds.length;

export function parseRuleInput(input: Record<string, unknown>, metricKeys: ReadonlyMap<string, { available: boolean }>, opts: { requireRecipients?: boolean } = {}): RuleDraft {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) bad("name is required"); if (name.length > 120) bad("name is too long (max 120)");
  const metricKey = typeof input.metricKey === "string" ? input.metricKey : "";
  const m = metricKeys.get(metricKey);
  if (!m) bad("metricKey is not a KPI or anomaly of this process's dashboard");
  if (!m!.available) bad("that metric is not available for this process (its source columns are not mapped)");
  const anomaly = isAnomalyKey(metricKey);
  const comparator = anomaly ? "gte" : String(input.comparator ?? "");
  if (!(COMPARATORS as readonly string[]).includes(comparator)) bad(`comparator must be one of ${COMPARATORS.join(", ")}`);
  const threshold = Number(input.threshold ?? (anomaly ? 1 : NaN));
  if (!Number.isFinite(threshold) || Math.abs(threshold) > 1e12) bad("threshold must be a number");
  if (anomaly && (!Number.isInteger(threshold) || threshold < 1)) bad("for an anomaly rule the threshold is the minimum number of agents (whole number, at least 1)");
  const int = (v: unknown, dflt: number, lo: number, hi: number, what: string): number => {
    const n = v === undefined || v === null || v === "" ? dflt : Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) bad(`${what} must be a whole number ${lo}-${hi}`);
    return n;
  };
  const windowDays = anomaly ? 1 : int(input.windowDays, 1, 1, 31, "windowDays");
  const consecutiveDays = anomaly ? 1 : int(input.consecutiveDays, 1, 1, 14, "consecutiveDays");
  const cooldownMinutes = int(input.cooldownMinutes, 1440, 0, 43200, "cooldownMinutes");
  const sev = String(input.severity ?? "warn");
  if (!(SEVERITIES as readonly string[]).includes(sev)) bad(`severity must be one of ${SEVERITIES.join(", ")}`);
  const channels = strArr(input.channels ?? ["in_app"], "channels", 2, 10);
  if (!channels.length) bad("choose at least one channel");
  for (const c of channels) if (!(CHANNELS as readonly string[]).includes(c)) bad(`unknown channel "${c}"`);
  const scope = (v: unknown, what: string): string | null => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const s = String(v).trim(); if (s.length > 120) bad(`${what} is too long`); return s;
  };
  const recipients = parseRecipients(input.recipients);
  if (opts.requireRecipients !== false && recipientsEmpty(recipients)) bad("add at least one recipient (a role, a team leader or a person)");
  return { name, metricKey, comparator: comparator as Comparator, threshold, windowDays, consecutiveDays, scopeTl: scope(input.scopeTl, "scopeTl"), scopeLob: scope(input.scopeLob, "scopeLob"),
    severity: sev as Severity, recipients, channels: channels as Channel[], cooldownMinutes, enabled: input.enabled === undefined ? true : input.enabled === true || input.enabled === 1 || input.enabled === "1" };
}

export function parseDigestInput(input: Record<string, unknown>): { frequency: Frequency; sendTime: string; recipients: RecipientSpec; enabled: boolean } {
  const frequency = String(input.frequency ?? "daily");
  if (!(FREQUENCIES as readonly string[]).includes(frequency)) bad(`frequency must be one of ${FREQUENCIES.join(", ")}`);
  const sendTime = String(input.sendTime ?? "08:00");
  if (!TIME_RE.test(sendTime)) bad("sendTime must be HH:MM (24h)");
  const recipients = parseRecipients(input.recipients);
  const enabled = input.enabled === true || input.enabled === 1 || input.enabled === "1";
  if (enabled && recipientsEmpty(recipients)) bad("add at least one recipient before enabling the digest");
  return { frequency: frequency as Frequency, sendTime, recipients, enabled };
}
