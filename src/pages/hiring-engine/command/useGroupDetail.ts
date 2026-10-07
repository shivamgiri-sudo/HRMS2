/** Lazy detail of one expanded drive group: the day-wise trend and the extension history, each with its own error so one failing never hides the other. */
import { useCallback, useEffect, useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { createRequestSequencer, describeError, unusableMessage } from "./commandData";
import { eventsPath, mergeEvents, trendPath } from "./driveGroupModel";
import type { DriveGroup, DriveTrend, StreamEvent } from "./driveCommandTypes";

export interface GroupDetail {
  trend: DriveTrend | null; trendError: string | null; loading: boolean;
  events: StreamEvent[]; eventsError: string | null;
  reload: () => void;
}

/** Loads only while `open`; closing and reopening keeps what was loaded. A stale response is never applied. */
export function useGroupDetail(group: DriveGroup, open: boolean): GroupDetail {
  const seq = useRef(createRequestSequencer());
  const [trend, setTrend] = useState<DriveTrend | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const started = useRef(false);
  const path = trendPath(group);
  const ids = group.streamIds.join(",");

  const run = useCallback(async () => {
    const ticket = seq.current.begin();
    setLoading(true);
    const streamIds = ids ? ids.split(",") : [];
    const [t, ev] = await Promise.allSettled([
      hrmsApi.get<{ data?: DriveTrend }>(path, undefined, ticket.signal),
      Promise.all(streamIds.map((id) => hrmsApi.get<{ data?: StreamEvent[] }>(eventsPath(id), undefined, ticket.signal))),
    ]);
    if (!ticket.isCurrent()) return;
    if (t.status === "fulfilled" && t.value?.data) { setTrend(t.value.data); setTrendError(null); }
    else setTrendError(t.status === "rejected" ? describeError(t.reason) : unusableMessage(t.value));
    if (ev.status === "fulfilled") { setEvents(mergeEvents(ev.value.map((r) => (Array.isArray(r?.data) ? r.data : [])))); setEventsError(null); }
    else setEventsError(describeError(ev.reason));
    setLoading(false);
  }, [path, ids]);

  useEffect(() => {
    if (open && !started.current) { started.current = true; void run(); }
  }, [open, run]);
  // A different group (the keys changed) starts again the next time it is opened.
  useEffect(() => () => { started.current = false; seq.current.cancel(); }, [path, ids]);

  return { trend, trendError, loading, events, eventsError, reload: () => void run() };
}
