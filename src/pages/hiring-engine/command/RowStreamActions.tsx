/**
 * Containers that load streams and host the stream actions: the slot of an expanded drive-group row, and the dialog an insight's
 * "Extend the stream" opens. After any successful change the server's stream replaces the local copy, the list is reloaded, and the
 * caller reloads the row's trend / history and the section analytics. Nothing is optimistic.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createRequestSequencer, describeError, unusableMessage } from "./commandData";
import type { DriveGroup, StreamView } from "./driveCommandTypes";
import { STATUS_WORD, dialogEscapeAllowed, rowStreams, streamLabel, streamPath, streamStatus, streamsOfRequisitionPath } from "./streamActionsModel";
import StreamActions, { RowStreamActionsView } from "./StreamActions";
import CreateStreamDialog from "./CreateStreamDialog";

function useRowStreams(requisitionId: string, sourceType: DriveGroup["sourceType"]) {
  const seq = useRef(createRequestSequencer());
  const [streams, setStreams] = useState<StreamView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const ticket = seq.current.begin();
    setLoading(true);
    try {
      const r = await hrmsApi.get<{ data?: unknown }>(streamsOfRequisitionPath(requisitionId), undefined, ticket.signal);
      if (!ticket.isCurrent()) return;
      if (Array.isArray(r?.data)) { setStreams(rowStreams(r.data, sourceType)); setError(null); } else setError(unusableMessage(r));
    } catch (e: unknown) {
      if (ticket.isCurrent()) setError(describeError(e));
    } finally {
      if (ticket.isCurrent()) setLoading(false);
    }
  }, [requisitionId, sourceType]);
  useEffect(() => { void load(); const s = seq.current; return () => s.cancel(); }, [load]);
  const replace = useCallback((after: StreamView) => setStreams((list) => rowStreams(list.some((s) => s.id === after.id) ? list.map((s) => (s.id === after.id ? after : s)) : [...list, after], sourceType)), [sourceType]);
  return { streams, loading, error, reload: () => void load(), replace };
}

export interface RowStreamActionsProps { group: DriveGroup; today: string; reloadDetail?: () => void; onChanged?: () => void }

/** The expanded row's stream list with the Extend menu per stream and an "Open a stream" dialog for this requisition and type. */
export default function RowStreamActions({ group, today, reloadDetail, onChanged }: RowStreamActionsProps) {
  const { streams, loading, error, reload, replace } = useRowStreams(group.requisitionId, group.sourceType);
  const [note, setNote] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const done = (after: StreamView, text: string) => {
    setNote(text);
    replace(after);
    reload();
    reloadDetail?.();
    onChanged?.();
  };
  const label = group.role ? `${group.requisition} - ${group.role}` : group.requisition;
  return (
    <>
      <RowStreamActionsView streams={streams} today={today} loading={loading} error={error} note={note} onRetry={reload} onDone={done} onCreate={() => setCreateOpen(true)} />
      <CreateStreamDialog open={createOpen} onOpenChange={setCreateOpen} today={today} lockRequisition
        requisitions={[{ id: group.requisitionId, label: label || "This requisition", branch: group.branch, code: group.requisition }]}
        requisitionId={group.requisitionId} sourceType={group.sourceType}
        onCreated={(s, text) => { setCreateOpen(false); done(s, text); }} />
    </>
  );
}

function StreamPanel({ streamId, today, onChanged, onMenuOpenChange }: { streamId: string; today: string; onChanged?: () => void; onMenuOpenChange?: (open: boolean) => void }) {
  const [stream, setStream] = useState<StreamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    hrmsApi.get<{ data?: StreamView }>(streamPath(streamId), undefined, c.signal)
      .then((r) => { if (!c.signal.aborted) { if (r?.data) setStream(r.data); else setError(unusableMessage(r)); } })
      .catch((e: unknown) => { if (!c.signal.aborted) setError(describeError(e)); });
    return () => c.abort();
  }, [streamId]);
  return (
    <div className="space-y-3">
      <p role="status" className="text-sm text-emerald-800 empty:hidden dark:text-emerald-200">{note}</p>
      {!stream && !error && <div aria-busy="true" aria-label="Loading the stream" className="animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" style={{ height: 48 }} />}
      {error && <p role="alert" className="flex items-center gap-2 text-sm text-rose-800 dark:text-rose-200"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Could not load the stream: {error}</p>}
      {stream && (
        <div role="group" aria-label={streamLabel(stream)} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{streamLabel(stream)}</span>
          <span className="rounded border border-slate-400 px-1.5 text-xs font-semibold text-slate-800 dark:border-slate-500 dark:text-slate-100">{STATUS_WORD[streamStatus(stream)]}</span>
          <span className="text-xs text-slate-700 dark:text-slate-200">{stream.label}</span>
          <span className="ml-auto"><StreamActions stream={stream} today={today} onMenuOpenChange={onMenuOpenChange} onDone={(after, text) => { setStream(after); setNote(text); onChanged?.(); }} /></span>
        </div>
      )}
    </div>
  );
}

/** Opened by an insight's "Extend the stream": loads that stream and offers its Extend menu. */
export function StreamDialog({ open, onOpenChange, streamId, today, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; streamId: string | null; today: string; onChanged?: () => void }) {
  // Radix handles Escape in the capture phase, before the menu sees it: while the Extend menu is open, Escape belongs to the menu.
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setMenuOpen(false); onOpenChange(o); }}>
      <DialogContent className="max-w-xl" onEscapeKeyDown={(e) => { if (!dialogEscapeAllowed({ menuOpen })) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Change the stream</DialogTitle>
          <DialogDescription className="text-slate-700 dark:text-slate-200">Pick a change from the Extend menu; every change asks for confirmation.</DialogDescription>
        </DialogHeader>
        {open && streamId && <StreamPanel streamId={streamId} today={today} onChanged={onChanged} onMenuOpenChange={setMenuOpen} />}
      </DialogContent>
    </Dialog>
  );
}
