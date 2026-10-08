import { useMemo, useState } from 'react';
import { Info, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  type AttendanceLogic, type ProcessLogicRow, LOGIC_META, LOGIC_ORDER, formatChanged,
} from './types';

interface Props {
  rows: ProcessLogicRow[];
  loading: boolean;
  canEdit: boolean;
  savingProcessId: string | null;
  onChange: (row: ProcessLogicRow, next: AttendanceLogic) => Promise<void>;
}

type Filter = 'all' | AttendanceLogic | 'mixed';

export function SourceTab({ rows, loading, canEdit, savingProcessId, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<{ row: ProcessLogicRow; next: AttendanceLogic } | null>(null);

  const totals = useMemo(() => {
    const t: Record<AttendanceLogic, number> = { apr: 0, cosec: 0, apr_validated_by_cosec: 0 };
    for (const r of rows) for (const k of LOGIC_ORDER) t[k] += r.breakdown[k];
    return t;
  }, [rows]);
  const mixedCount = rows.filter((r) => r.is_mixed).length;

  const visible = rows.filter((r) => {
    if (query.trim() && !r.process_name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === 'all') return true;
    if (filter === 'mixed') return r.is_mixed;
    return r.attendance_logic === filter && !r.is_mixed;
  });

  const confirm = async () => {
    if (!pending) return;
    const { row, next } = pending;
    setPending(null);
    await onChange(row, next);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {LOGIC_ORDER.map((k) => (
          <div key={k} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className={LOGIC_META[k].badge}>{LOGIC_META[k].short}</Badge>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {loading ? '–' : totals[k].toLocaleString('en-IN')}
                <span className="ml-1 text-xs font-normal text-slate-500">employees</span>
              </p>
            </div>
            <p className="mt-2 text-sm font-medium text-slate-800">{LOGIC_META[k].title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{LOGIC_META[k].help}</p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-900">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <p>
          This is what the attendance engine will actually do for each process's active employees, worked out
          from the same rules it uses, so a process with no setting of its own still shows APR when a
          company-wide rule covers it. A change applies to the Operations executive designations in that
          process, from the next attendance run. To restate a past month, rebuild it.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            aria-label="Filter processes"
            placeholder="Search process"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => setFilter((v as Filter) || 'all')}
          className="flex-wrap justify-start"
          aria-label="Filter by source"
        >
          <ToggleGroupItem value="all" size="sm">All ({rows.length})</ToggleGroupItem>
          {LOGIC_ORDER.map((k) => (
            <ToggleGroupItem key={k} value={k} size="sm">{LOGIC_META[k].short}</ToggleGroupItem>
          ))}
          {mixedCount > 0 && <ToggleGroupItem value="mixed" size="sm">Mixed ({mixedCount})</ToggleGroupItem>}
        </ToggleGroup>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-slate-800">No process matches</p>
            <p className="mt-1 text-xs text-slate-500">Clear the search or the source filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Process</th>
                  <th scope="col" className="px-4 py-3 text-right">Employees</th>
                  <th scope="col" className="px-4 py-3">Source of attendance</th>
                  <th scope="col" className="px-4 py-3">Last changed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row) => {
                  const saving = savingProcessId === row.process_id;
                  return (
                    <tr key={row.process_id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.process_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.employee_count}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          {canEdit ? (
                            <ToggleGroup
                              type="single"
                              value={row.is_mixed ? '' : row.attendance_logic}
                              disabled={saving}
                              onValueChange={(v) => {
                                if (v && v !== row.attendance_logic) setPending({ row, next: v as AttendanceLogic });
                              }}
                              aria-label={`Source of attendance for ${row.process_name}`}
                              className="justify-start gap-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                            >
                              {LOGIC_ORDER.map((k) => (
                                <ToggleGroupItem
                                  key={k}
                                  value={k}
                                  size="sm"
                                  className="h-8 px-2.5 text-xs data-[state=on]:bg-white data-[state=on]:font-semibold data-[state=on]:shadow-sm"
                                >
                                  {LOGIC_META[k].short}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          ) : (
                            !row.is_mixed && (
                              <Badge variant="outline" className={LOGIC_META[row.attendance_logic].badge}>
                                {LOGIC_META[row.attendance_logic].short}
                              </Badge>
                            )
                          )}
                          {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Saving" />}
                          {row.override_count > 0 && (
                            <span className="text-xs text-slate-500">
                              {row.override_count} personal {row.override_count === 1 ? 'override' : 'overrides'}
                            </span>
                          )}
                          {row.is_mixed && (
                            <span className="text-xs text-amber-700">
                              Mixed: {LOGIC_ORDER.filter((k) => row.breakdown[k] > 0)
                                .map((k) => `${row.breakdown[k]} ${LOGIC_META[k].short}`).join(' · ')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatChanged(row.last_changed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!canEdit && !loading && (
        <p className="text-xs text-slate-500">You can view this page. Only an admin can change the source.</p>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change {pending?.row.process_name} to {pending ? LOGIC_META[pending.next].short : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This changes how attendance, and so salary, is built for this process's{' '}
                  <strong>{pending?.row.employee_count} active employees</strong>
                  {pending?.row.is_mixed ? ' (they are on a mix of sources today)' : ` (now ${pending ? LOGIC_META[pending.row.attendance_logic].short : ''})`}.
                </p>
                <p>{pending ? LOGIC_META[pending.next].help : ''}</p>
                <p className="text-slate-500">
                  Applies from the next attendance run. Days already built keep their result until the month is rebuilt.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirm()}>Change source</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
