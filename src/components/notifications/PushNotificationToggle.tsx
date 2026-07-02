import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useToast } from "@/hooks/use-toast";

export function PushNotificationToggle() {
  const { isSupported, isSubscribed, permission, isLoading, subscribe, unsubscribe } = usePushNotifications();
  const { toast } = useToast();

  if (!isSupported) return null;

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
      toast({ title: "Push notifications disabled", description: "You won't receive push notifications anymore." });
    } else {
      const success = await subscribe();
      if (success) {
        toast({ title: "Push notifications enabled!", description: "You'll now receive alerts for leave approvals and other HR updates." });
      } else if (permission === "denied") {
        toast({
          title: "Notifications blocked",
          description: "Please enable notifications in your browser settings.",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5" />
          Push Notifications
        </CardTitle>
        <CardDescription>
          Get instant alerts on your device for leave approvals, new requests, and attendance reminders
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {isSubscribed ? "Notifications are enabled" : "Notifications are disabled"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isSubscribed
                ? "You'll receive push alerts even when the app is closed"
                : "Enable to get real-time HR alerts on your device"}
            </p>
          </div>
          <Button
            variant={isSubscribed ? "outline" : "default"}
            size="sm"
            onClick={handleToggle}
            disabled={isLoading}
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isSubscribed ? (
              <BellOff className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            {isSubscribed ? "Disable" : "Enable"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
