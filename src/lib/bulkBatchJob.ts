/**
 * Client side of the bulk-upload background jobs.
 *
 * Importing or approving a batch runs a domain engine once per row, so a few hundred
 * rows take minutes. Those two calls used to be awaited directly and died at nginx's
 * 60s proxy timeout — the browser showed "502 Bad Gateway" while the server was still
 * applying rows perfectly well, and the user had no way to find out whether their
 * 217-row batch had gone through.
 *
 * The endpoints now answer 202 straight away and the work continues server-side; this
 * helper does the waiting, by polling a status endpoint until the batch reaches a
 * terminal state. Nothing here holds an HTTP request open, so no proxy timeout applies
 * however long the batch takes.
 */
import { hrmsApi } from "@/lib/hrmsApi";

export interface BatchJobProgress {
  /** Rows to get through, or null when the operation cannot be counted. */
  total: number | null;
  processed: number | null;
  succeeded: number | null;
  failed: number | null;
}

export interface BatchJobStatus {
  success?: boolean;
  phase: "running" | "done" | "failed" | "idle";
  job?: string;
  batch_status?: string;
  approval_status?: string | null;
  progress?: BatchJobProgress;
  errors?: string[];
  error?: string;
  message?: string | null;
  result?: unknown;
}

/** The 202 body an import/approve/reject call now returns. */
export interface BatchJobStarted {
  processing?: boolean;
  job?: string;
  batch_id?: string;
  total_rows?: number | null;
  message?: string;
}

export function isBatchJobStarted(res: unknown): res is BatchJobStarted {
  return Boolean((res as BatchJobStarted | null)?.processing);
}

/** "Applying 128 of 217 rows…" — or a bare phase when the rows cannot be counted. */
export function describeProgress(progress: BatchJobProgress | undefined, verb: string): string {
  if (!progress || progress.processed === null || !progress.total) return `${verb}…`;
  return `${verb} ${progress.processed} of ${progress.total} rows…`;
}

export interface PollOptions {
  onProgress?: (status: BatchJobStatus) => void;
  intervalMs?: number;
  /** Give up after this long. Generous: a 2,000-row batch is legitimately slow. */
  timeoutMs?: number;
}

/**
 * Poll `statusPath` until the job finishes, then return its final status.
 *
 * A failed poll is not a failed job — a dropped wifi packet must not report a
 * successful approval as an error — so transient errors are tolerated and only a run
 * of consecutive failures gives up.
 */
export async function pollBatchJob(
  statusPath: string,
  options: PollOptions = {},
): Promise<BatchJobStatus> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  let consecutiveFailures = 0;
  let sawRunning = false;

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    let status: BatchJobStatus;
    try {
      status = await hrmsApi.get<BatchJobStatus>(statusPath, 20000);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      if (consecutiveFailures >= 5) {
        throw new Error(
          `Lost contact with the server while the batch was still processing (${
            err instanceof Error ? err.message : String(err)
          }). The work is most likely still running — refresh this page in a minute to see the result.`,
        );
      }
      continue;
    }

    if (status.phase === "running") sawRunning = true;
    options.onProgress?.(status);

    if (status.phase === "done" || status.phase === "failed") return status;

    // 'idle' means the batch is not claimed and has not been decided. Right after a
    // 202 that is just the claim not being visible yet; once the job has been seen
    // running, it means the work ended without recording a decision.
    if (status.phase === "idle" && sawRunning) return status;

    if (Date.now() > deadline) {
      throw new Error(
        "This batch is taking unusually long. It is still processing on the server — refresh the page in a few minutes to see the result.",
      );
    }
  }
}
