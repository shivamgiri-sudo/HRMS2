import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { PushNotificationToggle } from "@/components/notifications/PushNotificationToggle";
import { toast } from "sonner";
import { Bell, Calendar, FileCheck, Target, UserPlus, PartyPopper, Clock } from "lucide-react";

const NotificationPreferences = () => {
  const { data: preferences, isLoading } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();

  const handleToggle = async (key: string, value: boolean) => {
    try {
      await updatePreferences.mutateAsync({ [key]: value });
      toast.success("Preferences updated");
    } catch (error) {
      toast.error("Failed to update preferences");
    }
  };

  const notificationTypes = [
    {
      key: "event_notifications",
      label: "Company Events",
      description: "Get notified about upcoming company events and meetings",
      icon: Calendar,
    },
    {
      key: "holiday_notifications",
      label: "Holidays",
      description: "Receive reminders about upcoming holidays",
      icon: PartyPopper,
    },
    {
      key: "leave_status_notifications",
      label: "Leave Status Updates",
      description: "Get notified when your leave requests are approved or rejected",
      icon: FileCheck,
    },
    {
      key: "review_notifications",
      label: "Performance Reviews",
      description: "Receive notifications about performance review schedules and updates",
      icon: Bell,
    },
    {
      key: "goal_reminder_notifications",
      label: "Goal Reminders",
      description: "Get reminders about upcoming goal deadlines",
      icon: Target,
    },
    {
      key: "onboarding_notifications",
      label: "Onboarding Updates",
      description: "Receive notifications about onboarding tasks and progress",
      icon: UserPlus,
    },
    {
      key: "attendance_reminder_notifications",
      label: "Attendance Reminders",
      description: "Get reminders to clock in and clock out on working days",
      icon: Clock,
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notification Preferences</h1>
          <p className="text-muted-foreground">
            Choose which notifications you want to receive via email
          </p>
        </div>

        <PushNotificationToggle />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Email Notifications
            </CardTitle>
            <CardDescription>
              Manage your email notification settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                  <Skeleton className="h-6 w-11" />
                </div>
              ))
            ) : (
              notificationTypes.map((type) => {
                const Icon = type.icon;
                const isEnabled = preferences?.[type.key as keyof typeof preferences] as boolean;
                
                return (
                  <div
                    key={type.key}
                    className="flex items-center justify-between py-3 border-b last:border-0"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="h-5 w-5 mt-0.5 text-muted-foreground" />
                      <div className="space-y-0.5">
                        <Label htmlFor={type.key} className="text-base font-medium cursor-pointer">
                          {type.label}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          {type.description}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id={type.key}
                      checked={isEnabled}
                      onCheckedChange={(checked) => handleToggle(type.key, checked)}
                      disabled={updatePreferences.isPending}
                    />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default NotificationPreferences;
