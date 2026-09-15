/**
 * Which live dashboard a process opens, and which /api/process-live endpoint
 * groups each dashboard calls. Pure (no imports) so the frontend test suite can
 * load it: src/tests/live-dashboard-scope-parity.test.ts asserts that
 * detectLiveDashboard agrees with the frontend's detectDiallerProcess
 * (src/pages/DiallerLivePanel.tsx) — a process must open the same dashboard the
 * backend lets its viewer read, or its own users get 403s.
 */

export type LiveDashboard =
  | 'inbound' | 'reginald-cart' | 'molecular-email' | 'reginald-email'
  | 'finnable' | 'billing' | 'gs1'
  | 'gnc' | 'bella-vita' | 'clovia' | 'neemans' | 'viega' | 'exicom' | 'du-digital'
  | 'dalmia';

/**
 * Mirrors detectDiallerProcess, plus Dalmia, which the frontend opens from the
 * Sales view by process code (PROCESS_SALES_MAP) rather than from this name match.
 */
export function detectLiveDashboard(processName: string, processCode?: string | null): LiveDashboard | null {
  if ((processCode ?? '').toUpperCase() === 'DALMIA_CEMENT') return 'dalmia';
  const n = processName.toLowerCase();
  // Bla Bli Blu's inbound only: "bla bli" rather than bare "bla"/"bli"/"blu"
  // (matched "Bluevine Technologies"), and no generic "inbound" rule (matched
  // "INBOUND CUSTOMER SERVICES", a separate NOIDA process; the INBOUND
  // campaign's agents are all Bla Bli Blu employees).
  if (n.includes('bla bli') || n.includes('bla_bli') || n.includes('blabli') || n.includes('b-3') || n.includes('b3 ') || n.includes('b3_')) return 'inbound';
  if (n.includes('reginald') && n.includes('email')) return 'reginald-email';
  if (n.includes('molecular')) return 'molecular-email';
  if (n.includes('reginald')) return 'reginald-cart';
  if (n.includes('finnable')) return 'finnable';
  if (n.includes('billing')) return 'billing';
  if (n.includes('gs1')) return 'gs1';
  if (n.includes('gnc')) return 'gnc';
  if (n.includes('bella') || n.includes('bevzilla') || n.includes('embark')) return 'bella-vita';
  if (n.includes('clovia')) return 'clovia';
  if (n.includes('neeman')) return 'neemans';
  if (n.includes('viega')) return 'viega';
  if (n.includes('exicom')) return 'exicom';
  if (n.includes('du digital') || n.includes('du_digital')) return 'du-digital';
  return null;
}

/**
 * Endpoint group (first path segment under /api/process-live) → the dashboards
 * that call it. The Reginald dashboard carries Molecular and Reginald Email tabs,
 * so it reads those groups too. A group missing here is refused for everyone
 * but super_admin/admin/ceo — live-dashboard-keys.test.ts fails when a route
 * group in process-live-dashboard.routes.ts has no entry.
 */
export const LIVE_GROUP_USERS: Readonly<Record<string, readonly LiveDashboard[]>> = {
  'inbound':         ['inbound'],
  'reginald-cart':   ['reginald-cart'],
  'molecular-email': ['molecular-email', 'reginald-cart'],
  'reginald-email':  ['reginald-email', 'reginald-cart'],
  'finnable':        ['finnable'],
  'billing':         ['billing'],
  'gs1':             ['gs1'],
  'gnc':             ['gnc'],
  'bella-vita':      ['bella-vita'],
  'clovia':          ['clovia'],
  'neemans':         ['neemans'],
  'viega':           ['viega'],
  'exicom':          ['exicom'],
  'du-digital':      ['du-digital'],
  'dalmia':          ['dalmia'],
};

/** The endpoint groups a viewer of these dashboards may read. */
export function groupsForDashboards(dashboards: Iterable<LiveDashboard>): Set<string> {
  const have = new Set(dashboards);
  const groups = new Set<string>();
  for (const [group, users] of Object.entries(LIVE_GROUP_USERS)) {
    if (users.some((d) => have.has(d))) groups.add(group);
  }
  return groups;
}
