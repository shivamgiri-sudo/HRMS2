import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Search, Loader2, ExternalLink, CheckCircle2, AlertTriangle, Bot, Clock,
} from "lucide-react";

/**
 * ESIC Registration Bot — status monitor + approve tab.
 *
 * Backend of record: the actual registration run (Aadhaar/bank/OTP handling) happens in a
 * supervised Google Sheets queue + Playwright workstation OUTSIDE HRMS — see migration
 * 1761_esic_registration_automation.sql's own header. esic_registration_case /
 * esic_registration_event are additive, non-sensitive lifecycle/status tracking tables only;
 * this tab reads and reviews them, it does not run or re-implement the bot.
 *
 * Rebuilt 2026-09-14 after this file was accidentally truncated to empty on the shared
 * working tree (an unrelated `git show` redirect wrote to it after the source command had
 * already failed) — it was never committed anywhere, so there was no git history to restore
 * from. Reconstructed from the real esic_registration_case/esic_registration_event schema
 * (migration 1761) and the 3 API calls + line numbers the route-contract test still expected
 * (GET .../cases, GET .../cases/:id, POST .../cases/:id/approve) — not from the original
 * file's actual UI, which is genuinely gone. Status/readiness values below are inferred from
 * the column defaults and domain, not read from the bot's own source (it lives outside this
 * repo) — treat them as a reasonable placeholder set, not a verified enum, until the backend
 * (currently still a bare stub, esic-automation.routes.ts) is implemented against them.
 *
 * Not yet wired into any parent page — no other file imports this component, on the original
 * tree either (confirmed via a repo-wide search before rebuilding). Sits alongside
 * EsiRegDocsTab.tsx (a different, already-wired ESI feature: document readiness, not
 * registration-bot status) for whoever integrates it next.
 */

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "QUEUED", label: "Queued" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "NEEDS_REVIEW", label: "Needs Review" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "APPROVED", label: "Approved" },
] as const;

interface CaseRow {
  id: string;
  registration_id: string;
  employee_id: string | null;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  readiness: string;
  status: string;
  current_step: string | null;
  esic_ip_number: string | null;
  acknowledgement_url: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  attempt_count: number;
  approved_by: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Timeline {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_type: string;
  actor_id: string | null;
  detail_json: Record<string, unknown> | null;
  created_at: string;
}

interface CaseListResponse {
  cases: CaseRow[];
  total: number;
}

interface CaseDetailResponse {
  case: CaseRow;
  timeline: Timeline[];
}

function formatDateTime(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "COMPLETED":
    case "APPROVED":
      return "bg-green-100 text-green-800 border-green-200";
    case "FAILED":
      return "bg-red-100 text-red-800 border-red-200";
    case "NEEDS_REVIEW":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "IN_PROGRESS":
      return "bg-blue-100 text-blue-800 border-blue-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export default function EsicRegistrationBotTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [selected, setSelected] = useState<CaseRow | null>(null);

  const list = useQuery<CaseListResponse>({
    queryKey: ["esic-automation", search, status],
    queryFn: () => {
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      if (status !== "ALL") q.set("status", status);
      return hrmsApi.get<CaseListResponse>(`/api/payroll/esic-automation/cases?${q}`);
    },
    staleTime: 30_000,
  });

  const detail = useQuery<CaseDetailResponse>({
    queryKey: ["esic-case", selected?.id],
    queryFn: () => hrmsApi.get<CaseDetailResponse>(`/api/payroll/esic-automation/cases/${selected!.id}`),
    enabled: !!selected,
  });

  const approve = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/payroll/esic-automation/cases/${id}/approve`, {}),
    onSuccess: async () => {
      toast({ title: "Case approved" });
      await qc.invalidateQueries({ queryKey: ["esic-automation"] });
      await qc.invalidateQueries({ queryKey: ["esic-case"] });
    },
    onError: (err: unknown) => {
      toast({ title: "Approval failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    },
  });

  const cases = list.data?.cases ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employee name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {/* Closed set (schema default + inferred lifecycle values) — dropdown, not free text. */}
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {list.data && (
          <span className="text-xs text-muted-foreground ml-auto">{list.data.total} case(s)</span>
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Employee</th>
              <th className="text-left px-3 py-2 font-medium">Branch</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Step</th>
              <th className="text-left px-3 py-2 font-medium">ESIC IP No.</th>
              <th className="text-left px-3 py-2 font-medium">Attempts</th>
              <th className="text-left px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
              </td></tr>
            )}
            {!list.isLoading && cases.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No cases found.</td></tr>
            )}
            {cases.map((c) => (
              <tr
                key={c.id}
                className="border-t cursor-pointer hover:bg-muted/40"
                onClick={() => setSelected(c)}
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{c.employee_name}</div>
                  <div className="text-xs text-muted-foreground">{c.employee_code}</div>
                </td>
                <td className="px-3 py-2">{c.branch_name ?? "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className={statusBadgeClass(c.status)}>{c.status}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.current_step ?? "—"}</td>
                <td className="px-3 py-2">{c.esic_ip_number ?? "—"}</td>
                <td className="px-3 py-2">{c.attempt_count}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(c.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drill-down: full record detail + audit trail, per the platform's drawer mandate. */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4" /> {selected?.employee_name}
              {selected && <Badge variant="outline" className={statusBadgeClass(selected.status)}>{selected.status}</Badge>}
            </SheetTitle>
            <SheetDescription>{selected?.registration_id}</SheetDescription>
          </SheetHeader>

          {detail.isLoading && (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
          )}

          {detail.data && (
            <div className="mt-4 space-y-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Case Detail</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-muted-foreground text-xs">Employee Code</div>{detail.data.case.employee_code}</div>
                  <div><div className="text-muted-foreground text-xs">Branch</div>{detail.data.case.branch_name ?? "—"}</div>
                  <div><div className="text-muted-foreground text-xs">Readiness</div>{detail.data.case.readiness}</div>
                  <div><div className="text-muted-foreground text-xs">Current Step</div>{detail.data.case.current_step ?? "—"}</div>
                  <div><div className="text-muted-foreground text-xs">ESIC IP Number</div>{detail.data.case.esic_ip_number ?? "—"}</div>
                  <div><div className="text-muted-foreground text-xs">Attempts</div>{detail.data.case.attempt_count}</div>
                  <div><div className="text-muted-foreground text-xs">Started</div>{formatDateTime(detail.data.case.started_at)}</div>
                  <div><div className="text-muted-foreground text-xs">Completed</div>{formatDateTime(detail.data.case.completed_at)}</div>
                  <div><div className="text-muted-foreground text-xs">Approved By</div>{detail.data.case.approved_by ?? "—"}</div>
                  <div><div className="text-muted-foreground text-xs">Approved At</div>{formatDateTime(detail.data.case.approved_at)}</div>
                </div>
              </div>

              {detail.data.case.last_error_message && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium">{detail.data.case.last_error_code ?? "Error"}</div>
                    <div>{detail.data.case.last_error_message}</div>
                  </div>
                </div>
              )}

              {detail.data.case.acknowledgement_url && (
                <a
                  href={detail.data.case.acknowledgement_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> View acknowledgement
                </a>
              )}

              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Audit Trail</div>
                {detail.data.timeline.length === 0 ? (
                  <div className="text-sm text-muted-foreground">None</div>
                ) : (
                  <div className="space-y-2">
                    {detail.data.timeline.map((ev) => (
                      <div key={ev.id} className="flex items-start gap-2 text-sm border-l-2 border-slate-200 pl-3">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <div>
                          <div className="font-medium">
                            {ev.event_type}
                            {ev.from_status && ev.to_status && (
                              <span className="text-muted-foreground font-normal"> — {ev.from_status} → {ev.to_status}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {ev.actor_type}{ev.actor_id ? ` (${ev.actor_id})` : ""} · {formatDateTime(ev.created_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {detail.data.case.status === "NEEDS_REVIEW" && (
                <Button
                  onClick={() => approve.mutate(detail.data!.case.id)}
                  disabled={approve.isPending}
                  className="w-full"
                >
                  {approve.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Approving…</>
                    : <><CheckCircle2 className="h-4 w-4 mr-2" />Approve</>}
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
