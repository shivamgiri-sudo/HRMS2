import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { Loader2, Bell, Mail, MessageSquare, Phone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type Channel = 'email' | 'sms' | 'whatsapp';
type NotificationCategory = 'onboarding' | 'payroll' | 'attendance' | 'leave' | 'performance' | 'alerts' | 'announcements';

interface Preference {
  category: NotificationCategory;
  preferred_channel: Channel;
  enabled: boolean;
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

  useEffect(() => {
    fetchPreferences();
  }, [user?.id]);

  const fetchPreferences = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const response = await hrmsApi.get(`/communication/preferences/${user.id}`);

      // Initialize with defaults if empty
      const prefs = response.data.length > 0
        ? response.data.map((p: any) => ({
            category: p.category,
            preferred_channel: p.preferred_channel,
            enabled: p.enabled === 1
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
  };

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
      await hrmsApi.put(`/communication/preferences/${user.id}`, preferences);
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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Bell className="h-8 w-8" />
          Notification Preferences
        </h1>
        <p className="text-muted-foreground mt-2">
          Choose how you want to receive notifications for different categories
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Communication Channels</CardTitle>
          <CardDescription>
            Select your preferred channel (Email, SMS, or WhatsApp) for each notification category
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {categories.map(category => {
            const pref = preferences.find(p => p.category === category.key);
            if (!pref) return null;

            return (
              <div key={category.key} className="flex items-start justify-between border-b pb-4 last:border-0">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Label className="text-base font-semibold">{category.label}</Label>
                    <Switch
                      checked={pref.enabled}
                      onCheckedChange={() => handleEnabledToggle(category.key)}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">{category.description}</p>
                </div>

                <div className="ml-6 w-48">
                  <Select
                    value={pref.preferred_channel}
                    onValueChange={(value: Channel) => handleChannelChange(category.key, value)}
                    disabled={!pref.enabled}
                  >
                    <SelectTrigger>
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

          <div className="flex justify-end pt-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Preferences
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
