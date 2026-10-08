/** Shapes of /api/process-dashboard responses. Every field the UI reads is optional-chained: the backend contract is config-driven. */
export type Category = "sales" | "support_inbound" | "outbound" | "collections";
export type KpiStatus = "good" | "warn" | "bad" | "nodata";

export interface ProcessConfigSummary {
  processId: string; processCode: string; processName: string; category: Category | string;
  label: string; enabled: boolean; configured: boolean; refreshSeconds: number;
}
export interface SparkPoint { date: string; value: number | null }
export interface Kpi {
  key: string; label: string; unit?: string; direction?: string;
  available?: boolean; value: number | null; prev?: number | null; deltaPct?: number | null; target?: number | null;
  status?: KpiStatus; spark?: SparkPoint[];
}
export interface Freshness { lastDataAt?: string | null; latestDate?: string | null; rows?: number }
export interface PerformerRow { agentCode: string; name?: string; metric?: string; value: number | null }
export interface Anomaly { type: string; severity: "high" | "medium" | "low" | string; date?: string; agentCode?: string; name?: string; detail?: string }
export type BreakdownRow = { tl?: string; lob?: string; agents?: number } & Record<string, unknown>;
export interface Overview {
  freshness?: Freshness; kpis?: Kpi[]; trend?: Array<Record<string, unknown> & { date: string }>;
  byTl?: BreakdownRow[]; byLob?: BreakdownRow[];
  topBottom?: { top?: PerformerRow[]; bottom?: PerformerRow[] };
  anomalies?: Anomaly[]; quality?: { avgScore?: number | null; audits?: number; fatal?: number };
  categoryProfile?: { category?: string; label?: string; columns?: Array<string | { key: string; label: string; unit?: string; available?: boolean }>; [k: string]: unknown };
}
export type AgentRow = { agentCode: string; name?: string; tl?: string; tlName?: string; lob?: string; rank?: number; qaScore?: number | null; spark?: SparkPoint[] } & Record<string, unknown>;
export interface AgentsResponse { rows?: AgentRow[]; total?: number }
export interface AgentDetail {
  profile?: Record<string, unknown>; totals?: Record<string, unknown>;
  daily?: Array<Record<string, unknown> & { date: string }>;
  qa?: Array<{ id: string | number; auditDate: string; score: number | null; fatal?: boolean; status?: string }>;
  rawRows?: Array<Record<string, unknown>>; rank?: { metric?: string; position?: number | null; of?: number } | null;
  vsTeam?: { team?: { tl?: string | null; agents?: number; metrics?: Record<string, number | null> }; process?: { metrics?: Record<string, number | null> };
    deltaVsTeamPct?: Record<string, number | null>; deltaVsProcessPct?: Record<string, number | null> } | null;
}
export interface DayDetail { date?: string; rows?: number; agents?: AgentRow[]; hourly?: Array<Record<string, unknown>> | null }
export interface LiveResponse { changed?: boolean; etag?: string; freshness?: Freshness; kpis?: Array<{ key: string; label?: string; value: number | null; baseline?: number | null; deltaPct?: number | null; unit?: string }> }
