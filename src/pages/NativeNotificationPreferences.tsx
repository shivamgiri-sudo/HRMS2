import { useCallback, useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import {
  AlertTriangle, Bell, CheckCircle2, Loader2, Mail, MessageSquare, Phone, ShieldAlert, Sparkles, Undo2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type Channel = 'email' | 'sms' | 'whatsapp';
type NotificationCategory = 'onboarding' | 'payroll' | 'attendance' | 'leave' | 'performance' | 'alerts' | 'announcements';

interface Preference {
  category: NotificationCategory;
  preferred_channel: Channel;
  enabled: boolean;
}

interface PreferenceRow {
  category: NotificationCategory;
  preferred_channel: Channel;
  enabled: boolean | number;
}

const categories: { key: NotificationCategory; label: string; description: string; critical: boolean }[] = [
  { key: 'payroll', label: 'Payroll', description: 'Payslip ready, salary credited', critical: true },
  { key: 'attendance', label: 'Attendance', description: 'Late arrival, absent alerts', critical: true },
  { key: 'alerts', label: 'Alerts', description: 'Urgent notifications', critical: true },
  { key: 'leave', label: 'Leave', description: 'Request approved/rejected', critical: false },
  { key: 'onboarding', label: 'Onboarding', description: 'Welcome messages, document reminders', critical: false },
  { key: 'performance', label: 'Performance', description: 'Feedback ready, appraisal due', critical: false },
  { key: 'announcements', label: 'Announcements', description: 'Company-wide announcements', critical: false },
];

const channels: { key: Channel; label: string; color: string; icon: typeof Mail }[] = [
  { key: 'email', label: 'Email', color: '#1B6AB5', icon: Mail },
  { key: 'sms', label: 'SMS', color: '#f59e0b', icon: Phone },
  { key: 'whatsapp', label: 'WhatsApp', color: '#3BAD49', icon: MessageSquare },
];

const defaultPrefs = (): Preference[] =>
  categories.map(c => ({ category: c.key, preferred_channel: 'email' as Channel, enabled: true }));

export default function NativeNotificationPreferences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [saved, setSaved] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPreferences = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const response = await hrmsApi.get<{ success: boolean; data: PreferenceRow[] }>('/api/communication/preferences');
      const fromServer = new Map(
        (response.data ?? []).map(p => [p.category, {
          category: p.category,
          preferred_channel: p.preferred_channel,
          enabled: p.enabled === 1 || p.enabled === true,
        } as Preference]),
      );
      // A category the server has no row for falls back to the default, so a partial response
      // can't leave a category missing from the page.
      const prefs = defaultPrefs().map(d => fromServer.get(d.category) ?? d);
      setPreferences(prefs);
      setSaved(prefs);
    } catch (error) {
      console.error('Failed to fetch preferences:', error);
      toast({ title: "Error", description: "Failed to load notification preferences", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, user?.id]);

  useEffect(() => {
    void fetchPreferences();
  }, [fetchPreferences]);

  const update = (category: NotificationCategory, patch: Partial<Preference>) =>
    setPreferences(prev => prev.map(p => (p.category === category ? { ...p, ...patch } : p)));

  const applyPreset = (fn: (c: typeof categories[number], p: Preference) => Partial<Preference>) =>
    setPreferences(prev => prev.map(p => ({ ...p, ...fn(categories.find(c => c.key === p.category)!, p) })));

  const changed = useMemo(
    () => preferences.filter(p => {
      const orig = saved.find(s => s.category === p.category);
      return !orig || orig.enabled !== p.enabled || orig.preferred_channel !== p.preferred_channel;
    }),
    [preferences, saved],
  );

  const handleSave = async () => {
    if (!user?.id || changed.length === 0) return;
    try {
      setSaving(true);
      for (const pref of changed) {
        await hrmsApi.patch('/api/communication/preferences', pref);
      }
      setSaved(preferences);
      toast({ title: "Saved", description: `${changed.length} preference${changed.length === 1 ? "" : "s"} updated` });
    } catch (error) {
      console.error('Failed to save preferences:', error);
      toast({ title: "Error", description: "Failed to save preferences", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#1B6AB5]" />
        </div>
      </DashboardLayout>
    );
  }

  const enabled = preferences.filter(p => p.enabled);
  const coverage = Math.round((enabled.length / categories.length) * 100);
  const mix = channels
    .map(ch => ({ channel: ch.key, name: ch.label, fill: ch.color, value: enabled.filter(p => p.preferred_channel === ch.key).length }))
    .filter(d => d.value > 0);
  const mutedCritical = categories.filter(c => c.critical && !preferences.find(p => p.category === c.key)?.enabled);

  const coverageConfig = { coverage: { label: "Coverage", color: "#3BAD49" } } satisfies ChartConfig;
  const mixConfig = Object.fromEntries(channels.map(c => [c.key, { label: c.label, color: c.color }])) satisfies ChartConfig;

  const presets = [
    { label: "Everything on Email", run: () => applyPreset(() => ({ enabled: true, preferred_channel: 'email' })) },
    { label: "Critical on WhatsApp", run: () => applyPreset(c => (c.critical ? { enabled: true, preferred_channel: 'whatsapp' } : {})) },
    { label: "Mute non-critical", run: () => applyPreset(c => ({ enabled: c.critical })) },
  ];

  const renderRow = (c: typeof categories[number]) => {
    const pref = preferences.find(p => p.category === c.key);
    if (!pref) return null;
    const dirty = changed.some(p => p.category === c.key);
    return (
      <div
        key={c.key}
        className={`flex flex-col gap-3 rounded-2xl border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${
          pref.enabled ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
        } ${dirty ? "ring-2 ring-[#1B6AB5]/30" : ""}`}
      >
        <div className="flex items-start gap-3">
          <Switch
            checked={pref.enabled}
            onCheckedChange={v => update(c.key, { enabled: v })}
            aria-label={`${c.label} notifications`}
            className="mt-0.5"
          />
          <div>
            <p className={`text-sm font-semibold ${pref.enabled ? "text-slate-950" : "text-slate-400"}`}>
              {c.label}
              {dirty && <span className="ml-2 text-[10px] font-bold uppercase text-[#1B6AB5]">edited</span>}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{c.description}</p>
          </div>
        </div>

        <ToggleGroup
          type="single"
          value={pref.preferred_channel}
          onValueChange={v => v && update(c.key, { preferred_channel: v as Channel })}
          disabled={!pref.enabled}
          className="justify-start rounded-xl bg-slate-100 p-1 sm:justify-end"
          aria-label={`${c.label} channel`}
        >
          {channels.map(ch => (
            <ToggleGroupItem
              key={ch.key}
              value={ch.key}
              className="h-8 gap-1.5 rounded-lg px-3 text-xs font-semibold data-[state=on]:bg-white data-[state=on]:shadow-sm"
            >
              <ch.icon className="h-3.5 w-3.5" style={{ color: ch.color }} />
              {ch.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-5 pb-28">
        <section className="relative overflow-hidden rounded-3xl bg-[#073f78] text-white shadow-lg">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#1B6AB5]/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/4 h-48 w-48 rounded-full bg-[#3BAD49]/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-7">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-green-200">
                <Bell className="h-3.5 w-3.5" />
                Communication
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">Notification Preferences</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                Decide what reaches you and where. Critical updates like payroll and attendance are grouped so you don't miss them.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={p.run}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  <Sparkles className="h-3 w-3" />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {mutedCritical.length > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">You've muted critical updates: </span>
              {mutedCritical.map(c => c.label).join(", ")}. You won't be told about salary credits, absences or urgent alerts.
            </p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold tracking-tight text-slate-950">Coverage</h2>
            <p className="mt-0.5 text-xs text-slate-500">Categories you'll be notified about</p>
            <div className="relative mx-auto mt-2 h-[170px] w-[170px]">
              <ChartContainer config={coverageConfig} className="h-full w-full">
                <RadialBarChart data={[{ coverage }]} innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270}>
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar dataKey="coverage" cornerRadius={12} fill={coverage === 100 ? "#3BAD49" : coverage >= 50 ? "#1B6AB5" : "#f59e0b"} background />
                </RadialBarChart>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-slate-950">{enabled.length}/{categories.length}</span>
                <span className="text-[11px] font-semibold text-slate-400">{coverage}% on</span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold tracking-tight text-slate-950">Channel mix</h2>
            <p className="mt-0.5 text-xs text-slate-500">Where your active categories are delivered</p>
            {mix.length > 0 ? (
              <div className="mt-2 flex items-center gap-4">
                <ChartContainer config={mixConfig} className="h-[170px] w-[170px] shrink-0">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="channel" />} />
                    <Pie data={mix} dataKey="value" nameKey="channel" innerRadius={48} outerRadius={78} paddingAngle={3} strokeWidth={0}>
                      {mix.map(m => <Cell key={m.channel} fill={m.fill} />)}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <ul className="flex-1 space-y-2">
                  {channels.map(ch => {
                    const n = enabled.filter(p => p.preferred_channel === ch.key).length;
                    return (
                      <li key={ch.key} className="flex items-center gap-2 text-xs">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: ch.color }} />
                        <span className="font-medium text-slate-700">{ch.label}</span>
                        <span className="ml-auto font-bold text-slate-900">{n}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="mt-4 flex h-[170px] items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
                All notifications are muted
              </div>
            )}
          </section>
        </div>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Critical updates
          </h2>
          {categories.filter(c => c.critical).map(renderRow)}
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <CheckCircle2 className="h-4 w-4 text-slate-400" />
            General updates
          </h2>
          {categories.filter(c => !c.critical).map(renderRow)}
        </section>
      </div>

      {/* Sticky save bar: only visible when there is something to save */}
      <div
        className={`fixed inset-x-0 bottom-4 z-30 mx-auto flex w-[calc(100%-2rem)] max-w-xl items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur transition-all duration-300 ${
          changed.length > 0 ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        }`}
        role="status"
        aria-live="polite"
      >
        <p className="flex-1 text-sm font-semibold text-slate-800">
          {changed.length} unsaved change{changed.length === 1 ? "" : "s"}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setPreferences(saved)} disabled={saving} className="gap-1.5">
          <Undo2 className="h-4 w-4" />
          Discard
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || changed.length === 0} className="rounded-xl bg-[#1B6AB5] hover:bg-[#155a9c]">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </div>
    </DashboardLayout>
  );
}
