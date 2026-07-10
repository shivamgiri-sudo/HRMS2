import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Check, X, Shield, Activity, AlertTriangle, Eye, EyeOff } from 'lucide-react';
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
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
  capabilities?: {
    supportsChat: boolean;
    supportsJson: boolean;
    supportsStreaming: boolean;
    supportsEmbeddings: boolean;
  };
}

interface UsageLog {
  id: number;
  provider_key: string;
  model_name?: string;
  user_id: string;
  request_source?: string;
  latency_ms?: number;
  input_token_count?: number;
  output_token_count?: number;
  success: boolean;
  fallback_used: boolean;
  safety_blocked: boolean;
  created_at: string;
}

export default function AIProviderSettings() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Gemini config form state
  const [geminiConfig, setGeminiConfig] = useState({
    isDefault: false,
    activeStatus: 'inactive' as 'active' | 'inactive',
    modelName: 'gemini-flash',
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    temperature: 0.3,
    maxOutputTokens: 1024,
    timeout: 30000,
    dailyRequestLimit: 1000,
    monthlyRequestLimit: 30000,
    dailyTokenLimit: 100000,
    monthlyTokenLimit: 3000000,
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);

  useEffect(() => {
    loadProviders();
    loadUsageLogs();
  }, []);

  const loadProviders = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ProviderConfig[] }>('/api/ai/providers');
      if (res.success) {
        setProviders(res.data);
        const gemini = res.data.find((p: ProviderConfig) => p.providerKey === 'gemini');
        if (gemini) {
          setGeminiConfig((prev) => ({
            ...prev,
            isDefault: gemini.isDefault,
            activeStatus: gemini.activeStatus,
            modelName: gemini.modelName || 'gemini-flash',
            baseUrl: gemini.baseUrl || 'https://generativelanguage.googleapis.com',
            timeout: gemini.timeout || 30000,
            dailyRequestLimit: gemini.dailyRequestLimit || 1000,
            monthlyRequestLimit: gemini.monthlyRequestLimit || 30000,
            dailyTokenLimit: gemini.dailyTokenLimit || 100000,
            monthlyTokenLimit: gemini.monthlyTokenLimit || 3000000,
          }));
        }
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to load providers', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const loadUsageLogs = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { logs: UsageLog[]; total: number } }>('/api/ai/providers/usage?limit=50');
      if (res.success) {
        setUsageLogs(res.data.logs || []);
        setUsageTotal(res.data.total || 0);
      }
    } catch (error) {
      console.error('Failed to load usage logs:', error);
    }
  };

  const testProvider = async (providerId: string) => {
    setTesting(providerId);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { success: boolean; latencyMs: number; error?: string } }>(`/api/ai/providers/${providerId}/test`, {});
      if (res.success && res.data.success) {
        toast({ title: 'Success', description: `Provider test successful (${res.data.latencyMs}ms)` });
      } else {
        toast({ title: 'Test Failed', description: res.data.error || 'Provider test failed', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to test provider', variant: 'destructive' });
    } finally {
      setTesting(null);
    }
  };

  const saveGeminiConfig = async () => {
    setSaving(true);
    try {
      const gemini = providers.find((p) => p.providerKey === 'gemini');
      const payload = {
        providerName: 'Google Gemini AI',
        activeStatus: geminiConfig.activeStatus,
        isDefault: geminiConfig.isDefault,
        modelName: geminiConfig.modelName,
        baseUrl: geminiConfig.baseUrl,
        apiKey: geminiConfig.apiKey || undefined,
        timeout: geminiConfig.timeout,
        dailyRequestLimit: geminiConfig.dailyRequestLimit,
        monthlyRequestLimit: geminiConfig.monthlyRequestLimit,
        dailyTokenLimit: geminiConfig.dailyTokenLimit,
        monthlyTokenLimit: geminiConfig.monthlyTokenLimit,
      };
      if (gemini) {
        await hrmsApi.put(`/api/ai/providers/${gemini.id}`, payload);
      } else {
        await hrmsApi.post('/api/ai/providers', { providerKey: 'gemini', ...payload });
      }
      toast({ title: 'Success', description: 'Gemini configuration saved' });
      await loadProviders();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to save configuration', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const setAsDefault = async (providerId: string) => {
    try {
      await hrmsApi.post(`/api/ai/providers/${providerId}/set-default`, {});
      toast({ title: 'Success', description: 'Provider set as default' });
      await loadProviders();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to set default provider', variant: 'destructive' });
    }
  };

  const disableProvider = async (providerId: string) => {
    try {
      await hrmsApi.post(`/api/ai/providers/${providerId}/disable`, {});
      toast({ title: 'Success', description: 'Provider disabled' });
      await loadProviders();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to disable provider', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">AI Provider Settings</h1>
        <p className="text-muted-foreground">Configure AI providers for PeopleOS Copilot</p>
      </div>

      <Tabs defaultValue="providers" className="space-y-6">
        <TabsList>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="gemini">Gemini Configuration</TabsTrigger>
          <TabsTrigger value="safety">Safety Controls</TabsTrigger>
          <TabsTrigger value="usage">Usage Logs</TabsTrigger>
        </TabsList>

        {/* Providers List */}
        <TabsContent value="providers" className="space-y-4">
          <div className="grid gap-4">
            {providers.map((provider) => (
              <Card key={provider.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {provider.providerName}
                        {provider.isDefault && <Badge>Default</Badge>}
                        {provider.activeStatus === 'active' ? (
                          <Badge variant="default" className="bg-green-500">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>{provider.providerKey}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {provider.providerKey !== 'rule-based' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => testProvider(provider.id)}
                            disabled={testing === provider.id}
                          >
                            {testing === provider.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Test'
                            )}
                          </Button>
                          {!provider.isDefault && provider.activeStatus === 'active' && (
                            <Button size="sm" onClick={() => setAsDefault(provider.id)}>
                              Set as Default
                            </Button>
                          )}
                          {provider.activeStatus === 'active' && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => disableProvider(provider.id)}
                            >
                              Disable
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Model</div>
                      <div className="font-medium">{provider.modelName || 'N/A'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Timeout</div>
                      <div className="font-medium">{provider.timeout ? `${provider.timeout}ms` : 'N/A'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Daily Limit</div>
                      <div className="font-medium">{provider.dailyRequestLimit || 'Unlimited'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Monthly Limit</div>
                      <div className="font-medium">{provider.monthlyRequestLimit || 'Unlimited'}</div>
                    </div>
                  </div>
                  {provider.capabilities && (
                    <div className="mt-4 flex gap-2">
                      {provider.capabilities.supportsChat && <Badge variant="outline">Chat</Badge>}
                      {provider.capabilities.supportsJson && <Badge variant="outline">JSON</Badge>}
                      {provider.capabilities.supportsStreaming && <Badge variant="outline">Streaming</Badge>}
                      {provider.capabilities.supportsEmbeddings && <Badge variant="outline">Embeddings</Badge>}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Gemini Configuration */}
        <TabsContent value="gemini" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Google Gemini Configuration</CardTitle>
              <CardDescription>Configure Google Gemini AI provider</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="gemini-active">Enable Gemini</Label>
                  <p className="text-sm text-muted-foreground">Activate Gemini AI provider</p>
                </div>
                <Switch
                  id="gemini-active"
                  checked={geminiConfig.activeStatus === 'active'}
                  onCheckedChange={(checked) =>
                    setGeminiConfig({ ...geminiConfig, activeStatus: checked ? 'active' : 'inactive' })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="gemini-default">Set as Default</Label>
                  <p className="text-sm text-muted-foreground">Use Gemini as the default AI provider</p>
                </div>
                <Switch
                  id="gemini-default"
                  checked={geminiConfig.isDefault}
                  onCheckedChange={(checked) => setGeminiConfig({ ...geminiConfig, isDefault: checked })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model Name</Label>
                <Select
                  value={geminiConfig.modelName}
                  onValueChange={(value) => setGeminiConfig({ ...geminiConfig, modelName: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini-flash">gemini-flash (Fast, efficient)</SelectItem>
                    <SelectItem value="gemini-pro">gemini-pro (Balanced)</SelectItem>
                    <SelectItem value="gemini-ultra">gemini-ultra (Most capable)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="api-key"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="Enter Gemini API key (leave blank to keep existing)"
                    value={geminiConfig.apiKey}
                    onChange={(e) => setGeminiConfig({ ...geminiConfig, apiKey: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Your API key is encrypted and never exposed to frontend
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="daily-limit">Daily Request Limit</Label>
                  <Input
                    id="daily-limit"
                    type="number"
                    value={geminiConfig.dailyRequestLimit}
                    onChange={(e) =>
                      setGeminiConfig({ ...geminiConfig, dailyRequestLimit: parseInt(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="monthly-limit">Monthly Request Limit</Label>
                  <Input
                    id="monthly-limit"
                    type="number"
                    value={geminiConfig.monthlyRequestLimit}
                    onChange={(e) =>
                      setGeminiConfig({ ...geminiConfig, monthlyRequestLimit: parseInt(e.target.value) })
                    }
                  />
                </div>
              </div>

              <Button onClick={saveGeminiConfig} disabled={saving} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Configuration
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Safety Controls */}
        <TabsContent value="safety" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Safety Controls
              </CardTitle>
              <CardDescription>AI safety and privacy protections (always enabled)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: 'PII Protection', desc: 'Never send raw Aadhaar, PAN, bank, salary data to AI', icon: Shield },
                { label: 'Identity Masking', desc: 'Mask employee and candidate identifiers', icon: Eye },
                { label: 'Role-Based Visibility', desc: 'Enforce business scope and role permissions', icon: Activity },
                { label: 'Audit Logging', desc: 'Log all AI calls with user, role, timestamp', icon: Activity },
                { label: 'Data Confidence Display', desc: 'Show confidence scores with every response', icon: Check },
                { label: 'Fallback Provider', desc: 'Automatic fallback to rule-based on failure', icon: Check },
              ].map((control, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <control.icon className="h-5 w-5 text-green-600" />
                    <div>
                      <div className="font-medium">{control.label}</div>
                      <div className="text-sm text-muted-foreground">{control.desc}</div>
                    </div>
                  </div>
                  <Badge className="bg-green-500">Always On</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Usage Logs */}
        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Usage Logs</CardTitle>
              <CardDescription>Last 50 AI provider requests</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Tokens (In/Out)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usageLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>{log.provider_key}</TableCell>
                      <TableCell className="text-sm">{log.model_name || 'N/A'}</TableCell>
                      <TableCell>{log.latency_ms ? `${log.latency_ms}ms` : 'N/A'}</TableCell>
                      <TableCell>
                        {log.input_token_count || 0} / {log.output_token_count || 0}
                      </TableCell>
                      <TableCell>
                        {log.success ? (
                          <Badge variant="default" className="bg-green-500">
                            <Check className="h-3 w-3 mr-1" />
                            Success
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <X className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                        {log.fallback_used && <Badge variant="secondary" className="ml-1">Fallback</Badge>}
                        {log.safety_blocked && <Badge variant="destructive" className="ml-1">Blocked</Badge>}
                      </TableCell>
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
