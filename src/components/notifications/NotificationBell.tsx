import { Bell, Check, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  useNotifications, 
  useUnreadNotificationsCount, 
  useMarkNotificationRead,
  useMarkAllNotificationsRead 
} from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { resolveNotificationIcon, type NotificationTone } from "@/lib/notification-icons";

export const NotificationBell = () => {
  const navigate = useNavigate();
  const { data: notifications = [], isLoading } = useNotifications();
  const { data: unreadCount = 0 } = useUnreadNotificationsCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const handleNotificationClick = (notification: typeof notifications[0]) => {
    if (!notification.read) {
      markRead.mutate(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
  };

  // Keyed on the semantic tone resolveNotificationIcon derives from the real `type` value, not
  // on the literal strings "warning"/"error"/"success" the old switch matched against — nothing
  // this platform actually produces uses those three words as a type, so every notification fell
  // to the same default blue border. See notification-icons.tsx for the full type -> icon/tone map.
  const TONE_STYLES: Record<NotificationTone, string> = {
    warning: "border-l-4 border-l-orange-500 bg-orange-50 dark:bg-orange-950/20",
    danger: "border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/20",
    success: "border-l-4 border-l-green-500 bg-green-50 dark:bg-green-950/20",
    info: "border-l-4 border-l-blue-500 bg-blue-50 dark:bg-blue-950/20",
  };
  const TONE_ICON_COLOR: Record<NotificationTone, string> = {
    warning: "text-orange-600",
    danger: "text-red-600",
    success: "text-green-600",
    info: "text-blue-600",
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-4 border-b">
          <h4 className="font-semibold">Notifications</h4>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-xs h-7"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-80">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              No notifications
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => {
                const { icon: TypeIcon, tone } = resolveNotificationIcon(notification.type);
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "p-3 cursor-pointer hover:bg-muted/50 transition-colors",
                      TONE_STYLES[tone],
                      !notification.read && "font-medium"
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <TypeIcon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", TONE_ICON_COLOR[tone])} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{notification.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      {!notification.read && (
                        <div className="h-2 w-2 bg-primary rounded-full flex-shrink-0 mt-1" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            className="w-full justify-center text-sm font-semibold"
            onClick={() => navigate("/notifications")}
          >
            View all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
