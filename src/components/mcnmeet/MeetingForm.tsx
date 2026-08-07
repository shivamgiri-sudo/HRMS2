import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Video } from "lucide-react";
import { useCreateMeeting, type CreateMeetingPayload, type MeetingType, type AudienceType, MEETING_TYPE_LABELS, AUDIENCE_TYPE_LABELS } from "@/hooks/useMcnmeet";
import { useBranches, useProcesses, useLOBs, useDesignations } from "@/hooks/useOrgMasters";

interface Props {
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
  allowedMeetingTypes?: MeetingType[];
}

const ALL_MEETING_TYPES = Object.entries(MEETING_TYPE_LABELS) as [MeetingType, string][];
const AUDIENCE_TYPES = Object.entries(AUDIENCE_TYPE_LABELS) as [AudienceType, string][];
const AUDIENCES_WITH_VALUE: AudienceType[] = ['branch','department','process','lob','designation','reporting_manager_team','selected_employees'];

export function MeetingForm({ onSuccess, onCancel, allowedMeetingTypes }: Props) {
  const MEETING_TYPES = allowedMeetingTypes?.length
    ? ALL_MEETING_TYPES.filter(([type]) => allowedMeetingTypes.includes(type))
    : ALL_MEETING_TYPES;
  const create = useCreateMeeting();
  const { data: branches } = useBranches();
  const { data: processes } = useProcesses();
  const { data: lobs } = useLOBs();
  const { data: designations } = useDesignations();

  const [form, setForm] = useState<Partial<CreateMeetingPayload>>({
    meeting_type: 'team_meeting',
    timezone: 'Asia/Kolkata',
    recording_required: false,
    attendance_required: false,
    acknowledgement_required: false,
    audience: [{ type: 'all_company' }],
    co_host_ids: [],
  });

  const set = (k: keyof CreateMeetingPayload, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }));

  const addAudience = () =>
    setForm(f => ({ ...f, audience: [...(f.audience ?? []), { type: 'all_company' }] }));

  const removeAudience = (i: number) =>
    setForm(f => ({ ...f, audience: (f.audience ?? []).filter((_, j) => j !== i) }));

  const setAudience = (i: number, key: 'type' | 'value' | 'label', val: string) =>
    setForm(f => {
      const aud = [...(f.audience ?? [])];
      aud[i] = { ...aud[i], [key]: val };
      return { ...f, audience: aud };
    });

  const getOptionsForAudience = (type: AudienceType): { id: string; label: string }[] => {
    if (type === 'branch') return (branches ?? []).map(b => ({ id: b.id, label: (b as any).branch_name || b.name || b.id }));
    if (type === 'process') return (processes ?? []).map(p => ({ id: p.id, label: (p as any).process_name || p.name || p.id }));
    // LOB declares lob_name, so the cast was unnecessary and the  fallback could never
    // fire - the field does not exist on the type or in the payload.
    if (type === 'lob') return (lobs ?? []).map(l => ({ id: l.id, label: l.lob_name || l.id }));
    if (type === 'designation') return (designations ?? []).map(d => ({ id: d.id, label: (d as any).designation_name || d.name || d.id }));
    return [];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) { toast.error('Title is required'); return; }
    if (!form.start_at) { toast.error('Start date/time is required'); return; }
    if (!form.host_employee_id?.trim()) { toast.error('Host employee ID is required'); return; }
    if (!form.audience?.length) { toast.error('At least one audience target is required'); return; }

    try {
      const res = await create.mutateAsync(form as CreateMeetingPayload);
      toast.success('Meeting created successfully');
      onSuccess?.(res.id);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create meeting');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title <span className="text-red-500">*</span></Label>
            <Input id="title" value={form.title ?? ''} onChange={e => set('title', e.target.value)}
              placeholder="e.g. Weekly Team Standup" />
          </div>
          <div className="space-y-1.5">
            <Label>Meeting Type <span className="text-red-500">*</span></Label>
            <Select value={form.meeting_type} onValueChange={v => set('meeting_type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEETING_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description / Agenda</Label>
          <Textarea id="description" rows={3} value={form.description ?? ''}
            onChange={e => set('description', e.target.value)}
            placeholder="Meeting agenda, objectives, or instructions..." />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="start_at">Start Date &amp; Time <span className="text-red-500">*</span></Label>
            <Input id="start_at" type="datetime-local" value={form.start_at ?? ''}
              onChange={e => set('start_at', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end_at">End Date &amp; Time</Label>
            <Input id="end_at" type="datetime-local" value={form.end_at ?? ''}
              onChange={e => set('end_at', e.target.value)} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="host_employee_id">Host Employee ID <span className="text-red-500">*</span></Label>
            <Input id="host_employee_id" value={form.host_employee_id ?? ''}
              onChange={e => set('host_employee_id', e.target.value)}
              placeholder="Employee ID of host" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Input id="timezone" value={form.timezone ?? 'Asia/Kolkata'}
              onChange={e => set('timezone', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#073f78]">
            <Video className="h-3.5 w-3.5 text-white" />
          </div>
          <p className="font-semibold text-sm text-[#073f78]">MCNmeet Room</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mcnmeet_room_name">Custom Room Name (optional)</Label>
          <Input id="mcnmeet_room_name" value={form.mcnmeet_room_name ?? ''}
            onChange={e => set('mcnmeet_room_name', e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))}
            placeholder="Auto-generated if blank (e.g. mcnmeet-team-20260801-a3f2b1)" />
          <p className="text-xs text-slate-500">Only letters, numbers, _ and - allowed. Max 80 chars.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="google_meet_backup_url">Google Meet Backup Link (optional)</Label>
          <Input id="google_meet_backup_url" type="url" value={form.google_meet_backup_url ?? ''}
            onChange={e => set('google_meet_backup_url', e.target.value)}
            placeholder="https://meet.google.com/xxx-yyyy-zzz" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Audience Targeting <span className="text-red-500">*</span></Label>
          <Button type="button" variant="outline" size="sm" onClick={addAudience}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Target
          </Button>
        </div>
        <div className="space-y-2">
          {(form.audience ?? []).map((aud, i) => (
            <div key={i} className="flex items-start gap-2">
              <Select value={aud.type} onValueChange={v => setAudience(i, 'type', v as AudienceType)}>
                <SelectTrigger className="w-48 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUDIENCE_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>

              {AUDIENCES_WITH_VALUE.includes(aud.type) && aud.type !== 'selected_employees' && aud.type !== 'reporting_manager_team' && (
                (() => {
                  const opts = getOptionsForAudience(aud.type);
                  return opts.length > 0 ? (
                    <Select value={aud.value ?? ''} onValueChange={v => {
                      const opt = opts.find(o => o.id === v);
                      setAudience(i, 'value', v);
                      if (opt) setAudience(i, 'label', opt.label);
                    }}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {opts.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input className="flex-1" placeholder="Enter ID or name"
                      value={aud.value ?? ''} onChange={e => setAudience(i, 'value', e.target.value)} />
                  );
                })()
              )}

              {(aud.type === 'selected_employees' || aud.type === 'reporting_manager_team') && (
                <Input className="flex-1"
                  placeholder={aud.type === 'selected_employees' ? 'Comma-separated employee IDs' : 'Manager employee ID'}
                  value={aud.value ?? ''} onChange={e => setAudience(i, 'value', e.target.value)} />
              )}

              {(form.audience ?? []).length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => removeAudience(i)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {([
          ['recording_required', 'Recording required'],
          ['attendance_required', 'Attendance required'],
          ['acknowledgement_required', 'Acknowledgement required'],
        ] as const).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
            <Label htmlFor={key} className="text-sm cursor-pointer">{label}</Label>
            <Switch id={key} checked={!!(form as any)[key]}
              onCheckedChange={v => set(key, v)} />
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        )}
        <Button type="submit" disabled={create.isPending}
          className="bg-[#073f78] hover:bg-[#1B6AB5] text-white">
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Meeting
        </Button>
      </div>
    </form>
  );
}
