import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTeamAttendanceDetail, type TeamAttendanceDetail } from "@/hooks/useTeamRoster";
import { ATTENDANCE_TOTAL_COLUMNS, attendanceCellClass, formatDmy, monthLabel, unpackError } from "./teamRosterFormat";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{children}</p>;
}

const codeLabel = (detail: TeamAttendanceDetail, code: string) => detail.legend.find((l) => l.code === code)?.label ?? (code ? code : "Blank");

export function AttendanceDrawerBody({ detail }: { detail: TeamAttendanceDetail }) {
  return (
    <div className="space-y-6">
      <section>
        <SectionLabel>Employee</SectionLabel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><dt className="text-xs text-slate-400">Name</dt><dd>{detail.employee.name}</dd></div>
          <div><dt className="text-xs text-slate-400">Employee code</dt><dd>{detail.employee.code ?? "None"}</dd></div>
          <div><dt className="text-xs text-slate-400">Designation</dt><dd>{detail.employee.designation ?? "None"}</dd></div>
          <div><dt className="text-xs text-slate-400">Process</dt><dd>{detail.employee.processName ?? "None"}</dd></div>
        </dl>
      </section>

      <section>
        <SectionLabel>Month totals - {monthLabel(detail.month)}</SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {ATTENDANCE_TOTAL_COLUMNS.map((c) => (
            <div key={c.key} className="rounded-lg border border-teal-100 bg-teal-50 px-2 py-1.5 text-center">
              <div className="text-base font-semibold text-teal-800">{detail.totals[c.key]}</div>
              <div className="text-[11px] text-teal-700">{c.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Day by day</SectionLabel>
        {detail.days.length === 0 ? <p className="text-sm text-slate-400">None</p> : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5">Day</th><th className="px-3 py-1.5">Status</th></tr></thead>
              <tbody>
                {detail.days.map((d) => (
                  <tr key={d.date} className="border-t">
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDmy(d.date)}</td>
                    <td className="px-3 py-1.5 text-slate-500">{d.weekday}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex h-5 min-w-[28px] items-center justify-center rounded px-1 text-xs ${attendanceCellClass(d.code)} ${d.regularized ? "ring-1 ring-inset ring-orange-500" : ""}`}>{d.code || "-"}</span>
                      <span className="ml-2 text-slate-600">{codeLabel(detail, d.code)}</span>
                      {d.regularized && <span className="ml-2 text-xs text-orange-700">Regularized</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionLabel>About these figures</SectionLabel>
        <ul className="list-disc space-y-1 pl-4 text-xs text-slate-500">
          {detail.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>
    </div>
  );
}

interface Props { employeeId: string | null; month: string; onClose: () => void }

/** Right-side slide-over (max-w-2xl) with one employee's month, fetched from the dedicated detail endpoint. */
export default function TeamAttendanceDrawer({ employeeId, month, onClose }: Props) {
  const q = useTeamAttendanceDetail(employeeId, month);
  const d = q.data;
  return (
    <Sheet open={employeeId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full max-w-2xl flex-col p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 pb-3 pt-5">
          <SheetTitle className="text-base">{d ? `${d.employee.name} - ${monthLabel(d.month)}` : "Attendance"}</SheetTitle>
          <p className="text-xs text-slate-500">Preview of the Attendance Register. The register remains the source of truth.</p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {q.isLoading && <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>}
          {q.isError && <p className="text-sm text-red-600">Could not load this employee. {unpackError(q.error).message}</p>}
          {d && <AttendanceDrawerBody detail={d} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
