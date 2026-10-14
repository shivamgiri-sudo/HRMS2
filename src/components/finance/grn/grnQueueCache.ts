import type { QueryClient } from "@tanstack/react-query";

/**
 * Cache plumbing for the GRN approval queues.
 *
 * After an approve / reject the row must leave the bucket the moment the server says yes, not after
 * a list refetch comes back (the list and summary endpoints take seconds on production, which read
 * as "the GRN is still there until I refresh"). So the decided row is removed from every cached
 * list first, the header counts are adjusted, and only then is everything GRN-related refetched.
 */

type ListShape = { data?: unknown[]; rows?: unknown[]; total?: number } | unknown[] | undefined;

function withoutRow(value: ListShape, id: string): ListShape {
  if (Array.isArray(value)) {
    return value.filter((r) => (r as { id?: string })?.id !== id);
  }
  if (value && typeof value === "object") {
    const v = value as { data?: unknown[]; rows?: unknown[]; total?: number };
    const key = Array.isArray(v.data) ? "data" : Array.isArray(v.rows) ? "rows" : null;
    if (key) {
      const before = (v[key] as unknown[]).length;
      const next = (v[key] as unknown[]).filter((r) => (r as { id?: string })?.id !== id);
      return {
        ...v,
        [key]: next,
        ...(typeof v.total === "number" && next.length < before ? { total: Math.max(0, v.total - 1) } : {}),
      };
    }
  }
  return value;
}

/** Removes a decided GRN from every cached queue/list and nudges the header counts. */
export function dropGrnFromQueues(
  queryClient: QueryClient,
  grn: { id: string; status?: string | null; amount?: number | null },
): void {
  const isGrnList = (key: readonly unknown[]) =>
    key[0] === "grn-list" || key[0] === "imprest-approval-queue";
  queryClient.setQueriesData({ predicate: (q) => isGrnList(q.queryKey) }, (old: ListShape) => withoutRow(old, grn.id));

  // Header chips: take one off the bucket the GRN was waiting in. The server's real figures replace
  // this as soon as the invalidation below refetches; this only avoids showing a stale number meanwhile.
  if (grn.status) {
    queryClient.setQueryData(["grn-summary"], (old: any) => {
      const bucket = old?.byStatus?.[grn.status as string];
      if (!bucket) return old;
      const amount = Number(grn.amount ?? 0);
      const dec = { count: Math.max(0, Number(bucket.count) - 1), value: Math.max(0, Number(bucket.value) - amount) };
      const inQ = old.inQueue
        ? ["submitted", "branch_head_approved", "accounts_head_approved"].includes(grn.status as string)
          ? { count: Math.max(0, Number(old.inQueue.count) - 1), value: Math.max(0, Number(old.inQueue.value) - amount) }
          : old.inQueue
        : old.inQueue;
      return { ...old, byStatus: { ...old.byStatus, [grn.status as string]: dec }, inQueue: inQ };
    });
  }
}

/** Refetch everything that can show a GRN's status: lists, counts, history, workspaces, dispatch. */
export function invalidateGrnQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (q) => {
      const head = String(q.queryKey[0] ?? "");
      return head.startsWith("grn-") || head === "imprest-approval-queue" || head.startsWith("vendor-payment");
    },
  });
}
