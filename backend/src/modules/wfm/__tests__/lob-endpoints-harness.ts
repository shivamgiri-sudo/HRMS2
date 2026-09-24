/**
 * Runner table shared by the LOB endpoint tests (with-lob variants) and the baseline snapshot
 * test (no lob). Each runner calls one endpoint/service with an optional lobId and resolves once
 * the mocked db has recorded its statements. Imports of the modules under test happen lazily so
 * the calling test file's vi.mock() calls are in place first.
 */
import { callHandler, getHandler } from './lobTestUtils';

export type Runner = (lobId?: string) => Promise<{ status: number; body: any }>;

const withLob = (q: Record<string, unknown>, lobId?: string) => (lobId === undefined ? q : { ...q, lobId });

/** legacy=true drops the query params the pre-LOB code ignored, so the same calls run on origin/main. */
export function buildRunners(legacy = false): Record<string, Runner> {
  const route = (loader: () => Promise<any>, exportName: string, path: string, query: Record<string, unknown>) =>
    async (lobId?: string) => {
      const mod = await loader();
      const out = await callHandler(getHandler(mod[exportName], 'get', path), { query: withLob(query, lobId) });
      return { status: out.status, body: out.body };
    };

  const compliance = () => import('../wfm-compliance-analytics.routes');
  const audit = () => import('../roster-audit.routes');
  const intel = () => import('../roster-intelligence.routes');
  const imports = () => import('../roster-import.routes');
  const q = { branchId: 'b1', processId: 'p1', period: '2026-08' };

  return {
    'compliance summary': route(compliance, 'wfmComplianceAnalyticsRouter', '/summary', q),
    'compliance summary (no branch)': route(compliance, 'wfmComplianceAnalyticsRouter', '/summary', { processId: 'p1', period: '2026-08' }),
    'compliance violations': route(compliance, 'wfmComplianceAnalyticsRouter', '/violations', legacy ? { branchId: 'b1', period: '2026-08' } : q),
    'compliance trend': route(compliance, 'wfmComplianceAnalyticsRouter', '/trend', legacy ? { branchId: 'b1' } : { branchId: 'b1', processId: 'p1' }),
    'audit trails': route(audit, 'rosterAuditRouter', '/trails', { branchId: 'b1', processId: 'p1', dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
    'audit summary': route(audit, 'rosterAuditRouter', '/summary', legacy ? { branchId: 'b1', dateFrom: '2026-08-01', dateTo: '2026-08-31' } : { branchId: 'b1', processId: 'p1', dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
    'unplanned-absences': route(intel, 'rosterIntelligenceRouter', '/unplanned-absences', legacy ? { date: '2026-09-01' } : { date: '2026-09-01', branchId: 'b1', processId: 'p1' }),
    'status-summary': route(imports, 'rosterImportRouter', '/status-summary', { fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'b1', processId: 'p1' }),
  };
}
