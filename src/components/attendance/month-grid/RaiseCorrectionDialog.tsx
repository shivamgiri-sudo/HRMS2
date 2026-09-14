import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

/**
 * Structured replacement for the old window.prompt() correction flow. Same endpoint
 * (POST /api/wfm/regularizations/batch) — but that endpoint reads `sessionDates`, and
 * the previous caller sent `dates`, so every submission from this page was silently
 * rejected with "sessionDates array is required" regardless of what the manager typed
 * into the prompt. Fixed here.
 */
export function RaiseCorrectionDialog({
  open, onOpenChange, employeeId, employeeName, dates, onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  dates: string[];
  onSubmitted?: () => void;
}) {
  const { toast } = useToast();
  const [reasonCode, setReasonCode] = useState("");
  const [requestedStatus, setRequestedStatus] = useState("present");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: reasons } = useQuery({
    queryKey: ["wfm-regularization-reasons"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { code: string; label: string }[] }>(
        "/api/wfm/regularizations/reasons",
      );
      return res.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const isValid = dates.length > 0 && reasonCode && note.trim().length >= 5;

  async function submit() {
    if (!isValid) return;
    setSubmitting(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; succeeded: number; failed: number; data: any[] }>(
        "/api/wfm/regularizations/batch",
        {
          employeeId,
          sessionDates: dates,
          reasonCode,
          requestedStatus,
          reason: note.trim(),
        },
      );
      const failed = res.failed ?? 0;
      const succeeded = res.succeeded ?? dates.length;
      toast({
        title: failed ? `${succeeded} raised, ${failed} could not be` : `${succeeded} correction request(s) raised`,
        description: failed
          ? (res.data ?? []).filter((r) => !r.success).slice(0, 3).map((r) => r.message).join(" · ")
          : `Sent to your reviewer for ${employeeName}.`,
        variant: failed ? "destructive" : undefined,
      });
      setReasonCode(""); setNote(""); setRequestedStatus("present");
      onOpenChange(false);
      onSubmitted?.();
    } catch (e) {
      toast({
        title: "Could not raise the correction",
        description: e instanceof Error ? e.message : "The request failed.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Raise a correction</DialogTitle>
          <DialogDescription>
            {employeeName} · {dates.length} day{dates.length !== 1 ? "s" : ""}: {dates.join(", ")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Should be recorded as</Label>
            <Select value={requestedStatus} onValueChange={setRequestedStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="half_day">Half Day</SelectItem>
                <SelectItem value="work_from_home">Work From Home</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {(reasons ?? []).map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Note <span className="text-destructive">*</span></Label>
            <Textarea
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="What happened on this day? (min. 5 characters)"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!isValid || submitting}>
            {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Raise request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
