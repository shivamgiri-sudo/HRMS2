import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Briefcase,
  Calendar,
  MapPin,
  TrendingUp,
  Award,
  GraduationCap,
  Users,
  Building2,
  Star,
  Clock,
  CheckCircle2,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { normalizeDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JourneyEvent {
  id: string;
  event_type: string;
  event_date: string;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
  module: string | null;
  metadata: any;
  created_at: string;
}

interface PromotionRecord {
  id: string;
  employee_id: string;
  promotion_date: string;
  from_designation: string | null;
  to_designation: string | null;
  from_salary: number | null;
  to_salary: number | null;
  reason: string | null;
  approved_by: string | null;
  created_at: string;
}

interface TransferRecord {
  id: string;
  employee_id: string;
  transfer_date: string;
  from_department: string | null;
  to_department: string | null;
  from_location: string | null;
  to_location: string | null;
  reason: string | null;
  approved_by: string | null;
  created_at: string;
}

interface EmployeeProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  employee_code: string;
  avatar_url: string | null;
  designation: string | null;
  date_of_joining: string | null;
  employment_status: string;
  department_name: string | null;
}

// ─── Event Type Icons & Colors ───────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  hiring: { icon: Users, color: "bg-blue-100 text-blue-700", label: "Joined" },
  promotion: { icon: TrendingUp, color: "bg-emerald-100 text-emerald-700", label: "Promotion" },
  transfer: { icon: MapPin, color: "bg-purple-100 text-purple-700", label: "Transfer" },
  training: { icon: GraduationCap, color: "bg-amber-100 text-amber-700", label: "Training" },
  achievement: { icon: Award, color: "bg-yellow-100 text-yellow-700", label: "Achievement" },
  appraisal: { icon: Star, color: "bg-pink-100 text-pink-700", label: "Appraisal" },
  department_change: { icon: Building2, color: "bg-indigo-100 text-indigo-700", label: "Dept Change" },
  default: { icon: CheckCircle2, color: "bg-slate-100 text-slate-700", label: "Event" },
};

// ─── Timeline Item ────────────────────────────────────────────────────────────

interface TimelineItemProps {
  event: JourneyEvent | PromotionRecord | TransferRecord;
  type: "journey" | "promotion" | "transfer";
  isLast: boolean;
}

function TimelineItem({ event, type, isLast }: TimelineItemProps) {
  let eventType = "default";
  let title = "";
  let description = "";
  let date = "";

  if (type === "journey") {
    const e = event as JourneyEvent;
    eventType = e.event_type;
    title = e.event_type.replace(/_/g, " ").toUpperCase();
    description = e.description || `${e.old_value || "N/A"} → ${e.new_value || "N/A"}`;
    date = e.event_date;
  } else if (type === "promotion") {
    const p = event as PromotionRecord;
    eventType = "promotion";
    title = "PROMOTION";
    description = `${p.from_designation || "Previous Role"} → ${p.to_designation || "New Role"}`;
    if (p.from_salary && p.to_salary) {
      const increase = ((p.to_salary - p.from_salary) / p.from_salary * 100).toFixed(1);
      description += ` (+${increase}% salary)`;
    }
    date = p.promotion_date;
  } else if (type === "transfer") {
    const t = event as TransferRecord;
    eventType = "transfer";
    title = "TRANSFER";
    description = `${t.from_department || "Previous Dept"} → ${t.to_department || "New Dept"}`;
    if (t.from_location && t.to_location) {
      description += ` | ${t.from_location} → ${t.to_location}`;
    }
    date = t.transfer_date;
  }

  const config = EVENT_CONFIG[eventType] || EVENT_CONFIG.default;
  const Icon = config.icon;

  return (
    <div className="relative flex gap-6">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-6 top-12 h-full w-0.5 bg-gradient-to-b from-slate-300 to-transparent" />
      )}

      {/* Icon */}
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${config.color} shadow-sm`}>
        <Icon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          </div>
          <Badge variant="outline" className="flex-shrink-0 text-xs font-medium">
            <Calendar className="mr-1 h-3 w-3" />
            {format(parseISO(normalizeDate(date)), "MMM d, yyyy")}
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EmployeeJourney() {
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  // Fetch employee profile
  const { data: profile, isLoading: profileLoading } = useQuery<EmployeeProfile>({
    queryKey: ["employee-profile", user?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any }>(`/api/employees/by-user/${user?.id}`);
      return res.data;
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (profile?.id) setEmployeeId(profile.id);
  }, [profile]);

  // Fetch journey events
  const { data: journeyEvents = [], isLoading: journeyLoading } = useQuery<JourneyEvent[]>({
    queryKey: ["employee-journey"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/employees/me/journey`
      );
      return res.data ?? [];
    },
  });

  // Fetch promotions
  const { data: promotions = [], isLoading: promotionsLoading } = useQuery<PromotionRecord[]>({
    queryKey: ["employee-promotions"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/employees/me/promotions`
      );
      return res.data ?? [];
    },
  });

  // Fetch transfers
  const { data: transfers = [], isLoading: transfersLoading } = useQuery<TransferRecord[]>({
    queryKey: ["employee-transfers"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/employees/me/transfers`
      );
      return res.data ?? [];
    },
  });

  // Combine and sort all events
  const allEvents = [
    ...journeyEvents.map((e) => ({ ...e, type: "journey" as const, sortDate: e.event_date })),
    ...promotions.map((p) => ({ ...p, type: "promotion" as const, sortDate: p.promotion_date })),
    ...transfers.map((t) => ({ ...t, type: "transfer" as const, sortDate: t.transfer_date })),
  ].sort((a, b) => new Date(normalizeDate(b.sortDate)).getTime() - new Date(normalizeDate(a.sortDate)).getTime());

  const isLoading = profileLoading || journeyLoading || promotionsLoading || transfersLoading;

  if (profileLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!profile) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <p className="text-muted-foreground">Employee profile not found</p>
        </div>
      </DashboardLayout>
    );
  }

  const yearsOfService = profile.date_of_joining
    ? Math.floor((Date.now() - new Date(/^\d{4}-\d{2}-\d{2}$/.test(profile.date_of_joining) ? `${profile.date_of_joining}T00:00:00` : profile.date_of_joining).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Career</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">My Journey</h1>
          <p className="mt-2 text-slate-600">Track your professional growth and achievements</p>
        </div>

        {/* Profile Summary Card */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20 border-4 border-slate-100">
                  <AvatarImage src={profile.avatar_url || undefined} alt={profile.first_name} />
                  <AvatarFallback className="text-lg font-bold">
                    {profile.first_name[0]}{profile.last_name[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    {profile.first_name} {profile.last_name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">{profile.designation || "Employee"}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Briefcase className="h-3 w-3" />
                      {profile.employee_code}
                    </span>
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {profile.department_name || "N/A"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center">
                  <p className="text-3xl font-black text-slate-900">{yearsOfService}</p>
                  <p className="text-xs font-medium text-slate-500">Years</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-black text-emerald-600">{promotions.length}</p>
                  <p className="text-xs font-medium text-slate-500">Promotions</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-black text-purple-600">{transfers.length}</p>
                  <p className="text-xs font-medium text-slate-500">Transfers</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Career Timeline
            </CardTitle>
            <CardDescription>
              Your professional journey from day one to present
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : allEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="mb-4 h-12 w-12 text-muted-foreground opacity-50" />
                <p className="text-sm font-medium text-muted-foreground">
                  Your journey is just beginning!
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Events and milestones will appear here as you grow with the company
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {allEvents.map((event, idx) => (
                  <TimelineItem
                    key={`${event.type}-${event.id}`}
                    event={event}
                    type={event.type}
                    isLast={idx === allEvents.length - 1}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
