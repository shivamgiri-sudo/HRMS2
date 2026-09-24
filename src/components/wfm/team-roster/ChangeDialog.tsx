import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  NON_SHIFT_CHOICES, choiceValue, formatDmy, parseChoice, templateLabel,
  type CellChoice, type TemplateOption,
} from "./teamRosterFormat";

export const MIN_REASON = 8;

export interface ChangeTarget {
  employeeName: string;
  date: string;
  currentLabel: string;
  options: TemplateOption[];
  initial: CellChoice | null;
  initialReason: string;
}

interface Props {
  target: ChangeTarget | null;
  onSave: (choice: CellChoice, reason: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Propose a change to an already-rostered date: a new value (closed set) plus a mandatory reason. */
export default function ChangeDialog({ target, onSave, onRemove, onClose }: Props) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!target) return;
    setValue(choiceValue(target.initial));
    setReason(target.initialReason);
    setTouched(false);
  }, [target]);

  const choice = parseChoice(value);
  const reasonOk = reason.trim().length >= MIN_REASON;
  const canSave = choice !== null && reasonOk;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Propose a change</DialogTitle>
          <DialogDescription>
            {target ? `${target.employeeName} on ${formatDmy(target.date)}. Currently: ${target.currentLabel}. The change only takes effect after manager and WFM approval.` : ""}
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="team-roster-change-value">New value</Label>
              <select
                id="team-roster-change-value"
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">Select a value</option>
                {target.options.length > 0 && (
                  <optgroup label="Shifts">
                    {target.options.map((t) => <option key={t.id} value={`SHIFT:${t.id}`}>{templateLabel(t)}</option>)}
                  </optgroup>
                )}
                <optgroup label="Other">
                  {NON_SHIFT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-roster-change-reason">Reason (required, at least {MIN_REASON} characters)</Label>
              <Textarea
                id="team-roster-change-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
              />
              {touched && !reasonOk && <p className="text-xs text-red-600">Enter a reason of at least {MIN_REASON} characters.</p>}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          {target?.initial ? <Button variant="ghost" className="text-red-600" onClick={onRemove}>Remove proposal</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!canSave} onClick={() => choice && onSave(choice, reason.trim())}>Add to draft</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
