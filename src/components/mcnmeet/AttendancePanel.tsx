import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, UserCheck, Users } from "lucide-react";
import { useMarkAttendance, type Invitee } from "@/hooks/useMcnmeet";

interface Props {
  meetingId: string;
  invitees: Invitee[];
}

type JoinedStatus = 'not_joined' | 'joined' | 'late';

const STATUS_OPTIONS: { value: JoinedStatus; label: string; color: string }[] = [
  { value: 'joined',     label: 'Joined',     color: 'text-green-700' },
  { value: 'late',       label: 'Joined Late', color: 'text-amber-600' },
  { value: 'not_joined', label: 'Not Joined', color: 'text-red-600' },
];

export function AttendancePanel({ meetingId, invitees }: Props) {
  const markAttendance = useMarkAttendance(meetingId);
  const [overrides, setOverrides] = useState<Record<string, JoinedStatus>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());

  const getStatus = (inv: Invitee): JoinedStatus => overrides[inv.id] ?? inv.joined_status;

  const handleSave = async (inv: Invitee) => {
    setSaving(s => new Set(s).add(inv.id));
    try {
      await markAttendance.mutateAsync({
        invitee_id: inv.id,
        joined_status: getStatus(inv),
        remarks: remarks[inv.id] ?? undefined,
      });
      toast.success(`Attendance saved for ${inv.employee_name}`);
    } catch {
      toast.error(`Failed to save for ${inv.employee_name}`);
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(inv.id); return n; });
    }
  };

  const handleBulkMark = (status: JoinedStatus) => {
    const next: Record<string, JoinedStatus> = {};
    invitees.forEach(inv => { next[inv.id] = status; });
    setOverrides(next);
  };

  const joined  = invitees.filter(i => getStatus(i) === 'joined').length;
  const late    = invitees.filter(i => getStatus(i) === 'late').length;
  const absent  = invitees.filter(i => getStatus(i) === 'not_joined').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {[
          { label: 'Joined',      count: joined,  bg: 'bg-green-50 border-green-200 text-green-700' },
          { label: 'Joined Late', count: late,    bg: 'bg-amber-50 border-amber-200 text-amber-700' },
          { label: 'Not Joined',  count: absent,  bg: 'bg-red-50 border-red-200 text-red-600' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${s.bg}`}>
            {s.count} {s.label}
          </div>
        ))}
        <div className="flex-1" />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleBulkMark('joined')}>
            <UserCheck className="mr-1.5 h-3.5 w-3.5 text-green-600" /> Mark all present
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleBulkMark('not_joined')}>
            <Users className="mr-1.5 h-3.5 w-3.5 text-red-500" /> Mark all absent
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
        <div className="grid grid-cols-[1fr_160px_160px_80px] gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Employee</span>
          <span>Status</span>
          <span>Remarks</span>
          <span />
        </div>

        {invitees.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-400">
            No invitees - resolve audience first
          </div>
        )}

        {invitees.map(inv => {
          const status = getStatus(inv);
          const isDirty = overrides[inv.id] !== undefined || !!remarks[inv.id];
          const isSaving = saving.has(inv.id);

          return (
            <div key={inv.id} className="grid grid-cols-[1fr_160px_160px_80px] gap-2 items-center border-b border-slate-50 px-4 py-2.5 last:border-0 hover:bg-slate-50/50">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{inv.employee_name}</p>
                <p className="text-xs text-slate-400 truncate">{inv.employee_code ?? inv.employee_id}</p>
              </div>

              <Select value={status} onValueChange={v => setOverrides(o => ({ ...o, [inv.id]: v as JoinedStatus }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className={opt.color}>{opt.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                className="h-8 text-xs"
                placeholder="Optional note"
                value={remarks[inv.id] ?? ''}
                onChange={e => setRemarks(r => ({ ...r, [inv.id]: e.target.value }))}
              />

              <Button
                size="sm"
                className="h-7 text-xs bg-[#073f78] text-white hover:opacity-90"
                disabled={!isDirty || isSaving}
                onClick={() => handleSave(inv)}
              >
                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
