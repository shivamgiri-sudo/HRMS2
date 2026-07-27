export type PerformanceGovernanceAuditRow = {
  id: string;
  actorUserId: string | null;
  actionCode: string;
  entityType: string;
  entityId: string | null;
  datasetId: string | null;
  datasetKey: string | null;
  datasetName: string | null;
  processName: string | null;
  branchName: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
};

export type PaginatedPerformanceGovernanceAudit = {
  rows: PerformanceGovernanceAuditRow[];
  actions: string[];
  total: number;
  page: number;
  pageSize: number;
};
