import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { hrmsApi } from '@/lib/hrmsApi';
import { Trash2, Plus, ChevronUp, ChevronDown, Save, Pencil } from 'lucide-react';

interface FieldDef {
  k: string; lb: string; t: string; ic: string;
  ph: string | null; ok: string | null;
  section: string; visible: boolean; required: boolean; sort_order: number;
}
interface Recruiter { id: string; name: string; active_status: number; sort_order: number; }
interface ConfigRow  { config_key: string; config_label: string; config_type: string; config_value: any; }
interface BranchAlias { id: string; canonical_key: string; display_name: string; alias_text: string; active_status: number; }

const OPTION_GROUPS = [
  { key: 'roleOptions',             label: 'Role / Designation Options' },
  { key: 'educationOptions',        label: 'Education Level Options'    },
  { key: 'experienceOptions',       label: 'Experience Level Options'   },
  { key: 'preferredShiftOptions',   label: 'Preferred Shift Options'    },
  { key: 'nightShiftComfortOptions',label: 'Night Shift Comfort Options'},
  { key: 'genderOptions',           label: 'Gender Options'             },
  { key: 'hiringProcessOptions',    label: 'Hiring Entry Process Options' },
  { key: 'hiringSourceOptions',     label: 'Hiring Entry Source Options' },
  { key: 'hiringPositionOptions',   label: 'Hiring Entry Position Options' },
  { key: 'hiringWpGroupOptions',    label: 'Hiring Entry WP Group Options' },
  { key: 'hiringCallingOutcomeOptions', label: 'Hiring Entry Calling Outcome Options' },
];

export default function NativeATSFormConfig() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ['ats-form-config'],
    queryFn: () => hrmsApi.get<{ success: boolean; data: ConfigRow[] }>('/api/ats/form-config').then(r => r.data),
  });

  const { data: recruiters, isLoading: recruiterLoading } = useQuery({
    queryKey: ['ats-recruiters'],
    queryFn: () => hrmsApi.get<{ success: boolean; data: Recruiter[] }>('/api/ats/recruiters').then(r => r.data),
  });

  const { data: branchAliases, isLoading: aliasesLoading } = useQuery({
    queryKey: ['ats-branch-aliases'],
    queryFn: () => hrmsApi.get<{ success: boolean; data: BranchAlias[] }>('/api/ats/branch-aliases').then(r => r.data),
  });

  const optionMap: Record<string, string[]> = {};
  let initialFields: FieldDef[] = [];
  if (configData) {
    for (const row of configData) {
      if (row.config_type === 'option_list') {
        optionMap[row.config_key] = Array.isArray(row.config_value) ? row.config_value : [];
      }
      if (row.config_key === 'formFields') {
        initialFields = Array.isArray(row.config_value) ? row.config_value : [];
      }
    }
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Interview Registration Form Config</h1>
          <p className="text-slate-500 mt-1">
            Manage form fields, dropdown options, and recruiter list for /interview-registration
          </p>
        </div>
        <Tabs defaultValue="fields">
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="options">Dropdown Options</TabsTrigger>
            <TabsTrigger value="recruiters">Recruiters</TabsTrigger>
            <TabsTrigger value="branches">Branch Aliases</TabsTrigger>
          </TabsList>

          <TabsContent value="fields">
            <FieldsTab
              fields={initialFields}
              loading={configLoading}
              onSave={async (fields) => {
                await hrmsApi.put('/api/ats/form-config/fields', { fields });
                qc.invalidateQueries({ queryKey: ['ats-form-config'] });
                toast({ title: 'Fields saved', description: 'Form field configuration updated.' });
              }}
            />
          </TabsContent>

          <TabsContent value="options">
            <OptionsTab
              optionMap={optionMap}
              loading={configLoading}
              onSave={async (key, values) => {
                await hrmsApi.put(`/api/ats/form-config/${key}`, { values });
                qc.invalidateQueries({ queryKey: ['ats-form-config'] });
                toast({ title: 'Options saved', description: `${key} updated.` });
              }}
            />
          </TabsContent>

          <TabsContent value="recruiters">
            <RecruitersTab
              recruiters={recruiters ?? []}
              loading={recruiterLoading}
              onRefresh={() => qc.invalidateQueries({ queryKey: ['ats-recruiters'] })}
            />
          </TabsContent>

          <TabsContent value="branches">
            <BranchAliasesTab
              aliases={branchAliases ?? []}
              loading={aliasesLoading}
              onRefresh={() => qc.invalidateQueries({ queryKey: ['ats-branch-aliases'] })}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function FieldsTab({ fields: initialFields, loading, onSave }: {
  fields: FieldDef[]; loading: boolean; onSave: (f: FieldDef[]) => Promise<void>;
}) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (initialFields.length > 0 && fields.length === 0) {
      setFields([...initialFields].sort((a, b) => a.sort_order - b.sort_order));
    }
  }, [initialFields]);

  const update = (k: string, patch: Partial<FieldDef>) => {
    setFields(prev => prev.map(f => f.k === k ? { ...f, ...patch } : f));
    setDirty(true);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...fields];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    next.forEach((f, i) => { f.sort_order = i + 1; });
    setFields(next);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(fields); setDirty(false); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading...</div>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Form Fields</CardTitle>
        <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
          <Save className="h-4 w-4 mr-1" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-y">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Order</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Label</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Section</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Type</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Visible</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Required</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {fields.map((f, i) => {
                const locked = f.k === 'name' || f.k === 'mobile';
                const fileField = f.t === 'file' || f.t === 'camera';
                return (
                  <tr key={f.k} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => move(i, -1)} disabled={i === 0}
                          className="p-1 rounded hover:bg-slate-200 disabled:opacity-30">
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button onClick={() => move(i, 1)} disabled={i === fields.length - 1}
                          className="p-1 rounded hover:bg-slate-200 disabled:opacity-30">
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Input value={f.lb} onChange={e => update(f.k, { lb: e.target.value })} className="h-7 text-sm w-48" />
                    </td>
                    <td className="px-4 py-2 text-slate-500">{f.section}</td>
                    <td className="px-4 py-2"><Badge variant="outline" className="text-xs">{f.t}</Badge></td>
                    <td className="px-4 py-2 text-center">
                      <Switch checked={f.visible} onCheckedChange={v => update(f.k, { visible: v })} disabled={locked} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Switch checked={f.required} onCheckedChange={v => update(f.k, { required: v })} disabled={fileField} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function OptionsTab({ optionMap, loading, onSave }: {
  optionMap: Record<string, string[]>; loading: boolean;
  onSave: (key: string, values: string[]) => Promise<void>;
}) {
  const [selectedKey, setSelectedKey] = useState(OPTION_GROUPS[0].key);
  const [localOptions, setLocalOptions] = useState<Record<string, string[]>>({});
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (Object.keys(optionMap).length === 0) return;
    setLocalOptions(prev => {
      // Pull in any DB keys not yet present in local state (new groups, first load, etc.)
      // without overwriting keys the user has already edited this session.
      const missing: Record<string, string[]> = {};
      for (const k of Object.keys(optionMap)) {
        if (!(k in prev)) missing[k] = optionMap[k];
      }
      return Object.keys(missing).length > 0 ? { ...prev, ...missing } : prev;
    });
  }, [optionMap]);

  const current = localOptions[selectedKey] ?? [];

  const addOption = async () => {
    if (!newValue.trim()) return;
    const updated = [...current, newValue.trim()];
    setLocalOptions(prev => ({ ...prev, [selectedKey]: updated }));
    setNewValue('');
    setSaving(true);
    try { await onSave(selectedKey, updated); } finally { setSaving(false); }
  };

  const removeOption = async (val: string) => {
    const updated = current.filter(v => v !== val);
    setLocalOptions(prev => ({ ...prev, [selectedKey]: updated }));
    setSaving(true);
    try { await onSave(selectedKey, updated); } finally { setSaving(false); }
  };

  const moveOption = async (idx: number, dir: -1 | 1) => {
    const next = [...current];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setLocalOptions(prev => ({ ...prev, [selectedKey]: next }));
    setSaving(true);
    try { await onSave(selectedKey, next); } finally { setSaving(false); }
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading...</div>;

  return (
    <div className="grid grid-cols-4 gap-4">
      <Card className="col-span-1">
        <CardContent className="p-2">
          {OPTION_GROUPS.map(g => (
            <button key={g.key} onClick={() => setSelectedKey(g.key)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${selectedKey === g.key ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
              {g.label}
            </button>
          ))}
        </CardContent>
      </Card>
      <Card className="col-span-3">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">{OPTION_GROUPS.find(g => g.key === selectedKey)?.label}</CardTitle>
          {saving && <span className="text-xs text-slate-400">Saving...</span>}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Add new option..." className="flex-1" onKeyDown={e => e.key === 'Enter' && addOption()} />
            <Button onClick={addOption} size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
          </div>
          <div className="space-y-2">
            {current.map((val, i) => (
              <div key={val} className="flex items-center gap-2 bg-slate-50 rounded px-3 py-1.5">
                <div className="flex gap-1">
                  <button onClick={() => moveOption(i, -1)} disabled={i === 0} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronUp className="h-3 w-3" /></button>
                  <button onClick={() => moveOption(i, 1)} disabled={i === current.length - 1} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronDown className="h-3 w-3" /></button>
                </div>
                <span className="flex-1 text-sm">{val}</span>
                <button onClick={() => removeOption(val)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {current.length === 0 && <p className="text-slate-400 text-sm text-center py-4">No options yet. Add one above.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RecruitersTab({ recruiters, loading, onRefresh }: {
  recruiters: Recruiter[]; loading: boolean; onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const add = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await hrmsApi.post('/api/ats/recruiters', { name: newName.trim() });
      setNewName(''); setShowAdd(false); onRefresh();
      toast({ title: 'Recruiter added' });
    } catch { toast({ title: 'Error', description: 'Could not add recruiter', variant: 'destructive' }); }
    finally { setAdding(false); }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await hrmsApi.patch(`/api/ats/recruiters/${id}`, { name: editName.trim() });
      setEditingId(null);
      onRefresh();
      toast({ title: 'Recruiter name updated' });
    } catch { toast({ title: 'Error', description: 'Could not update name', variant: 'destructive' }); }
  };

  const toggle = async (id: string, current: number) => {
    await hrmsApi.patch(`/api/ats/recruiters/${id}`, { active_status: current === 1 ? 0 : 1 });
    onRefresh();
  };

  const remove = async (id: string) => {
    await hrmsApi.delete(`/api/ats/recruiters/${id}`);
    onRefresh();
    toast({ title: 'Recruiter removed' });
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading...</div>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Recruiters ({recruiters.filter(r => r.active_status === 1).length} active)</CardTitle>
        <Button size="sm" onClick={() => setShowAdd(v => !v)}><Plus className="h-4 w-4 mr-1" /> Add Recruiter</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <div className="flex gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Recruiter name..." className="flex-1" onKeyDown={e => e.key === 'Enter' && add()} autoFocus />
            <Button onClick={add} disabled={adding} size="sm">{adding ? 'Adding...' : 'Save'}</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        )}
        {recruiters.length === 0 && !showAdd && (
          <p className="text-slate-400 text-sm text-center py-6">No recruiters added yet. Click "Add Recruiter" to start.</p>
        )}
        <div className="divide-y">
          {recruiters.map((r, i) => (
            <div key={r.id} className="py-2.5">
              {editingId === r.id ? (
                <div className="flex gap-2 items-center">
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="flex-1 h-8 text-sm" onKeyDown={e => { if (e.key === 'Enter') saveEdit(r.id); if (e.key === 'Escape') setEditingId(null); }} autoFocus />
                  <Button size="sm" className="h-8" onClick={() => saveEdit(r.id)}>Save</Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    <button onClick={async () => { await hrmsApi.patch(`/api/ats/recruiters/${r.id}`, { sort_order: r.sort_order - 1 }); onRefresh(); }} disabled={i === 0} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button onClick={async () => { await hrmsApi.patch(`/api/ats/recruiters/${r.id}`, { sort_order: r.sort_order + 1 }); onRefresh(); }} disabled={i === recruiters.length - 1} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                  </div>
                  <span className={`flex-1 text-sm ${r.active_status !== 1 ? 'line-through text-slate-400' : ''}`}>{r.name}</span>
                  <button onClick={() => { setEditingId(r.id); setEditName(r.name); }} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                  <Switch checked={r.active_status === 1} onCheckedChange={() => toggle(r.id, r.active_status)} />
                  <Badge variant={r.active_status === 1 ? 'default' : 'secondary'} className="text-xs w-16 justify-center">
                    {r.active_status === 1 ? 'Active' : 'Inactive'}
                  </Badge>
                  <button onClick={() => remove(r.id)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BranchAliasesTab({ aliases: initialAliases, loading, onRefresh }: {
  aliases: BranchAlias[]; loading: boolean; onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [newCanonical, setNewCanonical] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [newAliasText, setNewAliasText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ canonical: string; display: string; alias: string }>({ canonical: '', display: '', alias: '' });

  const aliases = initialAliases.sort((a, b) => {
    if (a.active_status !== b.active_status) return b.active_status - a.active_status;
    return a.display_name.localeCompare(b.display_name);
  });

  const add = async () => {
    if (!newCanonical.trim() || !newDisplay.trim()) return;
    setAdding(true);
    try {
      await hrmsApi.post('/api/ats/branch-aliases', {
        canonical_key: newCanonical.trim(),
        display_name: newDisplay.trim(),
        alias_text: newAliasText.trim() || null,
      });
      toast({ title: 'Branch alias added', description: `"${newDisplay}" added successfully.` });
      setNewCanonical('');
      setNewDisplay('');
      setNewAliasText('');
      setShowAdd(false);
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to add alias', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (alias: BranchAlias) => {
    setEditing(alias.id);
    setEditValues({ canonical: alias.canonical_key, display: alias.display_name, alias: alias.alias_text || '' });
  };

  const saveEdit = async (id: string) => {
    try {
      await hrmsApi.patch(`/api/ats/branch-aliases/${id}`, {
        canonical_key: editValues.canonical,
        display_name: editValues.display,
        alias_text: editValues.alias || null,
      });
      toast({ title: 'Updated', description: 'Branch alias updated successfully.' });
      setEditing(null);
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to update', variant: 'destructive' });
    }
  };

  const toggle = async (id: string, currentStatus: number) => {
    try {
      await hrmsApi.patch(`/api/ats/branch-aliases/${id}`, { active_status: currentStatus === 1 ? 0 : 1 });
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this branch alias permanently?')) return;
    try {
      await hrmsApi.delete(`/api/ats/branch-aliases/${id}`);
      toast({ title: 'Deleted', description: 'Branch alias removed.' });
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading...</div>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Branch Display Names</CardTitle>
          <p className="text-sm text-slate-500 mt-1">
            Configure user-friendly names shown to candidates. Database stores canonical names.
          </p>
        </div>
        {!showAdd && (
          <Button onClick={() => setShowAdd(true)} size="sm" className="flex items-center gap-1">
            <Plus className="h-4 w-4" /> Add Alias
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Official Branch Name (Database)</label>
                <Input
                  value={newCanonical}
                  onChange={e => setNewCanonical(e.target.value)}
                  placeholder="e.g., AHMEDABAD-JALDARSHAN"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Display Name (Candidates See)</label>
                <Input
                  value={newDisplay}
                  onChange={e => setNewDisplay(e.target.value)}
                  placeholder="e.g., Jaldarshan - Ahmedabad"
                  className="text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1">Search Keywords (Optional)</label>
              <Input
                value={newAliasText}
                onChange={e => setNewAliasText(e.target.value)}
                placeholder="e.g., Ahmedabad Gujarat Jaldarshan"
                className="text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={add} disabled={adding || !newCanonical.trim() || !newDisplay.trim()} size="sm">
                {adding ? 'Adding...' : 'Save'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {aliases.length === 0 && !showAdd && (
          <p className="text-slate-400 text-sm text-center py-6">No branch aliases configured. Click "Add Alias" to start.</p>
        )}
        <div className="divide-y">
          {aliases.map((alias) => (
            <div key={alias.id} className={`py-3 ${alias.active_status !== 1 ? 'opacity-50' : ''}`}>
              {editing === alias.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-slate-600 block mb-1">Official Branch Name (Database)</label>
                      <Input
                        value={editValues.canonical}
                        onChange={e => setEditValues({ ...editValues, canonical: e.target.value })}
                        className="text-sm font-mono"
                        placeholder="e.g., AHMEDABAD-JALDARSHAN"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 block mb-1">Display Name</label>
                      <Input
                        value={editValues.display}
                        onChange={e => setEditValues({ ...editValues, display: e.target.value })}
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 block mb-1">Search Keywords</label>
                      <Input
                        value={editValues.alias}
                        onChange={e => setEditValues({ ...editValues, alias: e.target.value })}
                        className="text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => saveEdit(alias.id)} size="sm" variant="default">
                      <Save className="h-3 w-3 mr-1" /> Save
                    </Button>
                    <Button onClick={() => setEditing(null)} size="sm" variant="ghost">Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        {alias.canonical_key}
                      </span>
                      <span className="text-lg">→</span>
                      <span className="font-medium text-sm">{alias.display_name}</span>
                    </div>
                    {alias.alias_text && (
                      <div className="text-xs text-slate-500 mt-1">
                        Keywords: {alias.alias_text}
                      </div>
                    )}
                  </div>
                  <Button onClick={() => startEdit(alias)} size="sm" variant="outline" className="h-7">
                    Edit
                  </Button>
                  <Switch checked={alias.active_status === 1} onCheckedChange={() => toggle(alias.id, alias.active_status)} />
                  <Badge variant={alias.active_status === 1 ? 'default' : 'secondary'} className="text-xs w-16 justify-center">
                    {alias.active_status === 1 ? 'Active' : 'Inactive'}
                  </Badge>
                  <button onClick={() => remove(alias.id)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
