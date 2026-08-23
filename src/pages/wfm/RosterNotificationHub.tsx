/**
 * Roster Notification Hub
 * Configure which alerts go to whom — manager digest, unplanned absence, compliance violations
 * Follows MAS HRMS frozen design patterns
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellRing,
  Save,
  RefreshCw,
  Plus,
  Trash2,
  Mail,
  MessageSquare,
  Smartphone,
  Clock,
  Users,
  AlertTriangle,
  Calendar,
  ShieldAlert,
  Loader2,
  CheckCircle,
  ChevronDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';

interface NotificationRule {
  id: string;
  alertType: string;
  alertName: string;
  description: string;
  recipients: string[];
  channels: ('email' | 'push' | 'sms')[];
  frequency: 'immediate' | 'hourly' | 'daily' | 'weekly';
  enabled: boolean;
  threshold?: number;
  scheduleTime?: string;
}

const toneColors = {
  blue: { iconBg: '#edf4ff', value: '#0b63e5', border: '#dce8fb' },
  green: { iconBg: '#eaf8ef', value: '#15803d', border: '#d7f0df' },
  amber: { iconBg: '#fff4e8', value: '#ea580c', border: '#fee3c5' },
  red: { iconBg: '#fff0f1', value: '#dc2626', border: '#ffdadd' },
  violet: { iconBg: '#f3efff', value: '#6d28d9', border: '#e6ddff' },
};

const defaultRules: NotificationRule[] = [
  {
    id: '1',
    alertType: 'UNPLANNED_ABSENCE',
    alertName: 'Unplanned Absence Alert',
    description: 'Notify when employee is absent without prior leave request',
    recipients: ['manager', 'wfm'],
    channels: ['email', 'push'],
    frequency: 'immediate',
    enabled: true,
  },
  {
    id: '2',
    alertType: 'MANAGER_DIGEST',
    alertName: 'Daily Manager Digest',
    description: 'Summary of team attendance, pending approvals, and roster changes',
    recipients: ['manager'],
    channels: ['email'],
    frequency: 'daily',
    enabled: true,
    scheduleTime: '08:00',
  },
  {
    id: '3',
    alertType: 'COMPLIANCE_VIOLATION',
    alertName: 'Compliance Violation Alert',
    description: 'Alert when WFM rules are violated (rest policy, consecutive days)',
    recipients: ['wfm', 'hr'],
    channels: ['email', 'push'],
    frequency: 'immediate',
    enabled: true,
  },
  {
    id: '4',
    alertType: 'ROSTER_PUBLISHED',
    alertName: 'Roster Published',
    description: 'Notify employees when new roster is published for their team',
    recipients: ['employee'],
    channels: ['push'],
    frequency: 'immediate',
    enabled: true,
  },
  {
    id: '5',
    alertType: 'SHIFT_CHANGE',
    alertName: 'Shift Change Notice',
    description: 'Alert employee when their assigned shift is modified',
    recipients: ['employee', 'manager'],
    channels: ['email', 'push', 'sms'],
    frequency: 'immediate',
    enabled: true,
  },
  {
    id: '6',
    alertType: 'COVERAGE_GAP',
    alertName: 'Coverage Gap Warning',
    description: 'Alert when staffing falls below minimum threshold',
    recipients: ['wfm', 'operations_manager'],
    channels: ['email', 'push'],
    frequency: 'immediate',
    enabled: true,
    threshold: 80,
  },
  {
    id: '7',
    alertType: 'WEEKOFF_REQUEST',
    alertName: 'Week-off Request Pending',
    description: 'Remind manager of pending week-off requests',
    recipients: ['manager'],
    channels: ['email'],
    frequency: 'daily',
    enabled: false,
    scheduleTime: '09:00',
  },
  {
    id: '8',
    alertType: 'AT_RISK_EMPLOYEE',
    alertName: 'At-Risk Employee Alert',
    description: 'Notify HR when employee enters HIGH/CRITICAL risk tier',
    recipients: ['hr', 'manager'],
    channels: ['email', 'push'],
    frequency: 'immediate',
    enabled: true,
  },
];

const recipientOptions = [
  { value: 'employee', label: 'Employee (Self)' },
  { value: 'manager', label: 'Reporting Manager' },
  { value: 'wfm', label: 'WFM Team' },
  { value: 'hr', label: 'HR Admin' },
  { value: 'operations_manager', label: 'Operations Manager' },
  { value: 'process_head', label: 'Process Head' },
  { value: 'branch_head', label: 'Branch Head' },
];

const getAlertIcon = (alertType: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    UNPLANNED_ABSENCE: <AlertTriangle className="w-5 h-5 text-red-500" />,
    MANAGER_DIGEST: <Mail className="w-5 h-5 text-blue-500" />,
    COMPLIANCE_VIOLATION: <ShieldAlert className="w-5 h-5 text-amber-500" />,
    ROSTER_PUBLISHED: <Calendar className="w-5 h-5 text-green-500" />,
    SHIFT_CHANGE: <Clock className="w-5 h-5 text-violet-500" />,
    COVERAGE_GAP: <Users className="w-5 h-5 text-red-500" />,
    WEEKOFF_REQUEST: <Calendar className="w-5 h-5 text-blue-500" />,
    AT_RISK_EMPLOYEE: <AlertTriangle className="w-5 h-5 text-amber-500" />,
  };
  return iconMap[alertType] || <Bell className="w-5 h-5 text-gray-500" />;
};

const getChannelIcon = (channel: string) => {
  switch (channel) {
    case 'email':
      return <Mail className="w-4 h-4" />;
    case 'push':
      return <Smartphone className="w-4 h-4" />;
    case 'sms':
      return <MessageSquare className="w-4 h-4" />;
    default:
      return <Bell className="w-4 h-4" />;
  }
};

export default function RosterNotificationHub() {
  const [rules, setRules] = useState<NotificationRule[]>(defaultRules);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleToggle = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleChannelToggle = (ruleId: string, channel: 'email' | 'push' | 'sms') => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== ruleId) return r;
        const channels = r.channels.includes(channel)
          ? r.channels.filter((c) => c !== channel)
          : [...r.channels, channel];
        return { ...r, channels };
      })
    );
  };

  const handleFrequencyChange = (ruleId: string, frequency: string) => {
    setRules((prev) =>
      prev.map((r) =>
        r.id === ruleId
          ? { ...r, frequency: frequency as NotificationRule['frequency'] }
          : r
      )
    );
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSaving(false);
    toast.success('Notification settings saved');
  };

  const enabledCount = rules.filter((r) => r.enabled).length;
  const immediateCount = rules.filter((r) => r.enabled && r.frequency === 'immediate').length;
  const digestCount = rules.filter(
    (r) => r.enabled && ['daily', 'weekly', 'hourly'].includes(r.frequency)
  ).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 sm:p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-6 text-white shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <BellRing className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Notification Hub</h1>
                <p className="text-white/80 text-sm">
                  Configure roster alerts for managers, WFM, HR and employees
                </p>
              </div>
            </div>
            <Button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="bg-white text-indigo-600 hover:bg-white/90"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save All Settings
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: toneColors.green.iconBg }}
                >
                  <CheckCircle className="w-5 h-5" style={{ color: toneColors.green.value }} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Active Alerts</p>
                  <p className="text-xl font-bold" style={{ color: toneColors.green.value }}>
                    {enabledCount} / {rules.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: toneColors.red.iconBg }}
                >
                  <AlertTriangle className="w-5 h-5" style={{ color: toneColors.red.value }} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Immediate Alerts</p>
                  <p className="text-xl font-bold" style={{ color: toneColors.red.value }}>
                    {immediateCount}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: toneColors.blue.iconBg }}
                >
                  <Mail className="w-5 h-5" style={{ color: toneColors.blue.value }} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Digest/Scheduled</p>
                  <p className="text-xl font-bold" style={{ color: toneColors.blue.value }}>
                    {digestCount}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Rules List */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Bell className="w-5 h-5 text-slate-600" />
              Alert Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {rules.map((rule) => (
                <Collapsible
                  key={rule.id}
                  open={expandedRule === rule.id}
                  onOpenChange={() =>
                    setExpandedRule(expandedRule === rule.id ? null : rule.id)
                  }
                >
                  <CollapsibleTrigger className="w-full">
                    <div className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            rule.enabled ? 'bg-slate-100' : 'bg-gray-100'
                          }`}
                        >
                          {getAlertIcon(rule.alertType)}
                        </div>
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <p
                              className={`font-semibold ${
                                rule.enabled ? 'text-gray-900' : 'text-gray-400'
                              }`}
                            >
                              {rule.alertName}
                            </p>
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                rule.frequency === 'immediate'
                                  ? 'border-red-200 text-red-600'
                                  : 'border-blue-200 text-blue-600'
                              }`}
                            >
                              {rule.frequency}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-500">{rule.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          {rule.channels.map((ch) => (
                            <div
                              key={ch}
                              className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center"
                              title={ch}
                            >
                              {getChannelIcon(ch)}
                            </div>
                          ))}
                        </div>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={() => handleToggle(rule.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <ChevronDown
                          className={`w-5 h-5 text-gray-400 transition-transform ${
                            expandedRule === rule.id ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4 pt-0 ml-14 space-y-4 border-t bg-slate-50/50">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                        {/* Channels */}
                        <div>
                          <Label className="text-xs text-gray-500 uppercase">
                            Delivery Channels
                          </Label>
                          <div className="flex items-center gap-2 mt-2">
                            {(['email', 'push', 'sms'] as const).map((ch) => (
                              <Button
                                key={ch}
                                variant={rule.channels.includes(ch) ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => handleChannelToggle(rule.id, ch)}
                                className={
                                  rule.channels.includes(ch)
                                    ? 'bg-indigo-600'
                                    : ''
                                }
                              >
                                {getChannelIcon(ch)}
                                <span className="ml-1 capitalize">{ch}</span>
                              </Button>
                            ))}
                          </div>
                        </div>

                        {/* Frequency */}
                        <div>
                          <Label className="text-xs text-gray-500 uppercase">Frequency</Label>
                          <Select
                            value={rule.frequency}
                            onValueChange={(v) => handleFrequencyChange(rule.id, v)}
                          >
                            <SelectTrigger className="mt-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="immediate">Immediate</SelectItem>
                              <SelectItem value="hourly">Hourly Digest</SelectItem>
                              <SelectItem value="daily">Daily Digest</SelectItem>
                              <SelectItem value="weekly">Weekly Summary</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Recipients */}
                        <div>
                          <Label className="text-xs text-gray-500 uppercase">Recipients</Label>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {rule.recipients.map((r) => (
                              <Badge
                                key={r}
                                variant="secondary"
                                className="text-xs bg-indigo-100 text-indigo-700"
                              >
                                {recipientOptions.find((o) => o.value === r)?.label || r}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Schedule time for digest */}
                      {['daily', 'weekly', 'hourly'].includes(rule.frequency) && (
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-gray-400" />
                          <Label className="text-sm text-gray-600">Schedule Time:</Label>
                          <Input
                            type="time"
                            value={rule.scheduleTime || '08:00'}
                            className="w-32"
                            onChange={(e) => {
                              setRules((prev) =>
                                prev.map((r) =>
                                  r.id === rule.id
                                    ? { ...r, scheduleTime: e.target.value }
                                    : r
                                )
                              );
                            }}
                          />
                        </div>
                      )}

                      {/* Threshold for coverage alerts */}
                      {rule.alertType === 'COVERAGE_GAP' && (
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <Label className="text-sm text-gray-600">Coverage Threshold:</Label>
                          <Input
                            type="number"
                            value={rule.threshold || 80}
                            className="w-20"
                            min={50}
                            max={100}
                            onChange={(e) => {
                              setRules((prev) =>
                                prev.map((r) =>
                                  r.id === rule.id
                                    ? { ...r, threshold: parseInt(e.target.value) }
                                    : r
                                )
                              );
                            }}
                          />
                          <span className="text-sm text-gray-500">%</span>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
