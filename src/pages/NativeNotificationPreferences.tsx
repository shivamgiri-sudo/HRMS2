import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { Loader2, Bell, Mail, MessageSquare, Phone } from "lucide-react";
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

const categories: { key: NotificationCategory; label: string; description: string }[] = [
  { key: 'onboarding', label: 'Onboarding', description: 'Welcome messages, document reminders' },
  { key: 'payroll', label: 'Payroll', description: 'Payslip ready, salary credited' },
  { key: 'attendance', label: 'Attendance', description: 'Late arrival, absent alerts' },
  { key: 'leave', label: 'Leave', description: 'Request approved/rejected' },
  { key: 'performance', label: 'Performance', description: 'Feedback ready, appraisal due' },
  { key: 'alerts', label: 'Alerts', description: 'Urgent notifications' },
  { key: 'announcements', label: 'Announcements', description: 'Company-wide announcements' }
];

const channelIcons = {
  email: <Mail className="h-4 w-4" />,
  sms: <Phone className="h-4 w-4" />,
  whatsapp: <MessageSquare className="h-4 w-4" />
};

export default function NativeNotificationPreferences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPreferences = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const response = await hrmsApi.get<{ success: boolean; data: PreferenceRow[] }>('/api/communication/preferences');

      // Initialize with defaults if empty
      const prefs = response.data.length > 0
        ? response.data.map((p) => ({
            category: p.category,
            preferred_channel: p.preferred_channel,
            enabled: p.enabled === 1 || p.enabled === true
          }))
        : categories.map(cat => ({
            category: cat.key,
            preferred_channel: 'email' as Channel,
            enabled: true
          }));

      setPreferences(prefs);
    } catch (error) {
      console.error('Failed to fetch preferences:', error);
      toast({
        title: "Error",
        description: "Failed to load notification preferences",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user?.id]);

  useEffect(() => {
    void fetchPreferences();
  }, [fetchPreferences]);

  const handleChannelChange = (category: NotificationCategory, channel: Channel) => {
    setPreferences(prev => prev.map(p =>
      p.category === category ? { ...p, preferred_channel: channel } : p
    ));
  };

  const handleEnabledToggle = (category: NotificationCategory) => {
    setPreferences(prev => prev.map(p =>
      p.category === category ? { ...p, enabled: !p.enabled } : p
    ));
  };

  const handleSave = async () => {
    if (!user?.id) return;
    try {
      setSaving(true);
      for (const pref of preferences) {
        await hrmsApi.patch('/api/communication/preferences', pref);
      }
      toast({
        title: "Saved",
        description: "Notification preferences updated successfully"
      });
    } catch (error) {
      console.error('Failed to save preferences:', error);
      toast({
        title: "Error",
        description: "Failed to save preferences",
        variant: "destructive"
      });
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

  const enabledCount = preferences.filter((p) => p.enabled).length;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-5 pb-12">
        <section className="relative overflow-hidden rounded-3xl bg-[#073f78] text-white shadow-lg">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#1B6AB5]/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/4 h-48 w-48 rounded-full bg-[#3BAD49]/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 p-6 sm:p-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-green-200">
                <Bell className="h-3.5 w-3.5" />
                Communication
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">Notification Preferences</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                Choose how you want to receive notifications for each category.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.08] px-4 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enabled</p>
              <p className="text-sm font-bold text-[#3BAD49]">
                {enabledCount} / {categories.length} categories
              </p>
            </div>
          </div>
        </section>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-tight text-slate-950">
              Communication Channels
            </CardTitle>
            <CardDescription className="text-xs">
              Select your preferred channel (Email, SMS, or WhatsApp) for each notification category
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {categories.map(category => {
              const pref = preferences.find(p => p.category === category.key);
              if (!pref) return null;

              return (
                <div
                  key={category.key}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <Switch
                      checked={pref.enabled}
                      onCheckedChange={() => handleEnabledToggle(category.key)}
                      aria-label={`${category.label} notifications`}
                      className="mt-0.5"
                    />
                    <div>
                      <Label className="text-sm font-semibold text-slate-950">{category.label}</Label>
                      <p className="mt-0.5 text-xs text-slate-500">{category.description}</p>
                    </div>
                  </div>

                  <div className="w-full sm:w-48">
                    <Select
                      value={pref.preferred_channel}
                      onValueChange={(value: Channel) => handleChannelChange(category.key, value)}
                      disabled={!pref.enabled}
                    >
                      <SelectTrigger className="h-10 rounded-xl bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">
                          <div className="flex items-center gap-2">
                            {channelIcons.email}
                            Email
                          </div>
                        </SelectItem>
                        <SelectItem value="sms">
                          <div className="flex items-center gap-2">
                            {channelIcons.sms}
                            SMS
                          </div>
                        </SelectItem>
                        <SelectItem value="whatsapp">
                          <div className="flex items-center gap-2">
                            {channelIcons.whatsapp}
                            WhatsApp
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}

            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} disabled={saving} className="rounded-xl bg-[#1B6AB5] hover:bg-[#155a9c]">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Preferences
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
