import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO, isSameDay, addDays, startOfDay } from "date-fns";
import { normalizeDate } from "@/lib/utils";

interface Holiday {
  id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  event_type: string;
}

export function UpcomingHolidays() {
  const today = startOfDay(new Date());
  const next30Days = format(addDays(today, 30), "yyyy-MM-dd");
  const todayStr = format(today, "yyyy-MM-dd");

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["upcoming-holidays", todayStr],
    queryFn: async () => {
      try {
        const res = await hrmsApi.get<{ data: any[] }>(
          `/api/org/events?is_holiday=true&start=${todayStr}&end=${next30Days}`
        );
        return ((res.data ?? []) as Holiday[]).slice(0, 5);
      } catch {
        return [] as Holiday[];
      }
    },
  });

  const formatHolidayDate = (dateStr: string) => {
    const date = parseISO(normalizeDate(dateStr));
    if (isSameDay(date, today)) return "Today";
    if (isSameDay(date, addDays(today, 1))) return "Tomorrow";
    return format(date, "EEE, MMM d");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          Upcoming Holidays
          {holidays.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {holidays.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : holidays.length > 0 ? (
          <div className="space-y-3">
            {holidays.map((holiday) => (
              <div
                key={holiday.id}
                className="flex items-center gap-3 rounded-lg bg-muted/50 p-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  <CalendarDays className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{holiday.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatHolidayDate(holiday.event_date)}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0 border-green-500/50 text-green-600">
                  Holiday
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No upcoming holidays
          </p>
        )}
      </CardContent>
    </Card>
  );
}
