/**
 * Notify All on the Meta Leads page: the server sends (POST /api/meta/leads/notify-all, same guards as the single Notify button) and
 * reports one result per lead. Sent in chunks so one request never runs long enough to hit a proxy timeout. The server stamps each lead as
 * it sends, so when a chunk's response is lost (timeout, proxy error) the chunk is re-read (/notify-all/status) instead of guessed.
 */

export const NOTIFY_CHUNK = 10;
export const NOTIFY_ALL_PATH = "/api/meta/leads/notify-all";
export const NOTIFY_STATUS_PATH = "/api/meta/leads/notify-all/status";
export interface BulkFailure { leadId: string; reason: string }
export interface BulkTotals { sent: number; skipped: number; failed: number; reasons: Record<string, number>; failures: BulkFailure[]; unavailable: boolean }
type Result = { leadId: string; status: "sent" | "skipped" | "failed"; reason?: string };
type Post = (url: string, body: { leadIds: string[] }) => Promise<{ data: { results: Array<Result | { leadId: string; notified: boolean }> } }>;

export function unnotifiedQualifiedIds(rows: Array<{ id: string; screeningResult?: string | null; notificationSentAt?: string | null }>, sent: ReadonlySet<string>): string[] {
  return rows.filter((r) => r.screeningResult === "qualified" && !sent.has(r.id) && !r.notificationSentAt).map((r) => r.id);
}

const statusOf = (e: unknown): number | undefined => (typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : undefined);
const messageOf = (e: unknown): string => (e instanceof Error && e.message ? e.message : "request failed").slice(0, 120);

export async function runNotifyAll(ids: string[], post: Post, onSent: (sentIds: string[]) => void): Promise<BulkTotals> {
  const t: BulkTotals = { sent: 0, skipped: 0, failed: 0, reasons: {}, failures: [], unavailable: false };
  const fail = (leadId: string, reason: string) => { t.failed++; t.failures.push({ leadId, reason }); };
  for (let i = 0; i < ids.length; i += NOTIFY_CHUNK) {
    const chunk = ids.slice(i, i + NOTIFY_CHUNK);
    try {
      const res = await post(NOTIFY_ALL_PATH, { leadIds: chunk });
      const results = (res.data?.results ?? []) as Result[];
      for (const r of results) {
        if (r.status === "failed") { fail(r.leadId, r.reason ?? "failed"); continue; }
        t[r.status]++;
        if (r.status !== "sent" && r.reason) t.reasons[r.reason] = (t.reasons[r.reason] ?? 0) + 1;
      }
      onSent(results.filter((r) => r.status === "sent").map((r) => r.leadId));
    } catch (e) {
      // The route itself is missing (an older server): stop, nothing was sent by this chunk.
      if (statusOf(e) === 404 && i === 0) { t.unavailable = true; return t; }
      const why = messageOf(e);
      let marked = new Set<string>();
      try {
        const st = await post(NOTIFY_STATUS_PATH, { leadIds: chunk });
        marked = new Set((st.data?.results ?? []).filter((r) => "notified" in r && r.notified).map((r) => r.leadId));
      } catch { /* unknown: none counted as sent */ }
      const sentIds = chunk.filter((id) => marked.has(id));
      t.sent += sentIds.length;
      if (sentIds.length) onSent(sentIds);
      for (const id of chunk) if (!marked.has(id)) fail(id, `No answer from the server (${why}); not marked as sent, check before notifying again`);
    }
  }
  return t;
}
