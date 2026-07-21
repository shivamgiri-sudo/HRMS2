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

export default function NativeBGVAPIMonitor() {
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [logs, setLogs] = useState<APILog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [apiCosts, setApiCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState<APILog | null>(null);
  const [showResponseModal, setShowResponseModal] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statusRes, logsRes, statsRes, costsRes] = await Promise.all([
        hrmsApi.get<any>('/api/ats/bgv/provider-status'),
        hrmsApi.get<any>('/api/ats/bgv/api-logs'),
        hrmsApi.get<any>('/api/ats/bgv/api-stats'),
        hrmsApi.get<any>('/api/ats/bgv/api-costs').catch(() => ({ data: {} })),
      ]);
      setProviderStatus(statusRes.data || null);
      setLogs(logsRes.data || []);
      setStats(statsRes.data || null);
      setApiCosts(costsRes.data || {});
    } catch (e: any) {
      alert(e?.message || 'Failed to load API monitor data');
    } finally {
      setLoading(false);
    }
  };

  const normalizeEndpointToCheckType = (endpoint: string): string => {
    return endpoint.toLowerCase()
      .replace(/_check$/, '')
      .replace(/^verify_/, '')
      .replace(/_verify$/, '')
      .replace(/_offline$/, '');
  };

  const getCostForEndpoint = (endpoint: string): number => {
    const checkType = normalizeEndpointToCheckType(endpoint);
    return apiCosts[checkType] ?? 2; // fallback to ₹2 if not configured
  };

  const calculateTotalCost = (): number => {
    if (!stats?.callsByEndpoint) return 0;
    let total = 0;
    for (const [endpoint, count] of Object.entries(stats.callsByEndpoint)) {
      total += count * getCostForEndpoint(endpoint);
    }
    return total;
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
        <Button onClick={() => void loadData()} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
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
                  <p className="text-xs text-blue-600 mb-1">Estimated Cost (Month)</p>
                  <p className="text-2xl font-bold text-blue-900">₹{calculateTotalCost().toFixed(2)}</p>
                  <p className="text-xs text-blue-600 mt-1">Per-check pricing configured</p>
                </div>
              </div>

              {/* Breakdown by Check Type */}
              <div>
                <p className="text-sm font-semibold mb-3">API Calls by Check Type (This Month)</p>
                <div className="space-y-2">
                  {Object.entries(stats.callsByEndpoint).map(([endpoint, count]) => {
                    const cost = getCostForEndpoint(endpoint);
                    const totalCost = count * cost;
                    return (
                      <div key={endpoint} className="flex items-center justify-between text-sm">
                        <span className="text-slate-700">{endpoint.replace(/_/g, ' ')}</span>
                        <div className="flex items-center gap-3">
                          <div className="bg-slate-200 h-2 w-24 rounded-full overflow-hidden">
                            <div
                              className="bg-blue-500 h-full"
                              style={{ width: `${(count / Math.max(...Object.values(stats.callsByEndpoint))) * 100}%` }}
                            />
                          </div>
                          <span className="text-slate-600 w-12 text-right">{count}</span>
                          <span className="text-xs text-slate-400 w-8">× ₹{cost}</span>
                          <span className="font-semibold text-slate-900 w-16 text-right">₹{totalCost.toFixed(0)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs">
                <p className="font-semibold text-amber-800 mb-1">💡 Cost Optimization Tip</p>
                <p className="text-amber-700">
                  Each BGV check type has its own cost configured in Super Admin → Settings → BGV API Costs.
                  Complete candidate profile requires 5-8 API calls (~₹{Math.round(calculateTotalCost() / Math.max(stats.totalCallsMonth / 6, 1))} per candidate avg).
                  Bulk verification of ~{Math.floor(stats.totalCallsMonth / 6)} candidates this month.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* API Logs Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>API Call Logs</CardTitle>
            <div className="flex items-center gap-2">
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
