import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, RefreshCw, Shield, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { hrmsApi } from '@/lib/hrmsApi';

interface ProviderConfig {
  id: string;
  providerKey: string;
  providerName: string;
  activeStatus: 'active' | 'inactive';
  isDefault: boolean;
  modelName?: string;
  baseUrl?: string;
  timeout?: number;
  dailyRequestLimit?: number;
  monthlyRequestLimit?: number;
  capabilities?: { supportsChat: boolean; supportsJson: boolean; supportsStreaming: boolean; supportsEmbeddings: boolean };
}

interface UsageLog {
  id: number;
  provider_key: string;
  model_name?: string;
  latency_ms?: number;
  input_token_count?: number;
  output_token_count?: number;
  success: boolean;
  fallback_used: boolean;
  safety_blocked: boolean;
  created_at: string;
}

interface AnalyticsSummary {
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  fallbackCount: number;
  safetyBlockedCount: number;
}

interface AnalyticsCounts {
  today: number;
  month: number;
  todayTokens: { inputTokens: number; outputTokens: number };
  monthTokens: { inputTokens: number; outputTokens: number };
}

interface PromptAuditRow {
  id: number;
  user_id: string;
  provider_key: string;
  model_name?: string;
  request_source?: string;
  detected_intent?: string;
  response_summary?: string;
  created_at: string;
}

interface ProviderForm {
  activeStatus: 'active' | 'inactive';
  isDefault: boolean;
  modelName: string;
  apiKey: string;
  baseUrl: string;
  timeout: number;
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
}

const OPENROUTER_DEFAULTS: ProviderForm = {
  activeStatus: 'inactive', isDefault: false, modelName: 'openrouter/auto', apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1', timeout: 30000, dailyRequestLimit: 1000, monthlyRequestLimit: 30000,
};
const GEMINI_DEFAULTS: ProviderForm = {
  activeStatus: 'inactive', isDefault: false, modelName: 'gemini-1.5-flash', apiKey: '',
  baseUrl: 'https://generativelanguage.googleapis.com', timeout: 30000, dailyRequestLimit: 1000, monthlyRequestLimit: 30000,
};

export default function AIProviderSettings() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [openRouter, setOpenRouter] = useState<ProviderForm>(OPENROUTER_DEFAULTS);
  const [gemini, setGemini] = useState<ProviderForm>(GEMINI_DEFAULTS);
  const [knowledge, setKnowledge] = useState<{ source: string; facts: number; lastRefreshedAt: string | null } | null>(null);
  const [refreshingKnowledge, setRefreshingKnowledge] = useState(false);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null);
  const [analyticsCounts, setAnalyticsCounts] = useState<AnalyticsCounts | null>(null);
  const [promptAuditLogs, setPromptAuditLogs] = useState<PromptAuditRow[]>([]);

  const hydrate = (provider: ProviderConfig | undefined, defaults: ProviderForm): ProviderForm => provider ? {
    ...defaults,
    activeStatus: provider.activeStatus,
    isDefault: provider.isDefault,
    modelName: provider.modelName || defaults.modelName,
    baseUrl: provider.baseUrl || defaults.baseUrl,
    timeout: provider.timeout || defaults.timeout,
    dailyRequestLimit: provider.dailyRequestLimit || defaults.dailyRequestLimit,
    monthlyRequestLimit: provider.monthlyRequestLimit || defaults.monthlyRequestLimit,
  } : defaults;

  const load = async () => {
    try {
      const [providerRes, usageRes, knowledgeRes, summaryRes, countsRes, promptAuditRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: ProviderConfig[] }>('/api/ai/providers'),
        hrmsApi.get<{ success: boolean; data: { logs: UsageLog[] } }>('/api/ai/providers/usage?limit=50'),
        hrmsApi.get<{ success: boolean; data: { source: string; facts: number; lastRefreshedAt: string | null } }>('/api/ai/company-knowledge/status'),
        hrmsApi.get<{ success: boolean; data: AnalyticsSummary }>('/api/ai/analytics/summary'),
        hrmsApi.get<{ success: boolean; data: AnalyticsCounts }>('/api/ai/analytics/counts'),
        hrmsApi.get<{ success: boolean; data: { logs: PromptAuditRow[] } }>('/api/ai/analytics/prompt-audit?limit=50'),
      ]);
      const list = providerRes.data || [];
      setProviders(list);
      setOpenRouter((current) => ({ ...hydrate(list.find((item) => item.providerKey === 'openrouter'), OPENROUTER_DEFAULTS), apiKey: current.apiKey }));
      setGemini((current) => ({ ...hydrate(list.find((item) => item.providerKey === 'gemini'), GEMINI_DEFAULTS), apiKey: current.apiKey }));
      setUsageLogs(usageRes.data?.logs || []);
      setKnowledge(knowledgeRes.data || null);
      setAnalyticsSummary(summaryRes.data || null);
      setAnalyticsCounts(countsRes.data || null);
      setPromptAuditLogs(promptAuditRes.data?.logs || []);
    } catch (error) {
      toast({ title: 'Unable to load Mira settings', description: error instanceof Error ? error.message : 'Request failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saveProvider = async (providerKey: 'openrouter' | 'gemini', form: ProviderForm) => {
    setSaving(providerKey);
    try {
      const existing = providers.find((item) => item.providerKey === providerKey);
      const payload = {
        providerName: providerKey === 'openrouter' ? 'OpenRouter' : 'Google Gemini AI',
        activeStatus: form.activeStatus,
        isDefault: form.isDefault,
        modelName: form.modelName.trim(),
        baseUrl: form.baseUrl,
        apiKey: form.apiKey.trim() || undefined,
        timeout: form.timeout,
        dailyRequestLimit: form.dailyRequestLimit,
        monthlyRequestLimit: form.monthlyRequestLimit,
      };
      if (existing) await hrmsApi.put(`/api/ai/providers/${existing.id}`, payload);
      else await hrmsApi.post('/api/ai/providers', { providerKey, ...payload });
      toast({ title: 'Configuration saved', description: `${payload.providerName} is ready for testing.` });
      if (providerKey === 'openrouter') setOpenRouter((current) => ({ ...current, apiKey: '' }));
      else setGemini((current) => ({ ...current, apiKey: '' }));
      await load();
    } catch (error) {
      toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Request failed', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const testProvider = async (provider: ProviderConfig) => {
    setTesting(provider.id);
    try {
      const response = await hrmsApi.post<{ success: boolean; data: { success: boolean; latencyMs: number; error?: string } }>(`/api/ai/providers/${provider.id}/test`, {});
      if (!response.data.success) throw new Error(response.data.error || 'Provider test failed');
      toast({ title: 'Connection successful', description: `${provider.providerName} responded in ${response.data.latencyMs} ms.` });
    } catch (error) {
      toast({ title: 'Connection failed', description: error instanceof Error ? error.message : 'Request failed', variant: 'destructive' });
    } finally {
      setTesting(null);
    }
  };

  const setDefault = async (provider: ProviderConfig) => {
    await hrmsApi.post(`/api/ai/providers/${provider.id}/set-default`, {});
    toast({ title: 'Default provider updated', description: `${provider.providerName} will answer grounded public company questions.` });
    await load();
  };

  const refreshKnowledge = async () => {
    setRefreshingKnowledge(true);
    try {
      const response = await hrmsApi.post<{ success: boolean; data: { refreshed: number } }>('/api/ai/company-knowledge/refresh', {});
      toast({ title: 'Company knowledge refreshed', description: `${response.data.refreshed} official MAS Callnet pages were updated.` });
      await load();
    } catch (error) {
      toast({ title: 'Refresh failed', description: error instanceof Error ? error.message : 'Request failed', variant: 'destructive' });
    } finally {
      setRefreshingKnowledge(false);
    }
  };

  const providerForm = (key: 'openrouter' | 'gemini', form: ProviderForm, setForm: (next: ProviderForm) => void) => {
    const isOpenRouter = key === 'openrouter';
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isOpenRouter ? 'OpenRouter Configuration' : 'Google Gemini Configuration'}</CardTitle>
          <CardDescription>
            {isOpenRouter
              ? 'Use one encrypted OpenRouter key and switch models by changing the model slug. Personal employee data remains on the local secure path.'
              : 'Optional direct Gemini provider for grounded public-company responses.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><Label>Enable provider</Label><p className="text-sm text-muted-foreground">Allow Mira to use this provider for approved external requests.</p></div>
            <Switch checked={form.activeStatus === 'active'} onCheckedChange={(checked) => setForm({ ...form, activeStatus: checked ? 'active' : 'inactive' })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><Label>Set as default</Label><p className="text-sm text-muted-foreground">Self-account answers still remain local and database-backed.</p></div>
            <Switch checked={form.isDefault} onCheckedChange={(checked) => setForm({ ...form, isDefault: checked })} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Model ID</Label>
              <Input value={form.modelName} onChange={(event) => setForm({ ...form, modelName: event.target.value })} placeholder={isOpenRouter ? 'openrouter/auto or provider/model' : 'gemini-1.5-flash'} />
              <p className="text-xs text-muted-foreground">{isOpenRouter ? 'Examples: openrouter/auto, openai/gpt-chat-latest, google/gemini-2.5-flash.' : 'Use a model enabled for your Gemini API key.'}</p>
            </div>
            <div className="space-y-2">
              <Label>API base URL</Label>
              <Input value={form.baseUrl} readOnly={isOpenRouter} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>API key</Label>
            <div className="flex gap-2">
              <Input type={showKey[key] ? 'text' : 'password'} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="Leave blank to keep the existing encrypted key" autoComplete="new-password" />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((current) => ({ ...current, [key]: !current[key] }))}>
                {showKey[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">The key is encrypted by the backend and is never returned to the browser.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2"><Label>Timeout (ms)</Label><Input type="number" value={form.timeout} onChange={(event) => setForm({ ...form, timeout: Number(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Daily requests</Label><Input type="number" value={form.dailyRequestLimit} onChange={(event) => setForm({ ...form, dailyRequestLimit: Number(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Monthly requests</Label><Input type="number" value={form.monthlyRequestLimit} onChange={(event) => setForm({ ...form, monthlyRequestLimit: Number(event.target.value) })} /></div>
          </div>
          <Button className="w-full" disabled={saving === key || !form.modelName.trim()} onClick={() => void saveProvider(key, form)}>
            {saving === key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save {isOpenRouter ? 'OpenRouter' : 'Gemini'} Configuration
          </Button>
        </CardContent>
      </Card>
    );
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="container mx-auto max-w-7xl p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Mira AI Configuration</h1>
        <p className="text-muted-foreground">Manage grounded company knowledge, encrypted provider keys, model routing and privacy controls.</p>
      </div>
      <Tabs defaultValue="providers" className="space-y-6">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="openrouter">OpenRouter</TabsTrigger>
          <TabsTrigger value="gemini">Gemini</TabsTrigger>
          <TabsTrigger value="knowledge">Company Knowledge</TabsTrigger>
          <TabsTrigger value="safety">Safety</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="space-y-4">
          <Alert><Shield className="h-4 w-4" /><AlertDescription>Salary, attendance, leave, roster, documents and other self-account answers are read directly from HRMS and are not sent to OpenRouter or Gemini.</AlertDescription></Alert>
          {providers.map((provider) => (
            <Card key={provider.id}>
              <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    {provider.providerName}
                    {provider.isDefault && <Badge>Default</Badge>}
                    <Badge variant={provider.activeStatus === 'active' ? 'default' : 'secondary'}>{provider.activeStatus}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{provider.providerKey} · {provider.modelName || 'No model configured'}</p>
                </div>
                <div className="flex gap-2">
                  {provider.providerKey !== 'rule-based' && <Button variant="outline" onClick={() => void testProvider(provider)} disabled={testing === provider.id}>{testing === provider.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}</Button>}
                  {provider.activeStatus === 'active' && !provider.isDefault && <Button onClick={() => void setDefault(provider)}>Set Default</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="openrouter">{providerForm('openrouter', openRouter, setOpenRouter)}</TabsContent>
        <TabsContent value="gemini">{providerForm('gemini', gemini, setGemini)}</TabsContent>

        <TabsContent value="knowledge">
          <Card>
            <CardHeader><CardTitle>Approved MAS Callnet Knowledge</CardTitle><CardDescription>Mira uses curated facts and allowlisted pages from the official company website. Branch-head assignments are read live from HRMS.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Source</p><p className="font-medium">{knowledge?.source || 'https://mascallnet.ai'}</p></div>
                <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Active knowledge records</p><p className="text-2xl font-semibold">{knowledge?.facts ?? 0}</p></div>
                <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Last website refresh</p><p className="font-medium">{knowledge?.lastRefreshedAt ? new Date(knowledge.lastRefreshedAt).toLocaleString() : 'Seeded facts in use'}</p></div>
              </div>
              <Button onClick={() => void refreshKnowledge()} disabled={refreshingKnowledge}>{refreshingKnowledge ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh Official Website Knowledge</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="safety">
          <Card><CardHeader><CardTitle>Always-on Privacy Controls</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
            {[
              ['Self-only HR data', 'Employee identity is resolved from the authenticated login.'],
              ['No personal data to external AI', 'Self salary, attendance, leave, documents and roster remain local.'],
              ['Official-source grounding', 'Company answers use approved MAS Callnet sources and live role assignments.'],
              ['No model disclaimers', 'Mira does not mention training cutoffs, memory dates or generic AI limitations.'],
              ['Encrypted API keys', 'Provider secrets are encrypted in the database.'],
              ['Audit logging', 'Provider, model, latency and safety metadata are recorded.'],
            ].map(([title, description]) => <div key={title} className="flex gap-3 rounded-lg border p-4"><Shield className="mt-0.5 h-5 w-5 text-emerald-600" /><div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{description}</p></div></div>)}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="usage">
          <Card><CardHeader><CardTitle>Recent Provider Usage</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Provider</TableHead><TableHead>Model</TableHead><TableHead>Latency</TableHead><TableHead>Tokens</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
            {usageLogs.map((log) => <TableRow key={log.id}><TableCell>{new Date(log.created_at).toLocaleString()}</TableCell><TableCell>{log.provider_key}</TableCell><TableCell>{log.model_name || '—'}</TableCell><TableCell>{log.latency_ms ? `${log.latency_ms} ms` : '—'}</TableCell><TableCell>{log.input_token_count || 0} / {log.output_token_count || 0}</TableCell><TableCell><Badge variant={log.success ? 'default' : 'destructive'}>{log.success ? <Check className="mr-1 h-3 w-3" /> : <X className="mr-1 h-3 w-3" />}{log.success ? 'Success' : 'Failed'}</Badge>{log.fallback_used && <Badge variant="secondary" className="ml-1">Fallback</Badge>}</TableCell></TableRow>)}
          </TableBody></Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Requests (30d, all providers)</p><p className="text-2xl font-semibold">{analyticsSummary?.totalRequests ?? '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Success rate</p><p className="text-2xl font-semibold">{analyticsSummary ? `${analyticsSummary.successRate.toFixed(1)}%` : '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Avg latency</p><p className="text-2xl font-semibold">{analyticsSummary ? `${Math.round(analyticsSummary.avgLatencyMs)} ms` : '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Fallback count</p><p className="text-2xl font-semibold">{analyticsSummary?.fallbackCount ?? '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Safety-blocked count</p><p className="text-2xl font-semibold">{analyticsSummary?.safetyBlockedCount ?? '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Requests today / this month</p><p className="text-2xl font-semibold">{analyticsCounts ? `${analyticsCounts.today} / ${analyticsCounts.month}` : '—'}</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Token usage</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="font-medium">{analyticsCounts ? `${analyticsCounts.todayTokens.inputTokens} in / ${analyticsCounts.todayTokens.outputTokens} out` : '—'}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">This month</p>
                <p className="font-medium">{analyticsCounts ? `${analyticsCounts.monthTokens.inputTokens} in / ${analyticsCounts.monthTokens.outputTokens} out` : '—'}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top intents</CardTitle>
              <CardDescription>
                Available for requests made after this date — detected_intent was only added going forward
                (migration 1077); historical rows have no intent to report and are not backfilled, since
                question_hash/sanitized_context_hash are one-way hashes with nothing to derive it from.
              </CardDescription>
            </CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Not enough post-migration data yet to show a breakdown.</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent Prompt Audit</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>User</TableHead><TableHead>Provider</TableHead><TableHead>Source</TableHead><TableHead>Detected intent</TableHead></TableRow></TableHeader>
                <TableBody>
                  {promptAuditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                      <TableCell>{log.user_id}</TableCell>
                      <TableCell>{log.provider_key}</TableCell>
                      <TableCell>{log.request_source || '—'}</TableCell>
                      <TableCell>{log.detected_intent || <span className="text-muted-foreground">unavailable (pre-migration)</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
