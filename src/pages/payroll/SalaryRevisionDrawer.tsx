import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { hrmsApi } from '@/lib/hrmsApi';
import { useToast } from '@/hooks/use-toast';
import { CalendarDays } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  currentEffectiveFrom: string;  // YYYY-MM-DD
  dateOfJoining: string;         // YYYY-MM-DD — used as min date on picker
  onSuccess: () => void;
}

export function SalaryRevisionDrawer({
  open, onClose, employeeId, employeeName, currentEffectiveFrom, dateOfJoining, onSuccess,
}: Props) {
  const { toast } = useToast();
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmtDate = (d: string) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const handleSubmit = async () => {
    setError(null);
    if (!newDate) { setError('New effective date is required.'); return; }
    if (reason.trim().length < 10) { setError('Reason must be at least 10 characters.'); return; }
    setBusy(true);
    try {
      await hrmsApi.post('/api/salary-revision', {
        employee_id: employeeId,
        requested_effective_from: newDate,
        reason: reason.trim(),
      });
      toast({ title: 'Revision request submitted', description: 'Awaiting Payroll Head review.' });
      setNewDate(''); setReason('');
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="max-w-lg w-full flex flex-col p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-5">
          <SheetHeader>
            <SheetTitle className="text-white text-base font-semibold">Request Salary Date Revision</SheetTitle>
          </SheetHeader>
          <p className="text-blue-100 text-sm mt-1">{employeeName}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 bg-white/20 rounded-lg px-3 py-1 text-sm">
            <CalendarDays className="h-3.5 w-3.5" />
            Current effective: {fmtDate(currentEffectiveFrom)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              New Effective Date <span className="text-red-500">*</span>
            </Label>
            <Input
              type="date"
              value={newDate}
              min={dateOfJoining}
              onChange={(e) => setNewDate(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why the date needs to change (min 10 characters)"
              rows={4}
              className="rounded-xl resize-none"
            />
            <p className="text-[11px] text-slate-400">{reason.trim().length}/10 minimum</p>
          </div>
        </div>

        <div className="border-t p-4 flex gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy} className="flex-1 rounded-xl">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-700 rounded-xl">
            {busy ? 'Submitting…' : 'Submit Request'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
