import type { ApprovalAction, ApprovalAdapter, ApprovalItem, LoopbackCtx } from "./types.js";
import { LoopbackError } from "./types.js";
import { ADAPTERS } from "./adapters/index.js";

const ADAPTER_TIMEOUT_MS = 90_000;
const CACHE_TTL_MS = 120_000;
const cache = new Map<string, { exp: number; value: ListResult }>();

export interface ListResult {
  items: ApprovalItem[];
  /** Per-kind counts, after de-dupe. */
  counts: Record<string, number>;
  /** Kinds whose list call failed — shown as a soft warning, never hides the rest. */
  failed: Array<{ kind: string; label: string; reason: string }>;
  /** Pending items older than the freshness window that are NOT listed (they remain on their module pages). */
  staleHidden: number;
  generatedAt: string;
}

/**
 * Freshness window: the popup is "pending on me, now". Items submitted more than this many days ago are not listed (they are
 * counted in `staleHidden` and stay on their own pages). APPROVAL_CENTER_MAX_AGE_DAYS=0 disables the window. Read per call so
 * tests and ops can change it without a restart-order dependency.
 */
export const DEFAULT_MAX_AGE_DAYS = 60;
export function maxAgeDays(): number {
  const raw = process.env.APPROVAL_CENTER_MAX_AGE_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_AGE_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_AGE_DAYS;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let i = 0;
  const run = async () => {
    for (let k = i++; k < list.length; k = i++) out[k] = await fn(list[k]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, run));
  return out;
}

/** One list build per user at a time: a double-open / refetch storm shares the in-flight build. */
const building = new Map<string, Promise<ListResult>>();

const PRIORITY_RANK = { high: 0, normal: 1 } as const;

export function invalidateApprovalCache(userId: string) {
  cache.delete(userId);
}

export function listPendingApprovals(ctx: LoopbackCtx, opts: { fresh?: boolean } = {}): Promise<ListResult> {
  const existing = building.get(ctx.userId);
  if (existing) return existing;
  const p = buildList(ctx, opts).finally(() => building.delete(ctx.userId));
  building.set(ctx.userId, p);
  return p;
}

async function buildList(ctx: LoopbackCtx, opts: { fresh?: boolean }): Promise<ListResult> {
  const hit = cache.get(ctx.userId);
  if (!opts.fresh && hit && hit.exp > Date.now()) return hit.value;

  const failed: ListResult["failed"] = [];
  // Adapters run a few at a time (loopback also caps in-flight calls process-wide) so listing never floods the DB pool.
  const settled = await mapLimit(ADAPTERS, 4, async (a) => {
      try {
        return await withTimeout(a.list(ctx), ADAPTER_TIMEOUT_MS);
      } catch (e: any) {
        // 401/403 = this person simply has no queue here. Anything else is a real fault worth surfacing.
        if (!(e instanceof LoopbackError && (e.status === 401 || e.status === 403))) {
          failed.push({ kind: a.kind, label: a.label, reason: String(e?.message ?? e).slice(0, 200) });
        }
        return [] as ApprovalItem[];
      }
  });

  const seen = new Set<string>();
  const items: ApprovalItem[] = [];
  const windowDays = maxAgeDays();
  const cutoff = windowDays > 0 ? Date.now() - windowDays * 86_400_000 : null;
  let staleHidden = 0;
  for (const batch of settled) {
    for (const it of batch) {
      if (seen.has(it.uid)) continue;
      seen.add(it.uid);
      // Items without a usable submittedAt cannot be aged, so they stay visible.
      if (cutoff !== null && it.submittedAt) {
        const t = new Date(it.submittedAt).getTime();
        if (Number.isFinite(t) && t < cutoff) {
          staleHidden++;
          continue;
        }
      }
      items.push(it);
    }
  }
  items.sort((a, b) => {
    const p = PRIORITY_RANK[a.priority ?? "normal"] - PRIORITY_RANK[b.priority ?? "normal"];
    if (p !== 0) return p;
    return String(a.submittedAt ?? "").localeCompare(String(b.submittedAt ?? ""));
  });

  const counts: Record<string, number> = {};
  for (const it of items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;

  for (const it of items) {
    const m = it.meta ?? {};
    it.viewOnly = m.viewOnly === true;
    it.noReject = m.noReject === true || m.approveOnly === true || m.rejectUnsupported === true || m.rejectViewOnly === true;
    it.noApprove = m.approveViewOnly === true;
  }
  const value: ListResult = { items, counts, failed, staleHidden, generatedAt: new Date().toISOString() };
  cache.set(ctx.userId, { exp: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export function findAdapter(kind: string): ApprovalAdapter | undefined {
  return ADAPTERS.find((a) => a.kind === kind);
}

/**
 * Decide one item. The item is re-resolved from a FRESH list first: a client can only decide
 * something that is genuinely still pending for this caller, and the adapter gets the server's
 * own `meta`, never one the client supplied.
 */
export async function decideApproval(
  ctx: LoopbackCtx,
  uid: string,
  action: ApprovalAction,
  remarks: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const sep = uid.indexOf(":");
  const kind = sep > 0 ? uid.slice(0, sep) : "";
  const adapter = findAdapter(kind);
  if (!adapter) return { ok: false, status: 400, message: "Unknown approval type" };

  let current: ApprovalItem | undefined;
  try {
    current = (await adapter.list(ctx)).find((i) => i.uid === uid);
  } catch (e: any) {
    // The caller has no queue for this kind (403/401): same answer as "not pending for you", not a server fault.
    if (e instanceof LoopbackError && (e.status === 401 || e.status === 403)) {
      return { ok: false, status: 409, message: "This request is no longer pending for you (already actioned, or moved to another stage)." };
    }
    return { ok: false, status: 502, message: `Could not re-check this request: ${e?.message ?? e}` };
  }
  if (!current) {
    invalidateApprovalCache(ctx.userId);
    return { ok: false, status: 409, message: "This request is no longer pending for you (already actioned, or moved to another stage)." };
  }
  if (current.viewOnly || current.meta?.viewOnly === true) {
    return { ok: false, status: 400, message: "This request needs more input — open it with View to decide." };
  }
  if ((action === "reject" && current.noReject) || (action === "approve" && current.noApprove)) {
    return { ok: false, status: 400, message: "This action is not available from here — open the request with View." };
  }
  const note = remarks.trim();
  const minReason = current.rejectMinLength ?? 3;
  if (action === "reject" && current.rejectNeedsReason && note.length < minReason) {
    return { ok: false, status: 400, message: minReason > 3 ? `A reason of at least ${minReason} characters is required to decline this request.` : "A reason is required to decline this request." };
  }
  try {
    await adapter.decide(ctx, { id: current.id, meta: current.meta }, action, note);
  } catch (e: any) {
    const status = e instanceof LoopbackError ? e.status : 500;
    return { ok: false, status, message: String(e?.message ?? "Action failed") };
  }
  invalidateApprovalCache(ctx.userId);
  return { ok: true };
}
