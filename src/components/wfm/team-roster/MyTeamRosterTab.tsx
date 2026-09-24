import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/useDebounce";
import {
  useDiscardDraft, useSaveDraftLines, useSubmitDraft, useTeamRosterDraft, useTeamRosterGrid, useTeamRosterTemplates,
  type GridRow, type TeamRosterMe,
} from "@/hooks/useTeamRoster";
import ChangeDialog, { type ChangeTarget } from "./ChangeDialog";
import SubmitProblemsDialog from "./SubmitProblemsDialog";
import TeamRosterGrid, { stagedKey, templatesFor, type StagedEdit } from "./TeamRosterGrid";
import {
  RANGE_PRESETS, formatDmy, presetRange, spanDays, storedLabel, unpackError,
  type ApiFailure, type CellChoice, type RangePreset,
} from "./teamRosterFormat";

const PAGE_SIZES = [25, 50, 100] as const;

interface Props { me: TeamRosterMe; onSubmitted: (submissionId: number) => void }

export function countDraftChanges(serverKeys: string[], staged: Record<string, StagedEdit>): number {
  const keys = new Set(serverKeys);
  for (const [k, e] of Object.entries(staged)) {
    if (e.choice === null) keys.delete(k); else keys.add(k);
  }
  return keys.size;
}

export default function MyTeamRosterTab({ me, onSubmitted }: Props) {
  const initial = presetRange("next-7", me.today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [offset, setOffset] = useState(0);
  const [staged, setStaged] = useState<Record<string, StagedEdit>>({});
  const [change, setChange] = useState<{ row: GridRow; date: string } | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [note, setNote] = useState("");
  const debounced = useDebounce(search, 300);

  const rangeError = !from || !to ? "Choose both dates." : to < from ? "The end date must not be before the start date."
    : spanDays(from, to) > me.maxRangeDays ? `A range can span at most ${me.maxRangeDays} days.` : null;

  const grid = useTeamRosterGrid({ from, to, search: debounced.trim(), offset, limit: pageSize }, !rangeError);
  const templates = useTeamRosterTemplates(true);
  const draft = useTeamRosterDraft(true);
  const save = useSaveDraftLines();
  const submit = useSubmitDraft();
  const discard = useDiscardDraft();

  const names = useMemo(() => Object.fromEntries((grid.data?.rows ?? []).map((r) => [r.employeeId, r.name])), [grid.data]);
  const serverKeys = (draft.data?.draft?.lines ?? []).map((l) => stagedKey(l.employeeId, l.date));
  const changeCount = countDraftChanges(serverKeys, staged);
  const dirty = Object.keys(staged).length > 0;
  const busy = save.isPending || submit.isPending || discard.isPending;

  const stage = (row: GridRow, date: string, choice: CellChoice | null, reason: string | null = null) =>
    setStaged((s) => ({ ...s, [stagedKey(row.employeeId, date)]: { choice, reason } }));

  const flush = async (): Promise<boolean> => {
    if (!dirty) return true;
    const upserts = Object.entries(staged).filter(([, e]) => e.choice).map(([k, e]) => {
      const [employeeId, date] = k.split("|");
      return { employeeId, date, type: e.choice!.type, shiftTemplateId: e.choice!.shiftTemplateId, reason: e.reason };
    });
    const deletes = Object.entries(staged).filter(([, e]) => !e.choice).map(([k]) => {
      const [employeeId, date] = k.split("|");
      return { employeeId, date };
    });
    try {
      await save.mutateAsync({ upserts, deletes });
      setStaged({});
      return true;
    } catch (e) {
      setFailure(unpackError(e));
      return false;
    }
  };

  const onSave = async () => { if (await flush()) toast.success("Draft saved."); };
  const onSubmit = async () => {
    if (!(await flush())) { setConfirming(false); return; }
    try {
      const out = await submit.mutateAsync(note.trim() || null);
      toast.success(`Submitted ${out.submissionNo}.`);
      setConfirming(false);
      setNote("");
      onSubmitted(out.submissionId);
    } catch (e) {
      setConfirming(false);
      setFailure(unpackError(e));
    }
  };
  const onDiscard = async () => {
    try {
      await discard.mutateAsync();
      setStaged({});
      setDiscarding(false);
      toast.success("Draft discarded.");
    } catch (e) {
      toast.error(unpackError(e).message);
    }
  };

  const changeTarget: ChangeTarget | null = useMemo(() => {
    if (!change) return null;
    const cell = change.row.cells[change.date];
    const edit = staged[stagedKey(change.row.employeeId, change.date)];
    const fromServer = cell?.draft ? { type: cell.draft.type, shiftTemplateId: cell.draft.shiftTemplateId } : null;
    return {
      employeeName: change.row.name, date: change.date,
      currentLabel: cell?.assignment ? storedLabel(cell.assignment).long : "Unassigned",
      options: templatesFor(templates.data?.processes ?? [], change.row.processId),
      initial: edit !== undefined ? edit.choice : fromServer,
      initialReason: edit?.reason ?? cell?.draft?.reason ?? "",
    };
  }, [change, staged, templates.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="tr-from">From</Label>
          <Input id="tr-from" type="date" value={from} min={me.today} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tr-to">To</Label>
          <Input id="tr-to" type="date" value={to} min={from || me.today} onChange={(e) => { setTo(e.target.value); setOffset(0); }} className="h-9 w-40" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range presets">
          {RANGE_PRESETS.map((p) => (
            <Button key={p.value} type="button" variant="outline" size="sm" onClick={() => { const r = presetRange(p.value as RangePreset, me.today); setFrom(r.from); setTo(r.to); setOffset(0); }}>{p.label}</Button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <Input aria-label="Search team" placeholder="Search name or employee code" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} className="h-9 pl-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tr-page-size">Rows</Label>
          <select id="tr-page-size" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setOffset(0); }}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      {rangeError && <p role="alert" className="text-sm text-red-600">{rangeError}</p>}
      {me.teamTruncated && <p className="text-xs text-amber-700">Your reporting tree is very large; only the first part of it is shown.</p>}
      <p className="text-xs text-slate-500">
        Blank dates can be filled directly. A date that already has a roster is read-only; use the pencil to propose a change with a reason.
        Nothing reaches the roster until it is approved{me.hasReportingManager ? " by your reporting manager and then by WFM" : " by WFM (you have no reporting manager on record)"}.
      </p>

      {grid.isLoading && !rangeError && <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>}
      {grid.isError && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load the roster grid. {unpackError(grid.error).message}</p>}
      {grid.data && !rangeError && (
        <>
          <TeamRosterGrid
            data={grid.data} today={me.today} templates={templates.data?.processes ?? []} staged={staged}
            onChoose={(row, date, choice) => stage(row, date, choice)}
            onProposeChange={(row, date) => setChange({ row, date })}
          />
          {grid.data.total > grid.data.limit && (
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{grid.data.offset + 1}-{Math.min(grid.data.offset + grid.data.limit, grid.data.total)} of {grid.data.total} people</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - pageSize, 0))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={offset + pageSize >= grid.data.total} onClick={() => setOffset(offset + pageSize)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="sticky bottom-0 z-40 -mx-1 rounded-t-xl border-t bg-white/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-700" aria-live="polite">
            {changeCount} {changeCount === 1 ? "change" : "changes"}{dirty ? " (unsaved edits)" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {changeCount > 0 && <Button variant="ghost" className="text-red-600" disabled={busy} onClick={() => setDiscarding(true)}>Discard draft</Button>}
            <Button variant="outline" disabled={!dirty || busy} onClick={onSave}>Save draft</Button>
            <Button disabled={changeCount === 0 || busy} onClick={() => setConfirming(true)}>Submit for approval</Button>
          </div>
        </div>
      </div>

      <ChangeDialog
        target={changeTarget}
        onClose={() => setChange(null)}
        onSave={(choice, reason) => { if (change) stage(change.row, change.date, choice, reason); setChange(null); }}
        onRemove={() => { if (change) stage(change.row, change.date, null); setChange(null); }}
      />
      <SubmitProblemsDialog failure={failure} names={names} onClose={() => setFailure(null)} />

      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Submit {changeCount} {changeCount === 1 ? "change" : "changes"} for approval?</DialogTitle>
            <DialogDescription>
              {me.hasReportingManager ? "Your reporting manager approves first, then WFM gives the final approval." : "You have no reporting manager on record, so this goes straight to WFM."}
              {" "}The dates involved are locked against other submissions until a decision is made ({formatDmy(from)} - {formatDmy(to)} shown).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="tr-note">Note for approvers (optional)</Label>
            <Textarea id="tr-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Back</Button>
            <Button disabled={busy} onClick={onSubmit}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discarding} onOpenChange={(o) => !o && setDiscarding(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard your draft?</DialogTitle>
            <DialogDescription>All {changeCount} unsubmitted changes will be removed. Submitted requests are not affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscarding(false)}>Keep draft</Button>
            <Button variant="destructive" disabled={busy} onClick={onDiscard}>Discard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
