/**
 * Notify All on the Meta Leads page: the server sends (POST /api/meta/leads/notify-all, same guards as the single Notify button) and
 * reports one result per lead. Sent in chunks so one request never runs long enough to hit a proxy timeout.
 */

export const NOTIFY_CHUNK = 10;
export interface BulkTotals { sent: number; skipped: number; failed: number; reasons: Record<string, number> }
type Post = (url: string, body: { leadIds: string[] }) => Promise<{ data: { results: Array<{ leadId: string; status: "sent" | "skipped" | "failed"; reason?: string }> } }>;

export function unnotifiedQualifiedIds(rows: Array<{ id: string; screeningResult?: string | null; notificationSentAt?: string | null }>, sent: ReadonlySet<string>): string[] {
  return rows.filter((r) => r.screeningResult === "qualified" && !sent.has(r.id) && !r.notificationSentAt).map((r) => r.id);
}

export async function runNotifyAll(ids: string[], post: Post, onSent: (sentIds: string[]) => void): Promise<BulkTotals> {
  const t: BulkTotals = { sent: 0, skipped: 0, failed: 0, reasons: {} };
  for (let i = 0; i < ids.length; i += NOTIFY_CHUNK) {
    const chunk = ids.slice(i, i + NOTIFY_CHUNK);
    try {
      const res = await post("/api/meta/leads/notify-all", { leadIds: chunk });
      const results = res.data?.results ?? [];
      for (const r of results) {
        t[r.status]++;
        if (r.status !== "sent" && r.reason) t.reasons[r.reason] = (t.reasons[r.reason] ?? 0) + 1;
      }
      onSent(results.filter((r) => r.status === "sent").map((r) => r.leadId));
    } catch {
      t.failed += chunk.length;
    }
  }
  return t;
}
