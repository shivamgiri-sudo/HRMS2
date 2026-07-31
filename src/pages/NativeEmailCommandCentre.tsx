/**
 * Email Command Centre.
 *
 * The signature element is the Recipients tab: it resolves a real event against a real
 * employee and shows exactly who would be addressed — AND who was dropped, with the
 * reason. Everything else here is a table. That one screen is what stops a payslip
 * reaching a manager, so it gets the visual weight.
 *
 * Deliberately NOT shown: open rate and click rate. Nothing tracks either. The previous
 * dispatch_log open_rate was computed from a status nothing ever set and rendered a
 * permanent hard 0 as a percentage; showing a metric you do not measure is worse than
 * showing none (CLAUDE.md rule 10).
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsModernShell, HrmsBentoTile } from "@/components/ui/hrms-modern";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Mail, ShieldAlert, Radar, Send, Users, AlertTriangle, CheckCircle2,
  CircleSlash, Eye, CalendarClock, Lock,
} from "lucide-react";
import { toast } from "sonner";

// ── types ────────────────────────────────────────────────────────────────────
type DispatchMode = "shadow" | "live" | "off";

interface CatalogueEvent {
  event_code: string; module: string; display_name: string; description: string | null;
  enabled: number; dispatch_mode: DispatchMode; channels: string;
  is_critical: number; sensitivity: "int" | "conf" | "fin";
  recipient_spec: unknown; cooldown_minutes: number; max_per_day: number;
  template_key: string | null;
  activity: { shadow: number; live: number; lastAt: string | null };
}
interface ResolvedPerson {
  name: string; email: string; employeeCode: string | null;
  via: string; source: string; audience: "internal" | "client" | "external";
}
interface DropRow { selector: string; reason: string; detail?: string }
interface RecipientPreview {
  resolved: boolean; sensitivity: string; code?: string; message?: string;
  to: ResolvedPerson[]; cc: ResolvedPerson[]; bcc: ResolvedPerson[];
  dropped: DropRow[]; truncated?: boolean;
}
interface Claim {
  id: string; event_code: string; dedupe_key: string; mode: string; status: string;
  recipient_count: number; cc_count: number; dropped_count: number;
  entity_type: string | null; entity_id: string | null; error_message: string | null;
  claimed_at: string;
}
interface Subscription {
  id: string; subscription_name: string; report_code: string; frequency: string;
  is_active: number; dispatch_mode: string; next_run_at: string | null;
  last_status: string | null; consecutive_failures: number; run_count: number;
}

// ── small presentational helpers ─────────────────────────────────────────────
const SENSITIVITY: Record<string, { label: string; className: string; hint: string }> = {
  int:  { label: "Internal",  className: "bg-slate-100 text-slate-700 border-slate-200", hint: "Standard internal notification" },
  conf: { label: "Confidential", className: "bg-amber-50 text-amber-800 border-amber-200", hint: "Internal audience only — never a client recipient" },
  fin:  { label: "Financial",  className: "bg-rose-50 text-rose-700 border-rose-200", hint: "Official email only, and may never copy anyone" },
};

function ModeBadge({ enabled, mode }: { enabled: number; mode: DispatchMode }) {
  if (!enabled || mode === "off")
    return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">Off</Badge>;
  if (mode === "live")
    return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Live</Badge>;
  return <Badge className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50">Shadow</Badge>;
}

/** Human sentence for a resolver drop code. A raw enum in the UI helps nobody. */
function explainDrop(reason: string): string {
  switch (reason) {
    case "no_match": return "Nobody matched this selector";
    case "inactive_employee": return "Employee is inactive";
    case "no_email": return "No email address on record";
    case "no_official_email": return "No official company email — required for financial mail";
    case "invalid_domain": return "Address is not on a company domain";
    case "duplicate": return "Already addressed in a higher bucket";
    case "self_edge": return "Would have copied the person the message is about";
    case "cap_exceeded": return "Beyond the recipient cap";
    case "condition_not_met": return "Conditional recipient — condition was false";
    case "client_audience": return "Client-portal user — blocked";
    default: return reason;
  }
}

export default function NativeEmailCommandCentre() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("catalogue");
  const [moduleFilter, setModuleFilter] = useState<string>("all");

  const { data: catalogue, isLoading: loadingCatalogue } = useQuery({
    queryKey: ["notif-catalogue"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: CatalogueEvent[] }>("/api/notification-admin/catalogue"),
  });
  const events = catalogue?.data ?? [];

  const toggleMode = useMutation({
    mutationFn: (v: { eventCode: string; enabled: boolean; mode: DispatchMode }) =>
      hrmsApi.patch(`/api/notification-admin/catalogue/${v.eventCode}`, { enabled: v.enabled, dispatch_mode: v.mode }),
    onSuccess: (_d, v) => {
      toast.success(v.mode === "live" ? `${v.eventCode} is now sending` : `${v.eventCode} set to ${v.mode}`);
      void qc.invalidateQueries({ queryKey: ["notif-catalogue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const modules = useMemo(
    () => ["all", ...Array.from(new Set(events.map((e) => e.module))).sort()],
    [events],
  );
  const shown = moduleFilter === "all" ? events : events.filter((e) => e.module === moduleFilter);

  const stats = useMemo(() => {
    const live = events.filter((e) => e.enabled && e.dispatch_mode === "live").length;
    const shadow = events.filter((e) => e.enabled && e.dispatch_mode === "shadow").length;
    const fin = events.filter((e) => e.sensitivity === "fin").length;
    const claims30d = events.reduce((n, e) => n + e.activity.shadow + e.activity.live, 0);
    return { total: events.length, live, shadow, fin, claims30d };
  }, [events]);

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="Communication"
        title="Email Command Centre"
        description="Every notification the platform can send — who receives it, what it carries, and whether it is switched on."
        icon={<Mail className="h-6 w-6 text-white" />}
        actions={
          <Button variant="outline" onClick={() => void qc.invalidateQueries()} className="cursor-pointer">
            Refresh
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-4">
          <HrmsBentoTile title="Registered events" value={stats.total}
            detail={`${stats.fin} carry financial data`} icon={<Mail className="h-5 w-5" />} />
          <HrmsBentoTile title="Sending" value={stats.live}
            detail={stats.live === 0 ? "Nothing is live yet" : "Delivering to real inboxes"}
            icon={<Send className="h-5 w-5" />} accentClassName="from-emerald-500 to-teal-500" />
          <HrmsBentoTile title="In shadow" value={stats.shadow}
            detail="Resolving recipients, not delivering" icon={<Radar className="h-5 w-5" />}
            accentClassName="from-blue-500 to-cyan-500" />
          <HrmsBentoTile title="Claims (30d)" value={stats.claims30d}
            detail="Shadow runs count here too" icon={<CheckCircle2 className="h-5 w-5" />}
            accentClassName="from-violet-500 to-fuchsia-500" />
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList>
            <TabsTrigger value="catalogue" className="cursor-pointer">Catalogue</TabsTrigger>
            <TabsTrigger value="recipients" className="cursor-pointer">Recipients</TabsTrigger>
            <TabsTrigger value="activity" className="cursor-pointer">Activity</TabsTrigger>
            <TabsTrigger value="subscriptions" className="cursor-pointer">Scheduled reports</TabsTrigger>
          </TabsList>

          {/* ── Catalogue ─────────────────────────────────────────────────── */}
          <TabsContent value="catalogue" className="mt-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                <div>
                  <CardTitle>Event catalogue</CardTitle>
                  <CardDescription>
                    Events ship in shadow: recipients are resolved and recorded, nothing is delivered.
                    Review the Activity tab before switching one to Live.
                  </CardDescription>
                </div>
                <Select value={moduleFilter} onValueChange={setModuleFilter}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {modules.map((m) => <SelectItem key={m} value={m}>{m === "all" ? "All modules" : m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {loadingCatalogue ? (
                  <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : shown.length === 0 ? (
                  <EmptyCatalogue />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Event</TableHead>
                          <TableHead>Module</TableHead>
                          <TableHead>Sensitivity</TableHead>
                          <TableHead className="text-right">Claims 30d</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead className="text-right">Switch</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((e) => {
                          const s = SENSITIVITY[e.sensitivity] ?? SENSITIVITY.int;
                          return (
                            <TableRow key={e.event_code}>
                              <TableCell>
                                <div className="font-semibold text-slate-900">{e.display_name}</div>
                                <div className="font-mono text-xs text-slate-500">{e.event_code}</div>
                              </TableCell>
                              <TableCell className="text-slate-600">{e.module}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={s.className} title={s.hint}>{s.label}</Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-slate-600">
                                {e.activity.shadow + e.activity.live}
                              </TableCell>
                              <TableCell><ModeBadge enabled={e.enabled} mode={e.dispatch_mode} /></TableCell>
                              <TableCell className="text-right">
                                <div className="inline-flex gap-1">
                                  <Button size="sm" variant="ghost" className="cursor-pointer"
                                    disabled={toggleMode.isPending}
                                    onClick={() => toggleMode.mutate({ eventCode: e.event_code, enabled: false, mode: "off" })}>
                                    Off
                                  </Button>
                                  <Button size="sm" variant="ghost" className="cursor-pointer"
                                    disabled={toggleMode.isPending}
                                    onClick={() => toggleMode.mutate({ eventCode: e.event_code, enabled: true, mode: "shadow" })}>
                                    Shadow
                                  </Button>
                                  <Button size="sm" variant="outline" className="cursor-pointer"
                                    disabled={toggleMode.isPending}
                                    onClick={() => toggleMode.mutate({ eventCode: e.event_code, enabled: true, mode: "live" })}>
                                    Live
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Recipients — the signature screen ─────────────────────────── */}
          <TabsContent value="recipients" className="mt-4">
            <RecipientsTab events={events} />
          </TabsContent>

          {/* ── Activity ─────────────────────────────────────────────────── */}
          <TabsContent value="activity" className="mt-4"><ActivityTab /></TabsContent>

          {/* ── Subscriptions ────────────────────────────────────────────── */}
          <TabsContent value="subscriptions" className="mt-4"><SubscriptionsTab /></TabsContent>
        </Tabs>
      </HrmsModernShell>
    </DashboardLayout>
  );
}

function EmptyCatalogue() {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <Mail className="h-8 w-8 text-slate-300" aria-hidden="true" />
      <p className="font-semibold text-slate-900">No events registered yet</p>
      <p className="max-w-md text-sm text-slate-500">
        Apply migration <span className="font-mono">1022_notification_event_registry.sql</span> to
        register the catalogue. Events arrive switched off, so nothing sends on deploy.
      </p>
    </div>
  );
}

// ── Recipients tab ───────────────────────────────────────────────────────────
function RecipientsTab({ events }: { events: CatalogueEvent[] }) {
  const [eventCode, setEventCode] = useState<string>("");
  const [employeeId, setEmployeeId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [preview, setPreview] = useState<RecipientPreview | null>(null);

  const run = useMutation({
    mutationFn: () =>
      hrmsApi.post<{ success: boolean; data: RecipientPreview }>("/api/notification-admin/recipients/preview", {
        event_code: eventCode,
        employee_id: employeeId.trim() || undefined,
        branch_id: branchId.trim() || undefined,
      }),
    onSuccess: (res) => setPreview(res.data),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" />Resolve recipients</CardTitle>
          <CardDescription>
            Run a real event against a real employee and see who would be addressed — and who
            would be dropped, and why.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ev">Event</Label>
            <Select value={eventCode} onValueChange={setEventCode}>
              <SelectTrigger id="ev"><SelectValue placeholder="Choose an event" /></SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.event_code} value={e.event_code}>{e.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp">Employee ID</Label>
            <Input id="emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="UUID of the employee the event is about" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br">Branch ID <span className="text-slate-400">(optional)</span></Label>
            <Input id="br" value={branchId} onChange={(e) => setBranchId(e.target.value)}
              placeholder="For branch-scoped recipients" className="font-mono text-xs" />
          </div>
          <Button className="w-full cursor-pointer" disabled={!eventCode || run.isPending}
            onClick={() => run.mutate()}>
            <Eye className="mr-2 h-4 w-4" />{run.isPending ? "Resolving…" : "Resolve"}
          </Button>
          <p className="text-xs leading-relaxed text-slate-500">
            Addresses are masked. This answers whether the right people would be reached, not
            what anyone's address is.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
          <CardDescription>Nothing is sent by resolving.</CardDescription>
        </CardHeader>
        <CardContent>
          {!preview ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Users className="h-8 w-8 text-slate-300" aria-hidden="true" />
              <p className="text-sm text-slate-500">Choose an event and resolve to see its recipients.</p>
            </div>
          ) : !preview.resolved ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-rose-900">
                    {preview.code === "CLIENT_AUDIENCE" ? "Blocked — client recipient"
                      : preview.code === "FIN_HAS_CC" ? "Blocked — financial mail cannot be copied"
                      : "Nobody could be reached"}
                  </p>
                  <p className="mt-1 text-sm text-rose-800">{preview.message}</p>
                </div>
              </div>
              <DroppedList dropped={preview.dropped} />
            </div>
          ) : (
            <div className="space-y-5">
              <Bucket label="To" people={preview.to} tone="text-slate-900" />
              <Bucket label="Cc" people={preview.cc} tone="text-slate-700" />
              {preview.bcc.length > 0 && <Bucket label="Bcc" people={preview.bcc} tone="text-slate-700" />}
              <DroppedList dropped={preview.dropped} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Bucket({ label, people, tone }: { label: string; people: ResolvedPerson[]; tone: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{people.length}</span>
      </div>
      {people.length === 0 ? (
        <p className="text-sm italic text-slate-400">Nobody</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {people.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <span className={`text-sm font-semibold ${tone}`}>{p.name}</span>
                {p.employeeCode && <span className="ml-2 font-mono text-xs text-slate-400">{p.employeeCode}</span>}
                <div className="font-mono text-xs text-slate-500">{p.email}</div>
              </div>
              <div className="flex items-center gap-2">
                {p.audience !== "internal" && (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{p.audience}</Badge>
                )}
                <span className="font-mono text-[11px] text-slate-400" title="Which selector produced this recipient">
                  {p.via}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DroppedList({ dropped }: { dropped: DropRow[] }) {
  if (!dropped?.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Dropped ({dropped.length})
        </span>
      </div>
      <ul className="space-y-1">
        {dropped.map((d, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
            <span className="font-mono text-xs text-slate-500">{d.selector}</span>
            <span className="text-slate-700">{explainDrop(d.reason)}</span>
            {d.detail && <span className="font-mono text-xs text-slate-400">{d.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Activity tab ─────────────────────────────────────────────────────────────
function ActivityTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["notif-claims"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: Claim[] }>("/api/notification-admin/claims?limit=100"),
  });
  const claims = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dispatch activity</CardTitle>
        <CardDescription>
          Every decision the gateway made. Shadow rows are what <em>would</em> have been sent —
          review these before switching an event to Live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : claims.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Radar className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="font-semibold text-slate-900">No dispatch activity yet</p>
            <p className="max-w-md text-sm text-slate-500">
              Workers are disabled by default. Enable one in <span className="font-mono">worker_config</span> to
              start producing shadow runs.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead><TableHead>Event</TableHead><TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">To / Cc</TableHead>
                  <TableHead className="text-right">Dropped</TableHead><TableHead>Entity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {new Date(c.claimed_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.event_code}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={c.mode === "live"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-blue-200 bg-blue-50 text-blue-700"}>{c.mode}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={c.status === "failed" ? "font-semibold text-rose-600" : "text-slate-700"}>
                        {c.status}
                      </span>
                      {c.error_message && (
                        <div className="max-w-xs truncate text-xs text-rose-500" title={c.error_message}>
                          {c.error_message}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.recipient_count} / {c.cc_count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.dropped_count > 0
                        ? <span className="font-semibold text-amber-600">{c.dropped_count}</span>
                        : <span className="text-slate-400">0</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{c.entity_type ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Subscriptions tab ────────────────────────────────────────────────────────
function SubscriptionsTab() {
  const { data: subsRes, isLoading } = useQuery({
    queryKey: ["notif-subscriptions"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: Subscription[] }>("/api/notification-admin/subscriptions"),
  });
  const { data: codesRes } = useQuery({
    queryKey: ["notif-report-codes"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: { subscribable: { code: string; name: string }[]; blockedReason: string } }>(
      "/api/notification-admin/report-codes"),
  });
  const subs = subsRes?.data ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50/60">
        <CardContent className="flex items-start gap-3 pt-6">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="font-semibold text-amber-900">Only six reports can be scheduled</p>
            <p className="mt-1 text-sm text-amber-800">
              {codesRes?.data?.blockedReason ??
                "Most catalogued reports have no builder yet, so scheduling one would email an empty spreadsheet."}
            </p>
            {codesRes?.data?.subscribable && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {codesRes.data.subscribable.map((c) => (
                  <Badge key={c.code} variant="outline" className="border-amber-300 bg-white text-amber-900">
                    {c.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />Scheduled reports</CardTitle>
          <CardDescription>Subscriptions reuse the existing report pipeline — generation, retry and audit included.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : subs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <CalendarClock className="h-8 w-8 text-slate-300" aria-hidden="true" />
              <p className="font-semibold text-slate-900">No subscriptions yet</p>
              <p className="max-w-md text-sm text-slate-500">
                Apply <span className="font-mono">1025_report_subscription.sql</span> to seed the
                seven catalogued subscriptions. They arrive inactive.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subscription</TableHead><TableHead>Report</TableHead>
                    <TableHead>Frequency</TableHead><TableHead>State</TableHead>
                    <TableHead>Next run</TableHead><TableHead>Last outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-semibold text-slate-900">{s.subscription_name}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">{s.report_code}</TableCell>
                      <TableCell className="capitalize text-slate-600">{s.frequency}</TableCell>
                      <TableCell>
                        {s.is_active
                          ? <ModeBadge enabled={1} mode={s.dispatch_mode as DispatchMode} />
                          : <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">Inactive</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {s.next_run_at ? new Date(s.next_run_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        {s.consecutive_failures > 0 ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                            <CircleSlash className="h-3.5 w-3.5" aria-hidden="true" />
                            {s.consecutive_failures} failed
                          </span>
                        ) : (
                          <span className="text-slate-500">{s.last_status ?? "never run"}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
