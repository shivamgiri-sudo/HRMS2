import { useState, useEffect } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Search,
  XCircle, Eye, RefreshCw, Zap, Database
} from 'lucide-react';
import { formatISTDate, formatISTTime } from '@/lib/utils';

interface ProviderStatus {
  enabled: boolean;
  environment: string;
  baseUrl: string;
  providerKey: string;
  lastTokenSuccessAt: string | null;
  lastApiFailureAt: string | null;
  lastApiFailureMessage: string | null;
  services: Record<string, boolean>;
}

interface APILog {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  candidate_code?: string;
  check_id: string | null;
  provider_key: string;
  endpoint_key: string;
  request_ref: string | null;
  response_status_code: number;
  response_payload: any;
  duration_ms: number;
  success_flag: boolean;
  created_at: string;
}

interface CostRow {
  endpointKey: string;
  checkType: string;
  billableCalls: number;
  failedCalls: number;
  totalCalls: number;
  unitCost: number;
  totalCost: number;
  /** False when no rate is configured for this check type — shown rather than defaulted. */
  rateConfigured: boolean;
}

interface CostReport {
  days: number;
  rows: CostRow[];
  totalCost: number;
  totalCalls: number;
  unmappedEndpoints: string[];
}

interface ApiFailure {
  id: string;
  created_at: string;
  endpoint_key: string;
  provider_key: string;
  outcome: string;
  error_code: string | null;
  error_message: string | null;
  response_status_code: number | null;
  duration_ms: number | null;
  request_ref: string | null;
  attempt_no: number;
  candidate_id: string;
  candidate_name?: string | null;
  candidate_code?: string | null;
  mobile?: string | null;
}

interface FailureSummaryRow {
  outcome: string;
  error_code: string | null;
  n: number;
  last_seen: string;
}

interface Stats {
  totalCallsToday: number;
  totalCallsWeek: number;
  totalCallsMonth: number;
  successRate: number;
  avgDurationMs: number;
  mockCallsCount: number;
  realCallsCount: number;
  callsByEndpoint: Record<string, number>;
}

// Matches provider_key/endpoint_key values actually present in
// candidate_bgv_api_request_log — verified against live data rather than
// guessed from provider config naming.
const PROVIDER_OPTIONS = ['luckpay', 'befisc_luckpay', 'mock_bgv'];
const ENDPOINT_OPTIONS = [
  'DIGILOCKER_STATUS', 'DIGILOCKER_INITIATE', 'BANK_VERIFY', 'PAN_VERIFY',
  'UAN_VERIFY', 'EDUCATION_VERIFY', 'COURT_VERIFY',
];

export default function NativeBGVAPIMonitor() {
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [logs, setLogs] = useState<APILog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [costReport, setCostReport] = useState<CostReport | null>(null);
  const [failures, setFailures] = useState<ApiFailure[]>([]);
  const [failureSummary, setFailureSummary] = useState<FailureSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState<APILog | null>(null);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [reportDays, setReportDays] = useState(30);

  // Log-table filters — from/to/provider/endpoint/status are applied server-side
  // against candidate_bgv_api_request_log's indexed columns; `search` above stays
  // a client-side refinement on top of whatever the server returned.
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterProvider, setFilterProvider] = useState('');
  const [filterEndpoint, setFilterEndpoint] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'success' | 'failed'>('');

  const loadData = async (days = reportDays) => {
    setLoading(true);
    try {
      const logParams = new URLSearchParams();
      if (filterFrom) logParams.set('from', filterFrom);
      if (filterTo) logParams.set('to', filterTo);
      if (filterProvider) logParams.set('provider_key', filterProvider);
      if (filterEndpoint) logParams.set('endpoint_key', filterEndpoint);
      if (filterStatus) logParams.set('success_flag', filterStatus === 'success' ? '1' : '0');
      const logsQuery = logParams.toString();

      const [statusRes, logsRes, statsRes, costRes, failRes] = await Promise.all([
        hrmsApi.get<any>('/api/ats/bgv/provider-status').catch(() => ({ data: null })),
        hrmsApi.get<any>(`/api/ats/bgv/api-logs${logsQuery ? `?${logsQuery}` : ''}`).catch(() => ({ data: [] })),
        hrmsApi.get<any>('/api/ats/bgv/api-stats').catch(() => ({ data: null })),
        hrmsApi.get<any>(`/api/ats/bgv/api-cost-report?days=${days}`).catch(() => ({ data: null })),
        hrmsApi.get<any>(`/api/ats/bgv/api-failures?days=${days}`).catch(() => ({ data: null })),
      ]);
      setProviderStatus(statusRes.data || null);
      setLogs(logsRes.data || []);
      setStats(statsRes.data || null);
      setCostReport(costRes.data || null);
      setFailures(failRes.data?.failures || []);
      setFailureSummary(failRes.data?.summary || []);
    } catch (e: any) {
      console.error('[BGV Monitor] Failed to load data:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => void loadData(reportDays);
  const clearFilters = () => {
    setFilterFrom(''); setFilterTo(''); setFilterProvider(''); setFilterEndpoint(''); setFilterStatus('');
    void loadData(reportDays);
  };
  const hasActiveFilters = Boolean(filterFrom || filterTo || filterProvider || filterEndpoint || filterStatus);

  const calculateTotalCost = (): number => costReport?.totalCost ?? 0;

  const OUTCOME_STYLES: Record<string, string> = {
    provider_error: 'bg-red-100 text-red-700 border-red-200',
    network_error: 'bg-orange-100 text-orange-700 border-orange-200',
    config_error: 'bg-amber-100 text-amber-800 border-amber-200',
    mismatch: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    manual_review: 'bg-blue-100 text-blue-700 border-blue-200',
    success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  };

  useEffect(() => {
    void loadData();
  }, []);

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await hrmsApi.post<any>('/api/ats/bgv/test-connection');
      alert(res.message || 'Connection test completed. Check the logs below for details.');
      await loadData();
    } catch (e: any) {
      alert(e?.message || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const viewResponse = (log: APILog) => {
    setSelectedLog(log);
    setShowResponseModal(true);
  };

  const filteredLogs = logs.filter(log =>
    !search ||
    log.candidate_name?.toLowerCase().includes(search.toLowerCase()) ||
    log.candidate_code?.toLowerCase().includes(search.toLowerCase()) ||
    log.provider_key.toLowerCase().includes(search.toLowerCase()) ||
    log.endpoint_key.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  const isMockActive = providerStatus?.providerKey === 'mock' || stats?.mockCallsCount! > 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">BGV API Monitor</h1>
          <p className="text-sm text-slate-500 mt-1">Track background verification API calls and provider status</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500" htmlFor="bgv-report-days">Period:</label>
          <select
            id="bgv-report-days"
            value={reportDays}
            onChange={(e) => { const d = Number(e.target.value); setReportDays(d); void loadData(d); }}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button onClick={() => void loadData(reportDays)} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Mock Warning Banner */}
      {isMockActive && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-red-900">⚠️ WARNING: Mock BGV Provider Active</p>
                <p className="text-sm text-red-700 mt-1">
                  Real BGV API calls are NOT being made. All verifications are passing format checks only.
                  This is NOT suitable for production use or legal compliance.
                </p>
                <p className="text-xs text-red-600 mt-2">
                  <strong>Action required:</strong> Configure real BGV provider (Luckpay/InfinitiAI) in Super Admin → Settings → BGV Config.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Active BGV Provider
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {providerStatus ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Provider</p>
                  <Badge variant={providerStatus.providerKey === 'mock' ? 'destructive' : 'default'} className="text-sm">
                    {providerStatus.providerKey.toUpperCase()}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Environment</p>
                  <p className="text-sm font-semibold">{providerStatus.environment}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Status</p>
                  <Badge variant={providerStatus.enabled ? 'default' : 'secondary'}>
                    {providerStatus.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Base URL</p>
                  <p className="text-xs font-mono truncate">{providerStatus.baseUrl}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Last Token Success</p>
                  <p className="text-sm">
                    {providerStatus.lastTokenSuccessAt
                      ? `${formatISTDate(new Date(providerStatus.lastTokenSuccessAt))} ${formatISTTime(new Date(providerStatus.lastTokenSuccessAt))}`
                      : 'Never'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Last API Failure</p>
                  <p className="text-sm">
                    {providerStatus.lastApiFailureAt
                      ? `${formatISTDate(new Date(providerStatus.lastApiFailureAt))} ${formatISTTime(new Date(providerStatus.lastApiFailureAt))}`
                      : 'None'}
                  </p>
                </div>
              </div>

              {providerStatus.lastApiFailureMessage && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <p className="text-xs text-red-600 font-semibold mb-1">Last Error:</p>
                  <p className="text-xs text-red-700">{providerStatus.lastApiFailureMessage}</p>
                </div>
              )}

              <div>
                <p className="text-xs text-slate-500 mb-2">Available Services</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(providerStatus.services).map(([service, available]) => (
                    <Badge key={service} variant={available ? 'default' : 'secondary'} className="text-xs">
                      {available ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                      {service}
                    </Badge>
                  ))}
                </div>
              </div>

              <Button onClick={() => void testConnection()} disabled={testing} variant="outline" className="w-full">
                <Zap className="w-4 h-4 mr-2" />
                {testing ? 'Testing Connection...' : 'Test BGV API Connection'}
              </Button>
            </>
          ) : (
            <p className="text-sm text-slate-500">Provider status unavailable</p>
          )}
        </CardContent>
      </Card>

      {/* Stats Cards */}
      {stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">Calls Today</p>
                    <p className="text-2xl font-bold text-slate-900">{stats.totalCallsToday}</p>
                  </div>
                  <Activity className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Success Rate</p>
                  <p className={`text-2xl font-bold ${stats.successRate >= 90 ? 'text-emerald-600' : stats.successRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                    {stats.successRate.toFixed(1)}%
                  </p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Avg Response</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.avgDurationMs}ms</p>
                </div>
                <Clock className="w-8 h-8 text-slate-500" />
              </div>
            </CardContent>
          </Card>

          <Card className={stats.mockCallsCount > 0 ? 'border-red-300' : ''}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Mock Calls</p>
                  <p className={`text-2xl font-bold ${stats.mockCallsCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {stats.mockCallsCount}
                  </p>
                </div>
                <AlertTriangle className={`w-8 h-8 ${stats.mockCallsCount > 0 ? 'text-red-500' : 'text-slate-300'}`} />
              </div>
            </CardContent>
          </Card>
          </div>

          {/* Cost & Billing Card */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5" />
                API Usage & Estimated Cost
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-50 p-4 rounded-md">
                  <p className="text-xs text-slate-500 mb-1">This Week</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.totalCallsWeek}</p>
                  <p className="text-xs text-slate-500 mt-1">API calls</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-md">
                  <p className="text-xs text-slate-500 mb-1">This Month</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.totalCallsMonth}</p>
                  <p className="text-xs text-slate-500 mt-1">API calls</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-md border border-blue-200">
                  <p className="text-xs text-blue-600 mb-1">Billed Cost ({costReport?.days ?? 30}d)</p>
                  <p className="text-2xl font-bold text-blue-900">₹{calculateTotalCost().toFixed(2)}</p>
                  <p className="text-xs text-blue-600 mt-1">
                    {costReport ? `${costReport.totalCalls} calls, computed from the request log` : 'Cost report unavailable'}
                  </p>
                </div>
              </div>

              {/* Breakdown by endpoint — figures come from the server so the
                  billed/failed split and unit rate are authoritative. */}
              <div>
                <p className="text-sm font-semibold mb-3">
                  API Calls by Endpoint (last {costReport?.days ?? 30} days)
                </p>
                {!costReport?.rows?.length ? (
                  <p className="text-sm text-slate-500">No provider calls recorded in this period.</p>
                ) : (
                  <div className="space-y-2">
                    {costReport.rows.map((row) => {
                      const peak = Math.max(...costReport.rows.map((r) => r.totalCalls), 1);
                      return (
                        <div key={row.endpointKey} className="flex items-center justify-between text-sm">
                          <span className="text-slate-700 flex items-center gap-2">
                            {row.endpointKey.replace(/_/g, ' ')}
                            {!row.rateConfigured && (
                              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                                no rate set
                              </Badge>
                            )}
                            {row.failedCalls > 0 && (
                              <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">
                                {row.failedCalls} failed
                              </Badge>
                            )}
                          </span>
                          <div className="flex items-center gap-3">
                            <div className="bg-slate-200 h-2 w-24 rounded-full overflow-hidden">
                              <div className="bg-blue-500 h-full" style={{ width: `${(row.totalCalls / peak) * 100}%` }} />
                            </div>
                            <span className="text-slate-600 w-12 text-right">{row.billableCalls}</span>
                            <span className="text-xs text-slate-400 w-10">× ₹{row.unitCost}</span>
                            <span className="font-semibold text-slate-900 w-16 text-right">₹{row.totalCost.toFixed(0)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {costReport?.unmappedEndpoints?.length ? (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs">
                  <p className="font-semibold text-amber-800 mb-1">Endpoints with no configured rate</p>
                  <p className="text-amber-700">
                    {costReport.unmappedEndpoints.join(', ')} — counted but billed at ₹0.
                    Add a rate in Super Admin → Settings → BGV API Costs.
                  </p>
                </div>
              ) : null}

              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs text-slate-600">
                Only calls that reached the provider are billed. Requests that failed before
                reaching it (network or configuration errors) are counted but cost ₹0.
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Failed provider calls — who, when, which endpoint, and why. */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Failed API Calls (last {reportDays} days)
            </CardTitle>
            {failures.length > 0 && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                {failures.length} failure{failures.length === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {failureSummary.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {failureSummary.map((row) => (
                <div
                  key={`${row.outcome}-${row.error_code ?? 'none'}`}
                  className={`px-3 py-1.5 rounded-md border text-xs ${OUTCOME_STYLES[row.outcome] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}
                >
                  <span className="font-semibold">{row.error_code || row.outcome}</span>
                  <span className="ml-2 opacity-75">× {row.n}</span>
                </div>
              ))}
            </div>
          )}

          {failures.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3">
              <CheckCircle2 className="w-4 h-4" />
              No provider call failures recorded in the last {reportDays} days.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Candidate</th>
                    <th className="py-2 pr-3 font-medium">Endpoint</th>
                    <th className="py-2 pr-3 font-medium">Outcome</th>
                    <th className="py-2 pr-3 font-medium">Code</th>
                    <th className="py-2 pr-3 font-medium">Reason</th>
                    <th className="py-2 pr-3 font-medium text-right">HTTP</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map((f) => (
                    <tr key={f.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                        {formatISTDate(f.created_at)}<br />
                        <span className="text-xs text-slate-400">{formatISTTime(f.created_at)}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="text-slate-900">{f.candidate_name || '—'}</span>
                        {f.candidate_code && (
                          <span className="block text-xs text-slate-400">{f.candidate_code}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-700">
                        {f.endpoint_key.replace(/_/g, ' ')}
                        <span className="block text-xs text-slate-400">{f.provider_key}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${OUTCOME_STYLES[f.outcome] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}
                        >
                          {f.outcome.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs font-mono text-slate-600">{f.error_code || '—'}</td>
                      <td className="py-2 pr-3 text-slate-700 max-w-md">{f.error_message || '—'}</td>
                      <td className="py-2 pr-3 text-right text-slate-500">{f.response_status_code ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Logs Table */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <CardTitle>API Call Logs</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search candidate, provider, endpoint..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-slate-100">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-500" htmlFor="bgv-log-from">From</label>
              <input
                id="bgv-log-from"
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-500" htmlFor="bgv-log-to">To</label>
              <input
                id="bgv-log-to"
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-500" htmlFor="bgv-log-provider">Provider</label>
              <select
                id="bgv-log-provider"
                value={filterProvider}
                onChange={(e) => setFilterProvider(e.target.value)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
              >
                <option value="">All providers</option>
                {PROVIDER_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-500" htmlFor="bgv-log-endpoint">Check type</label>
              <select
                id="bgv-log-endpoint"
                value={filterEndpoint}
                onChange={(e) => setFilterEndpoint(e.target.value)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
              >
                <option value="">All check types</option>
                {ENDPOINT_OPTIONS.map((ep) => <option key={ep} value={ep}>{ep}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-500" htmlFor="bgv-log-status">Status</label>
              <select
                id="bgv-log-status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as '' | 'success' | 'failed')}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
              >
                <option value="">All statuses</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <Button onClick={applyFilters} size="sm" className="h-8">Apply</Button>
            {hasActiveFilters && (
              <Button onClick={clearFilters} variant="ghost" size="sm" className="h-8 text-slate-500">
                Clear filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2">Timestamp</th>
                  <th className="text-left py-3 px-2">Candidate</th>
                  <th className="text-left py-3 px-2">Check Type</th>
                  <th className="text-left py-3 px-2">Provider</th>
                  <th className="text-left py-3 px-2">Status</th>
                  <th className="text-right py-3 px-2">Duration</th>
                  <th className="text-center py-3 px-2">Response</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No API logs found
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="border-b hover:bg-slate-50">
                      <td className="py-3 px-2 text-xs">
                        <div>{formatISTDate(new Date(log.created_at))}</div>
                        <div className="text-slate-500">{formatISTTime(new Date(log.created_at))}</div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-medium">{log.candidate_name || '-'}</div>
                        <div className="text-xs text-slate-500">{log.candidate_code || '-'}</div>
                      </td>
                      <td className="py-3 px-2">
                        <Badge variant="outline" className="text-xs">
                          {log.endpoint_key}
                        </Badge>
                      </td>
                      <td className="py-3 px-2">
                        <Badge variant={log.provider_key === 'mock' ? 'destructive' : 'default'} className="text-xs">
                          {log.provider_key}
                        </Badge>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          {log.success_flag ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600" />
                          )}
                          <span className={`text-xs ${log.success_flag ? 'text-emerald-600' : 'text-red-600'}`}>
                            {log.response_status_code}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <span className={`text-xs ${log.duration_ms > 5000 ? 'text-red-600' : log.duration_ms > 2000 ? 'text-amber-600' : 'text-slate-600'}`}>
                          {log.duration_ms}ms
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <Button variant="ghost" size="sm" onClick={() => viewResponse(log)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Response Modal */}
      {showResponseModal && selectedLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setShowResponseModal(false)}>
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-bold">API Response Details</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowResponseModal(false)}>×</Button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-100px)]">
              <div className="space-y-3 mb-4 text-sm">
                <div><span className="font-semibold">Endpoint:</span> {selectedLog.endpoint_key}</div>
                <div><span className="font-semibold">Provider:</span> {selectedLog.provider_key}</div>
                <div><span className="font-semibold">Reference ID:</span> {selectedLog.request_ref || '-'}</div>
                <div><span className="font-semibold">Status Code:</span> {selectedLog.response_status_code}</div>
                <div><span className="font-semibold">Duration:</span> {selectedLog.duration_ms}ms</div>
              </div>
              <div>
                <p className="font-semibold text-sm mb-2">Response Payload:</p>
                <pre className="bg-slate-900 text-slate-100 p-4 rounded-md text-xs overflow-x-auto">
                  {JSON.stringify(selectedLog.response_payload, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
