// Shape of GET /api/process-live/gs1/dashboard (backend gs1-dashboard.service.ts).

export type Gs1LobKey = "email" | "dataCard" | "approval";

export interface Gs1Labelled { label: string; count: number }

export interface Gs1LobSummary {
  lob: Gs1LobKey; label: string; unit: string; hasData: boolean;
  received: number; processed: number | null; pending: number | null; rejected: number | null;
  closurePct: number | null; closureLabel: string;
  avgTatMin: number | null; withinSlaPct: number | null; slaLabel: string;
  productivity: number | null; analysts: number; analystDays: number; activeDays: number;
  gtin: number | null;
}

export interface Gs1AnalystStat {
  analyst: string; items: number; processed: number | null; days: number; perDay: number | null;
  gtin: number | null; slaPct: number | null; errorPct: number | null;
}

export interface Gs1EmailDetail {
  summary: Gs1LobSummary; images: number; statusCoverage: number;
  daily: Array<{ date: string; received: number; closed: number | null; gtin: number; slaPct: number | null }>;
  statusMix: Gs1Labelled[]; statusLabels: Gs1Labelled[]; slaBuckets: Gs1Labelled[]; queryTypes: Gs1Labelled[];
  byAnalyst: Gs1AnalystStat[];
}

export interface Gs1DataCardDetail {
  summary: Gs1LobSummary; completionCoverage: number; tatCoverage: number; avgGtinPerTask: number | null;
  daily: Array<{ date: string; received: number; completed: number | null; gtin: number }>;
  statusMix: Gs1Labelled[]; categories: Gs1Labelled[]; byAnalyst: Gs1AnalystStat[];
}

export interface Gs1ApprovalDetail {
  summary: Gs1LobSummary; approved: number; approvalPct: number | null; rejectionPct: number | null;
  errors: number; errorPct: number | null; sku: number;
  daily: Array<{ date: string; received: number; approved: number; rejected: number; pending: number; errors: number }>;
  statusMix: Gs1Labelled[]; reasons: Gs1Labelled[]; byAnalyst: Gs1AnalystStat[];
}

export interface Gs1ComparisonRow {
  lob: Gs1LobKey; label: string; unit: string; received: number; processed: number | null; pending: number | null;
  closurePct: number | null; avgTatMin: number | null; withinSlaPct: number | null; productivity: number | null;
}

export interface Gs1ReconRow { check: string; expected: number; actual: number; diff: number; ok: boolean }
export interface Gs1DqRow { lob: string; check: string; count: number; severity: "ok" | "info" | "warn" | "error"; note: string }

export interface Gs1Overall {
  unit: string; unitNote: string; received: number; processed: number | null; pending: number | null;
  closurePct: number | null; closureBasis: string; analysts: number; lobsWithData: number; hasData: boolean;
}

export interface Gs1DashboardData {
  period: { from: string; to: string };
  filters: { analyst: string | null; lob: Gs1LobKey | null };
  filterOptions: { analysts: string[]; lobs: Gs1LobKey[] };
  teamFilter: { available: boolean; reason: string };
  overall: Gs1Overall;
  lobs: { email: Gs1EmailDetail | null; dataCard: Gs1DataCardDetail | null; approval: Gs1ApprovalDetail | null };
  comparison: {
    rows: Gs1ComparisonRow[];
    highlights: { highestInflow: string | null; highestBacklog: string | null; lowestClosure: string | null; worstSla: string | null; slowestTat: string | null };
  };
  reconciliation: Gs1ReconRow[];
  dataQuality: Gs1DqRow[];
  tatBucketNote: string;
  lastRefresh: { email: string | null; dataCard: string | null; approval: string | null; latest: string | null };
  generatedAt: string;
}
