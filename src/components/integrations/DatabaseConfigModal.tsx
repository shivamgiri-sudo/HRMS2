// src/components/integrations/DatabaseConfigModal.tsx
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hrmsApi } from '@/lib/hrmsApi';
import type { DbConnectorConfig } from './DatabaseConnectorCard';

interface Props {
  open: boolean;
  onClose: () => void;
  integrationKey: string;
  name: string;
  initialConfig: DbConnectorConfig;
  showTables?: boolean;
}

interface TestResult {
  ok: boolean;
  error?: string;
}

export function DatabaseConfigModal({ open, onClose, integrationKey, name, initialConfig }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState(initialConfig);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => { setForm(initialConfig); setTestResult(null); }, [open]);

  const set = (key: keyof DbConnectorConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: key === 'port' ? Number(e.target.value) : e.target.value }));

  const saveMutation = useMutation({
    mutationFn: (data: Partial<DbConnectorConfig>) =>
      hrmsApi.put(`/external-db/${integrationKey}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['external-db'] });
      onClose();
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      await hrmsApi.put(`/external-db/${integrationKey}`, form);
      return hrmsApi.post<TestResult>(`/external-db/${integrationKey}/test`, {});
    },
    onSuccess: (res) => setTestResult(res as TestResult),
    onError: (e: unknown) => setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure — {name}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Host / IP Address *</Label>
            <Input value={form.host} onChange={set('host')} placeholder="e.g. 172.10.10.146" />
          </div>
          <div className="space-y-1">
            <Label>Port *</Label>
            <Input type="number" value={form.port} onChange={set('port')} />
          </div>
          <div className="space-y-1">
            <Label>Database Name *</Label>
            <Input value={form.database} onChange={set('database')} />
          </div>
          <div className="space-y-1">
            <Label>Username *</Label>
            <Input value={form.username} onChange={set('username')} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Password</Label>
            <Input
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder="Leave blank to keep existing"
            />
            <p className="text-xs text-muted-foreground">Stored encrypted. Leave blank to keep existing password.</p>
          </div>
          <div className="space-y-1">
            <Label>Date Column</Label>
            <Input value={form.date_column} onChange={set('date_column')} placeholder="event_time" />
          </div>
          <div className="space-y-1">
            <Label>Employee Code Column</Label>
            <Input value={form.employee_code_column} onChange={set('employee_code_column')} placeholder="agent_user" />
          </div>
        </div>

        {testResult && (
          <div className={`rounded p-3 text-sm flex items-center gap-2 ${testResult.ok ? 'bg-green-950 text-green-400' : 'bg-red-950 text-red-400'}`}>
            <span>{testResult.ok ? '✓' : '✗'}</span>
            <span>{testResult.ok ? 'Connection successful' : testResult.error ?? 'Connection failed'}</span>
          </div>
        )}

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
            {testMutation.isPending ? 'Testing…' : '⚡ Test Connection'}
          </Button>
          <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save Configuration'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
