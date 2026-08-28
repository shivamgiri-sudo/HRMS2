import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Drill-down for one Attendance Control Tower gap row.
 *
 * A gap is derived from several feeds rather than stored, so this reads the full
 * evidence for the employee-day from a dedicated endpoint instead of reusing the
 * list payload — the whole point is to answer "why is this a gap" from source.
 */

interface GapDetail {
  key: string;
  employeeId: string;
  issueDate: string;
  window: { from: string; to: string };
  employee: Record<string, unknown> | null;
  attendanceRecords: Record<string, unknown>[];
  biometricDaily: Record<string, unknown>[];
  biometricPunches: Record<string, unknown>[];
  aprRecords: Record<string, unknown>[];
  regularizations: Record<string, unknown>[];
  leaveRequests: Record<string, unknown>[];
  rosterAssignments: Record<string, unknown>[];
  reviewHistory: Record<string, unknown>[];
  auditTrail: Record<string, unknown>[];
}

/** DD/MM/YYYY HH:mm, per the platform date rule. */
function fmtDateTime(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Date-only values arrive as plain 'YYYY-MM-DD' strings from the API and are
 * reformatted textually. Passing them through `new Date()` would shift them a
 * day backwards on this host's timezone.
 */
function fmtDate(value: unknown) {
  if (!value) return "—";
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function label(key: string) {
  return key.replace(/_/g, " ");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Empty sections stay visible and say "None" — never hidden. */
function RowTable({ rows, dateKeys = [] }: { rows: Record<string, unknown>[]; dateKeys?: string[] }) {
  if (!rows?.length) {
    return <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">None</p>;
  }
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold capitalize text-slate-500">
                {label(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-2 py-1.5 text-slate-700">
                  {r[c] === null || r[c] === undefined || r[c] === ""
                    ? "—"
                    : dateKeys.includes(c)
                      ? fmtDate(r[c])
                      : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttendanceGapDetailDrawer({
  gapKey,
  onClose,
}: {
  gapKey: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance-gap-detail", gapKey],
    enabled: Boolean(gapKey),
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: GapDetail }>(
        `/api/payroll/attendance-control-tower/gap/${encodeURIComponent(gapKey as string)}`,
      );
      return res.data;
    },
  });

  const emp = data?.employee as Record<string, unknown> | null | undefined;

  return (
    <Sheet open={Boolean(gapKey)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex h-full w-full max-w-2xl flex-col overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b border-slate-200 pb-3">
          <SheetTitle className="text-base font-bold text-slate-900">
            {String(emp?.employee_name ?? emp?.employee_code ?? "Attendance gap")}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="outline" className="text-[11px]">{String(emp?.employee_code ?? "—")}</Badge>
            <Badge variant="outline" className="text-[11px]">{fmtDate(data?.issueDate)}</Badge>
            {emp ? (
              <Badge
                variant="outline"
                className={`text-[11px] ${Number(emp.active_status) === 1
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-100 text-slate-600"}`}
              >
                {Number(emp.active_status) === 1 ? "Active" : "Inactive"}
              </Badge>
            ) : null}
          </div>
          <p className="pt-1 text-left font-mono text-[10px] text-slate-400">{gapKey}</p>
        </SheetHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading gap detail…
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Could not load the detail for this gap.
          </div>
        )}

        {data && !isLoading && (
          <div className="pb-10">
            <Section title="Employee">
              {emp ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-slate-200 p-3 text-xs">
                  {[
                    ["Branch", emp.branch_name],
                    ["Process", emp.process_name],
                    ["Department", emp.dept_name],
                    ["Designation", emp.designation_name],
                    ["Biometric code", emp.biometric_code],
                    ["Joined", fmtDate(emp.date_of_joining)],
                    ["Left", emp.date_of_leaving ? fmtDate(emp.date_of_leaving) : "—"],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt className="text-slate-400">{k}</dt>
                      <dd className="font-medium text-slate-800">{v ? String(v) : "—"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">None</p>
              )}
            </Section>

            <Section title="Attendance daily record">
              <RowTable rows={data.attendanceRecords} dateKeys={["record_date"]} />
            </Section>
            <Section title="Biometric evidence (integration)">
              <RowTable rows={data.biometricDaily} dateKeys={["activity_date"]} />
            </Section>
            <Section title="Raw biometric punches">
              <RowTable rows={data.biometricPunches} dateKeys={["punch_date"]} />
            </Section>
            <Section title="APR dialler records">
              <RowTable rows={data.aprRecords} dateKeys={["report_date"]} />
            </Section>
            <Section title="Roster">
              <RowTable rows={data.rosterAssignments} dateKeys={["roster_date"]} />
            </Section>
            <Section title="Leave requests covering this day">
              <RowTable rows={data.leaveRequests} dateKeys={["from_date", "to_date"]} />
            </Section>
            <Section title="Regularizations">
              <RowTable rows={data.regularizations} dateKeys={["session_date"]} />
            </Section>

            <Section title="Review timeline">
              {data.reviewHistory?.length ? (
                <ol className="space-y-2">
                  {data.reviewHistory.map((r, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold capitalize text-slate-800">{label(String(r.status ?? "open"))}</span>
                        <span className="text-slate-400">{fmtDateTime(r.updated_at ?? r.created_at)}</span>
                      </div>
                      <p className="mt-0.5 text-slate-500">{label(String(r.issue_type ?? "—"))}</p>
                      {r.review_note ? <p className="mt-1 text-slate-600">{String(r.review_note)}</p> : null}
                      <p className="mt-0.5 text-slate-400">By: {r.reviewed_by ? String(r.reviewed_by) : "—"}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">None</p>
              )}
            </Section>

            <Section title="Audit trail">
              {data.auditTrail?.length ? (
                <ol className="space-y-1.5">
                  {data.auditTrail.map((a, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800">{label(String(a.action_type ?? "—"))}</span>
                        <span className="text-slate-400">{fmtDateTime(a.created_at)}</span>
                      </div>
                      <p className="mt-0.5 text-slate-400">Actor: {a.actor_user_id ? String(a.actor_user_id) : "—"}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">None</p>
              )}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default AttendanceGapDetailDrawer;
