import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Cake, Award, PartyPopper } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO, addDays, isSameDay, differenceInYears } from "date-fns";

interface Celebration {
  id: string;
  employeeName: string;
  avatarUrl?: string;
  type: "birthday" | "anniversary";
  date: Date;
  years?: number; // For anniversaries
}

export function UpcomingCelebrations() {
  const today = new Date();
  const next14Days = addDays(today, 14);

  const { data: celebrations = [], isLoading } = useQuery({
    queryKey: ["upcoming-celebrations"],
    queryFn: async () => {
      const empRes = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      const employees = empRes.data ?? [];
      if (!employees) return [];

      const upcomingCelebrations: Celebration[] = [];
      const currentYear = today.getFullYear();

      employees.forEach((emp) => {
        // Check birthday
        if (emp.date_of_birth) {
          const dobStr = /^\d{4}-\d{2}-\d{2}$/.test(emp.date_of_birth) ? `${emp.date_of_birth}T00:00:00` : emp.date_of_birth;
          const dob = parseISO(dobStr);
          const birthdayThisYear = new Date(currentYear, dob.getMonth(), dob.getDate());
          
          // If birthday already passed this year, check next year
          if (birthdayThisYear < today) {
            birthdayThisYear.setFullYear(currentYear + 1);
          }
          
          if (birthdayThisYear <= next14Days) {
            upcomingCelebrations.push({
              id: `${emp.id}-birthday`,
              employeeName: `${emp.first_name} ${emp.last_name}`,
              avatarUrl: emp.avatar_url || undefined,
              type: "birthday",
              date: birthdayThisYear,
            });
          }
        }

        // Check work anniversary
        const joiningDate = emp.date_of_joining ?? emp.hire_date;
        if (joiningDate) {
          const hireDateStr = /^\d{4}-\d{2}-\d{2}$/.test(joiningDate) ? `${joiningDate}T00:00:00` : joiningDate;
          const hireDate = parseISO(hireDateStr);
          const anniversaryThisYear = new Date(currentYear, hireDate.getMonth(), hireDate.getDate());
          
          // If anniversary already passed this year, check next year
          if (anniversaryThisYear < today) {
            anniversaryThisYear.setFullYear(currentYear + 1);
          }
          
          if (anniversaryThisYear <= next14Days) {
            const years = differenceInYears(anniversaryThisYear, hireDate);
            if (years > 0) { // Only show if at least 1 year
              upcomingCelebrations.push({
                id: `${emp.id}-anniversary`,
                employeeName: `${emp.first_name} ${emp.last_name}`,
                avatarUrl: emp.avatar_url || undefined,
                type: "anniversary",
                date: anniversaryThisYear,
                years,
              });
            }
          }
        }
      });

      // Sort by date
      return upcomingCelebrations.sort((a, b) => a.date.getTime() - b.date.getTime());
    },
  });

  const formatCelebrationDate = (date: Date) => {
    if (isSameDay(date, today)) return "Today";
    if (isSameDay(date, addDays(today, 1))) return "Tomorrow";
    return format(date, "EEE, MMM d");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PartyPopper className="h-5 w-5 text-primary" />
          Upcoming Celebrations
          {celebrations.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {celebrations.length}
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
        ) : celebrations.length > 0 ? (
          <div className="space-y-3">
            {celebrations.slice(0, 5).map((celebration) => (
              <div
                key={celebration.id}
                className="flex items-center gap-3 rounded-lg bg-muted/50 p-2"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={normalizeMediaUrl(celebration.avatarUrl)} />
                  <AvatarFallback className="text-xs">
                    {celebration.employeeName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{celebration.employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCelebrationDate(celebration.date)}
                  </p>
                </div>
                <Badge 
                  variant="outline" 
                  className={`text-xs shrink-0 gap-1 ${
                    celebration.type === "birthday" 
                      ? "border-pink-500/50 text-pink-600" 
                      : "border-amber-500/50 text-amber-600"
                  }`}
                >
                  {celebration.type === "birthday" ? (
                    <>
                      <Cake className="h-3 w-3" />
                      Birthday
                    </>
                  ) : (
                    <>
                      <Award className="h-3 w-3" />
                      {celebration.years}yr
                    </>
                  )}
                </Badge>
              </div>
            ))}
            {celebrations.length > 5 && (
              <p className="text-xs text-muted-foreground text-center">
                +{celebrations.length - 5} more this month
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No upcoming celebrations
          </p>
        )}
      </CardContent>
    </Card>
  );
}
