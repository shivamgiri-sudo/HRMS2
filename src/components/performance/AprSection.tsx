import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hrmsApi } from '@/lib/hrmsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw, Download } from 'lucide-react';

// format seconds as "Xh Ym"
function fmtTime(secs: number): string {
  if (!secs) return '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AprResponse {
  configured: boolean;
  rows: any[];
  reason?: string;
}

export function AprSection({ isManager }: { isManager: boolean }) {
  const [date, setDate] = useState(today());
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['apr-data', date, refreshKey],
    queryFn: async () => {
      // hrmsApi.get returns the parsed JSON directly (not axios-style { data: ... })
      const apr = await hrmsApi.get<AprResponse>(`/api/apr/data?date=${date}`);
      return apr;
    },
  });

  const apr = data as AprResponse | undefined;

  // Not configured state
  if (!isLoading && apr && apr.configured === false) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          APR integration is not configured. Contact your administrator to set it up in Integration Hub.
        </CardContent>
      </Card>
    );
  }

  const rows: any[] = apr?.rows ?? [];

  // CSV export
  const exportCsv = () => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => r[h] ?? '').join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `apr-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Manager view — sortable table
  if (isManager) {
    const filtered = rows.filter(r =>
      !search || (r.agent_user ?? '').toLowerCase().includes(search.toLowerCase())
    );
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Team APR — {date}</CardTitle>
            <div className="flex items-center gap-2">
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-36" />
              <Input placeholder="Search analyst…" value={search} onChange={e => setSearch(e.target.value)} className="w-40" />
              <Button variant="outline" size="sm" onClick={() => setRefreshKey(k => k + 1)}>
                <RefreshCw className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
                <Download className="mr-1 h-3 w-3" /> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="py-8 text-center text-destructive">Failed to load APR data.</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No data for {date}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Agent</th>
                    <th className="pb-2 pr-4 font-medium">Calls</th>
                    <th className="pb-2 pr-4 font-medium">AHT</th>
                    <th className="pb-2 pr-4 font-medium">Talk Time</th>
                    <th className="pb-2 pr-4 font-medium">Break Time</th>
                    <th className="pb-2 pr-4 font-medium">Login Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-4 font-medium">{r.agent_user ?? '—'}</td>
                      <td className="py-2 pr-4">{r.calls ?? 0}</td>
                      <td className="py-2 pr-4">{r.aht_seconds ? `${r.aht_seconds}s` : '—'}</td>
                      <td className="py-2 pr-4">{fmtTime(r.talk_time ?? 0)}</td>
                      <td className="py-2 pr-4">{fmtTime(r.pause_time ?? 0)}</td>
                      <td className="py-2 pr-4">{fmtTime(r.login_time_seconds ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Analyst view — sub-tabs: Today KPI cards + History
  const myRow = rows[0]; // analyst only sees their own row

  return (
    <Tabs defaultValue="today">
      <TabsList>
        <TabsTrigger value="today">My Stats Today</TabsTrigger>
        <TabsTrigger value="history">My History</TabsTrigger>
      </TabsList>

      <TabsContent value="today">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">Live data for {date}</p>
          <Button variant="outline" size="sm" onClick={() => setRefreshKey(k => k + 1)}>
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>
        {isLoading ? (
          <p className="py-8 text-center text-muted-foreground">Loading…</p>
        ) : apr?.reason === 'no_employee_code' ? (
          <p className="py-8 text-center text-muted-foreground">Your account is not linked to an agent code. Contact HR.</p>
        ) : !myRow ? (
          <p className="py-8 text-center text-muted-foreground">No data yet for today.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'AHT', value: myRow.aht_seconds ? `${myRow.aht_seconds}s` : '—' },
              { label: 'Talk Time', value: fmtTime(myRow.talk_time ?? 0) },
              { label: 'Break Time', value: fmtTime(myRow.pause_time ?? 0) },
              { label: 'Login Time', value: fmtTime(myRow.login_time_seconds ?? 0) },
              { label: 'Calls', value: myRow.calls ?? 0 },
            ].map(kpi => (
              <Card key={kpi.label}>
                <CardContent className="pt-6">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
                  <p className="mt-2 text-3xl font-black">{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="history">
        <div className="flex items-center gap-3 mb-4">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-36" />
          <Button variant="outline" size="sm" onClick={() => setRefreshKey(k => k + 1)}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        {isLoading ? (
          <p className="py-8 text-center text-muted-foreground">Loading…</p>
        ) : !myRow ? (
          <p className="py-8 text-center text-muted-foreground">No data for {date}.</p>
        ) : (
          <Card>
            <CardContent className="pt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 font-medium">Calls</th>
                    <th className="pb-2 pr-4 font-medium">AHT</th>
                    <th className="pb-2 pr-4 font-medium">Talk</th>
                    <th className="pb-2 pr-4 font-medium">Break</th>
                    <th className="pb-2 pr-4 font-medium">Login</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="hover:bg-muted/30">
                    <td className="py-2 pr-4">{date}</td>
                    <td className="py-2 pr-4">{myRow.calls ?? 0}</td>
                    <td className="py-2 pr-4">{myRow.aht_seconds ? `${myRow.aht_seconds}s` : '—'}</td>
                    <td className="py-2 pr-4">{fmtTime(myRow.talk_time ?? 0)}</td>
                    <td className="py-2 pr-4">{fmtTime(myRow.pause_time ?? 0)}</td>
                    <td className="py-2 pr-4">{fmtTime(myRow.login_time_seconds ?? 0)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}
