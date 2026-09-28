import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { coverageLabel, formatDateTime, formatShortDate, STATUS_META } from "./trackerFormat";
import type { CellDetail, PersonRef } from "./trackerTypes";
import type { SelectedCell } from "./TrackerGrid";

const BASE = "/api/wfm/roster-upload-tracker";

const STAGE_LABEL: Record<string, string> = {
  reminder: "Friday reminder",
  heads_up: "Sunday heads-up",
  missing: "Marked missing",
  escalated: "Escalated (week started)",
  late_upload: "Uploaded-late notice",
  manual: "Manual reminder",
};

const ROLE_LABEL: Record<string, string> = { wfm: "Branch WFM", manager: "Process manager", skip_level: "Skip-level / branch head" };

const BATCH_STATUS_NOTE: Record<string, string> = {
  COMMITTED: "committed",
  PREVIEW: "waiting to be committed — does not count as uploaded",
  READY: "validated but not committed — does not count as uploaded",
  PARSING: "still parsing",
  VALIDATING: "still validating",
};

function SectionLabel({ children }: { children: string }) {
  return <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{children}</h3>;
}

function None({ text = "None" }: { text?: string }) {
  return <p className="text-sm text-slate-400">{text}</p>;
}

function People({ people, empty }: { people: PersonRef[]; empty: string }) {
  if (people.length === 0) return <p className="text-sm text-red-600">{empty}</p>;
  return <p className="text-sm text-slate-800">{people.map((p) => p.name).join(", ")}</p>;
}

interface TrackerCellDrawerProps {
  selected: SelectedCell | null;
  canRemind: boolean;
  onClose: () => void;
}

export function TrackerCellDrawer({ selected, canRemind, onClose }: TrackerCellDrawerProps) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["roster-upload-tracker-cell", selected],
    enabled: selected !== null,
    queryFn: () =>
      hrmsApi.get<CellDetail>(
        `${BASE}/cell?branchId=${selected!.branchId}&processId=${selected!.processId}&weekStart=${selected!.weekStart}`,
      ),
  });

  const remind = useMutation({
    mutationFn: () => hrmsApi.post<{ notified: string[] }>(`${BASE}/remind`, selected),
    onSuccess: (res) => {
      toast.success(`Reminder sent to ${res.notified.join(", ")}`);
      void qc.invalidateQueries({ queryKey: ["roster-upload-tracker-cell"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not send the reminder"),
  });

  const detail = query.data;
  const meta = detail ? STATUS_META[detail.cell.status] : null;
  const openUrl = selected ? `/wfm/roster-import?branchId=${selected.branchId}&processId=${selected.processId}` : "/wfm/roster-import";

  return (
    <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pr-10">
          <SheetTitle>
            {detail ? `${detail.branchName} · ${detail.processName}` : "Roster upload"}
          </SheetTitle>
          <SheetDescription>
            {selected ? `Week starting ${formatShortDate(selected.weekStart)}` : ""}
            {detail ? ` · deadline ${formatDateTime(detail.deadlineAtMs)}` : ""}
          </SheetDescription>
        </SheetHeader>

        {query.isLoading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}
        {query.isError && (
          <p className="mt-6 text-sm text-red-600">
            {query.error instanceof Error ? query.error.message : "Could not load this upload."}
          </p>
        )}

        {detail && meta && (
          <div className="mt-5 space-y-6">
            <section>
              <SectionLabel>Status</SectionLabel>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-sm font-semibold ${meta.pill}`}>
                  <span aria-hidden="true">{meta.glyph}</span>{meta.label}
                </span>
                <span className="font-mono text-sm text-slate-600">
                  {coverageLabel(detail.cell)} employees covered
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {canRemind && detail.cell.status !== "uploaded" && detail.cell.status !== "delayed" && (
                  <Button size="sm" disabled={remind.isPending} onClick={() => remind.mutate()}>
                    {remind.isPending ? "Sending…" : "Send reminder now"}
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild><a href={openUrl}>Open in Upload roster</a></Button>
              </div>
            </section>

            <section>
              <SectionLabel>Who gets notified</SectionLabel>
              <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2">
                <dt className="text-sm text-slate-500">Branch WFM</dt>
                <dd><People people={detail.wfm} empty="Not mapped — nobody will be alerted for this branch" /></dd>
                <dt className="text-sm text-slate-500">Process manager</dt>
                <dd><People people={detail.managers} empty="Not mapped" /></dd>
                <dt className="text-sm text-slate-500">Escalation (Mon 10:00)</dt>
                <dd><People people={detail.skipLevel} empty="No skip-level manager or branch head mapped" /></dd>
              </dl>
            </section>

            <section>
              <SectionLabel>Uploaded batches</SectionLabel>
              {detail.batches.length === 0 ? (
                <None text="No batch covers this week yet" />
              ) : (
                <ul className="space-y-2">
                  {detail.batches.map((b) => (
                    <li key={b.id} className="rounded-md border p-2.5 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-slate-900">
                          Batch #{b.id} · {b.scope === "branch" ? "whole-branch sheet" : "process sheet"}
                        </span>
                        <span className={b.status === "COMMITTED" ? "text-emerald-700" : "text-amber-700"}>
                          {BATCH_STATUS_NOTE[b.status] ?? b.status.toLowerCase()}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {b.fileName ?? "unnamed file"} · {b.totalRows} rows · by {b.uploadedBy ?? "system"} ·
                        {" "}uploaded {formatDateTime(b.createdAtMs)}
                        {b.committedAtMs ? ` · committed ${formatDateTime(b.committedAtMs)}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <SectionLabel>Employees without a committed roster</SectionLabel>
              {detail.uncoveredTotal === 0 ? (
                <None text="Everyone is covered" />
              ) : (
                <>
                  <p className="mb-1.5 text-xs text-slate-500">
                    {detail.uncoveredTotal} of {detail.cell.expected}
                    {detail.uncoveredEmployees.length < detail.uncoveredTotal ? ` (showing first ${detail.uncoveredEmployees.length})` : ""}
                  </p>
                  <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-sm">
                    {detail.uncoveredEmployees.map((e) => (
                      <li key={e.id} className="flex justify-between gap-3 px-2.5 py-1.5">
                        <span className="text-slate-900">{e.name}</span>
                        <span className="font-mono text-xs text-slate-500">{e.code}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section>
              <SectionLabel>Notification trail</SectionLabel>
              {detail.trail.length === 0 ? (
                <None text="No alerts sent yet" />
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {detail.trail.map((t, i) => (
                    <li key={i} className="grid grid-cols-[130px_1fr] gap-2 text-slate-600">
                      <time className="font-mono text-xs text-slate-400">{formatDateTime(t.sentAtMs)}</time>
                      <span>
                        {STAGE_LABEL[t.stage] ?? t.stage} → {t.recipientName ?? "unknown user"} ({ROLE_LABEL[t.recipientRole] ?? t.recipientRole})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
