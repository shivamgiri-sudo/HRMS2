/** Number of replies waiting for HR (the Responses tab badge). Null until known or when the read fails (no badge, never a fake 0). */
import { useEffect, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { QUEUE_PATH } from "./responsesModel";

export function useQueueCount(refreshMs = 120_000): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => hrmsApi.get<{ data?: { counts?: { total?: number } } }>(QUEUE_PATH)
      .then((r) => { if (alive) setN(typeof r?.data?.counts?.total === "number" ? r.data.counts.total : null); }).catch(() => { if (alive) setN(null); });
    void read();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void read(); }, refreshMs);
    return () => { alive = false; window.clearInterval(t); };
  }, [refreshMs]);
  return n;
}
