import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { PD_API } from "../api";

export type Severity = "info" | "warn" | "critical";
export type Channel = "in_app" | "email";
export type Comparator = "gt" | "gte" | "lt" | "lte";
export interface RecipientSpec { roles: string[]; tls: string[]; employeeIds: string[] }
export interface MetricChoice { key: string; label: string; kind: "kpi" | "anomaly"; unit?: string; direction?: string; target?: number | null; available: boolean }
export interface AlertRule {
  id: string; name: string; metricKey: string; comparator: Comparator; threshold: number; windowDays: number; consecutiveDays: number; scopeTl: string | null; scopeLob: string | null;
  severity: Severity; recipients: RecipientSpec; channels: Channel[]; cooldownMinutes: number; enabled: boolean; lastEvaluatedAt: string | null; lastFiredAt: string | null;
}
export type RuleInput = Omit<AlertRule, "id" | "lastEvaluatedAt" | "lastFiredAt">;
export interface AlertEvent {
  id: string; ruleId: string; ruleName: string | null; dataDate: string; firedAt: string; metricKey: string; metricValue: number | null; threshold: number | null; severity: Severity; message: string;
  context?: { agents?: Array<{ agentCode: string; name: string | null; detail: string }> } | null; notified: boolean; acknowledgedBy: string | null; acknowledgedAt: string | null;
}
export interface EventsPage { rows: AlertEvent[]; total: number; open: number }
export interface Backtest { days: number; fired: number; suppressedByCooldown: number; evaluatedDays: number; asOf: string | null; timeline: Array<{ date: string; value: number | null; fired: boolean; suppressedByCooldown: boolean }>; sample: Array<{ date: string; message: string }> }
export interface Digest { id: string; frequency: "daily" | "weekly"; sendTime: string; recipients: RecipientSpec; enabled: boolean; lastSentAt: string | null }
export interface DigestInput { frequency: "daily" | "weekly"; sendTime: string; recipients: RecipientSpec; enabled: boolean }
export interface SendSummary { recipients: number; dropped: number; inApp: number; email: number; emailFailed: number; emailSkippedNoAddress: number; emailError?: string; html?: string; subject?: string; sent?: boolean }
export interface RecipientPreview { count: number; dropped: number; withEmail: number; names: string[] }
export interface PersonHit { employeeId: string; name: string; hasEmail: boolean }

const base = (id: string) => `${PD_API}/${encodeURIComponent(id)}/alerts`;
const unwrap = async <T,>(req: Promise<HrmsEnvelope<T>>): Promise<T> => (await req).data as T;
export const alertsKey = (id: string, ...rest: string[]) => ["process-dashboard", id, "alerts", ...rest] as const;

export const fetchAlertSummary = (id: string) => unwrap<{ open: number; canManage: boolean }>(hrmsApi.get(`${base(id)}/summary`));
export const fetchAlertMetrics = (id: string) => unwrap<MetricChoice[]>(hrmsApi.get(`${base(id)}/metrics`));
export const fetchRules = (id: string) => unwrap<AlertRule[]>(hrmsApi.get(`${base(id)}/rules`));
export const createRule = (id: string, r: RuleInput) => unwrap<AlertRule>(hrmsApi.post(`${base(id)}/rules`, r));
export const updateRule = (id: string, ruleId: string, r: RuleInput) => unwrap<AlertRule>(hrmsApi.put(`${base(id)}/rules/${encodeURIComponent(ruleId)}`, r));
export const deleteRule = (id: string, ruleId: string) => unwrap<{ deleted: boolean }>(hrmsApi.delete(`${base(id)}/rules/${encodeURIComponent(ruleId)}`));
export const backtestRule = (id: string, r: Partial<RuleInput>) => unwrap<Backtest>(hrmsApi.post(`${base(id)}/backtest`, r));
export const testRule = (id: string, ruleId: string) => unwrap<SendSummary>(hrmsApi.post(`${base(id)}/rules/${encodeURIComponent(ruleId)}/test`, {}));
export const fetchEvents = (id: string, status: "open" | "acknowledged" | "all") => unwrap<EventsPage>(hrmsApi.get(`${base(id)}/events?status=${status}&limit=100`));
export const ackEvent = (id: string, eventId: string) => unwrap<AlertEvent>(hrmsApi.post(`${base(id)}/events/${encodeURIComponent(eventId)}/ack`, {}));
export const fetchDigests = (id: string) => unwrap<Digest[]>(hrmsApi.get(`${base(id)}/digests`));
export const saveDigest = (id: string, d: DigestInput) => unwrap<Digest>(hrmsApi.put(`${base(id)}/digests`, d));
export const testDigest = (id: string, frequency: "daily" | "weekly") => unwrap<SendSummary>(hrmsApi.post(`${base(id)}/digests/test`, { frequency }));
export const sendDigestNow = (id: string, frequency: "daily" | "weekly") => unwrap<SendSummary>(hrmsApi.post(`${base(id)}/digests/send-now`, { frequency }));
export const searchPeople = (id: string, q: string) => unwrap<PersonHit[]>(hrmsApi.get(`${base(id)}/recipients/search?q=${encodeURIComponent(q)}`));
export const previewRecipients = (id: string, recipients: RecipientSpec) => unwrap<RecipientPreview>(hrmsApi.post(`${base(id)}/recipients/preview`, { recipients }));
