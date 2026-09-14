export type InsightSeverity = "critical" | "warning" | "info" | "success";

export interface AIInsight {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  action_label?: string;
  action_url?: string;
}
