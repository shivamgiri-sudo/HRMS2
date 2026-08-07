/**
 * The durable job runner for the UAT pipeline.
 *
 * WHY A QUEUE AT ALL
 *   Validation is an outbound call to an external API that can take a minute and fail
 *   halfway. Running it inside the submit request makes a UAT user watch a spinner, and a
 *   restart mid-call loses the work — which in this codebase means the item sits in
 *   `validating` forever with nobody aware. That silent-stall shape is the dominant defect
 *   class here, so the queue exists specifically to make it impossible.
 *
 * LEASING, NOT A STATUS FLAG
 *   A claimed job carries a `leased_until` timestamp. A worker killed mid-job releases its
 *   work by the clock, with no cleanup routine that would itself have to survive the crash.
 *   The claim is a single UPDATE with a WHERE that both selects and locks, so two workers
 *   racing produce one winner and one no-op — not a duplicate call to a paid API.
 *
 * BOUNDED RETRIES AND A DEAD STATE
 *   A job that exhausts max_attempts becomes `dead`, not `queued`. Dead is visible on the
 *   health endpoint. An unbounded retry against a refusal would spend the daily budget
 *   overnight and still be wrong in the morning.
 *
 * REGISTERED IN all-workers.ts AND NOWHERE ELSE.
 *   A worker present in only one of server.ts / all-workers.ts silently never runs; that
 *   killed the biometric payroll feed for weeks. uat-worker-registration.test.ts asserts
 *   single registration.
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type UatJobType = "validate" | "checklist" | "prompt_write" | "dispatch" | "reconcile";

export interface UatJob {
  id: string;
  jobType: UatJobType;
  feedbackId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

interface JobRow extends RowDataPacket {
  id: string;
  job_type: UatJobType;
  feedback_id: string | null;
  payload_json: string | Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
}

const LEASE_SECONDS = 600;
const POLL_INTERVAL_MS = 15_000;
/** Identifies which process holds a lease, so a stuck job names its holder in the console. */
const OWNER = `${process.pid}-${randomUUID().slice(0, 8)}`;

export type JobHandler = (job: UatJob) => Promise<void>;

const handlers = new Map<UatJobType, JobHandler>();

/** Handlers are registered rather than imported so the runner does not depend on the stages. */
export function registerJobHandler(type: UatJobType, handler: JobHandler): void {
  handlers.set(type, handler);
}

/**
 * Enqueue, idempotently.
 *
 * INSERT IGNORE on the unique idempotency key: a double submit, a retry from an impatient
 * user, or a redelivered callback all collapse to one job. Returns false when the job
 * already existed, so the caller can tell "queued" from "already queued" without a second
 * query.
 */
export async function enqueue(input: {
  jobType: UatJobType;
  feedbackId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  runAfter?: Date;
  maxAttempts?: number;
}): Promise<{ queued: boolean }> {
  const [res] = await db.query(
    `INSERT IGNORE INTO uat_job
       (job_type, feedback_id, payload_json, idempotency_key, run_after, max_attempts)
     VALUES (?,?,?,?,?,?)`,
    [
      input.jobType,
      input.feedbackId ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.idempotencyKey.slice(0, 190),
      input.runAfter ?? new Date(),
      input.maxAttempts ?? 3,
    ]
  );
  return { queued: (res as { affectedRows?: number }).affectedRows === 1 };
}

/**
 * Claim one job.
 *
 * The UPDATE ... ORDER BY ... LIMIT 1 pattern is the claim: MySQL locks the row it updates,
 * so concurrent workers serialise on it. Selecting first and updating second would let two
 * workers read the same row before either wrote — the classic double-dispatch, and here it
 * would mean paying twice for the same LLM call.
 *
 * The WHERE reclaims expired leases in the same statement, so crash recovery needs no
 * separate sweeper.
 */
export async function claimJob(): Promise<UatJob | null> {
  const claimId = randomUUID();
  const [res] = await db.query(
    `UPDATE uat_job
        SET state = 'leased',
            lease_owner = ?,
            leased_until = DATE_ADD(NOW(), INTERVAL ? SECOND),
            attempts = attempts + 1,
            last_error = CONCAT('claim:', ?)
      WHERE (state = 'queued' AND run_after <= NOW())
         OR (state = 'leased' AND leased_until < NOW())
      ORDER BY run_after
      LIMIT 1`,
    [OWNER, LEASE_SECONDS, claimId]
  );
  if ((res as { affectedRows?: number }).affectedRows !== 1) return null;

  const [rows] = await db.query<JobRow[]>(
    `SELECT id, job_type, feedback_id, payload_json, attempts, max_attempts
       FROM uat_job
      WHERE lease_owner = ? AND last_error = ?
      LIMIT 1`,
    [OWNER, `claim:${claimId}`]
  );
  if (!rows.length) return null;

  const r = rows[0];
  return {
    id: r.id,
    jobType: r.job_type,
    feedbackId: r.feedback_id,
    payload:
      typeof r.payload_json === "string"
        ? (JSON.parse(r.payload_json) as Record<string, unknown>)
        : ((r.payload_json ?? {}) as Record<string, unknown>),
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  };
}

export async function completeJob(id: string): Promise<void> {
  await db.query(
    `UPDATE uat_job SET state='done', leased_until=NULL, lease_owner=NULL, last_error=NULL
      WHERE id = ?`,
    [id]
  );
}

/**
 * Fail a job.
 *
 * `terminal` is for failures where retrying cannot help — a model refusal, a deny-tier item,
 * a malformed payload. Those go straight to `dead` rather than burning two more attempts to
 * arrive at the same answer.
 *
 * Retryable failures back off exponentially from one minute, so a provider outage does not
 * become a tight loop against a paid API.
 */
export async function failJob(
  job: UatJob,
  error: string,
  terminal = false
): Promise<"retry" | "dead"> {
  const exhausted = terminal || job.attempts >= job.maxAttempts;
  if (exhausted) {
    await db.query(
      `UPDATE uat_job SET state='dead', leased_until=NULL, lease_owner=NULL, last_error=?
        WHERE id = ?`,
      [error.slice(0, 1000), job.id]
    );
    return "dead";
  }
  const backoffSeconds = 60 * Math.pow(2, Math.max(0, job.attempts - 1));
  await db.query(
    `UPDATE uat_job
        SET state='queued', leased_until=NULL, lease_owner=NULL, last_error=?,
            run_after = DATE_ADD(NOW(), INTERVAL ? SECOND)
      WHERE id = ?`,
    [error.slice(0, 1000), backoffSeconds, job.id]
  );
  return "retry";
}

/**
 * Run one job if one is available. Exported separately from the loop so a test can drive a
 * single tick deterministically, and so an operator can prod the queue from a route.
 */
export async function runOnce(): Promise<"idle" | "done" | "retry" | "dead"> {
  const job = await claimJob();
  if (!job) return "idle";

  const handler = handlers.get(job.jobType);
  if (!handler) {
    // An unregistered type is a wiring bug, not a transient fault: the same job would fail
    // identically on every retry. Dead immediately, and loudly.
    console.error(`[uat-job] no handler registered for job_type "${job.jobType}" (job ${job.id})`);
    await failJob(job, `No handler registered for job type "${job.jobType}".`, true);
    return "dead";
  }

  try {
    await handler(job);
    await completeJob(job.id);
    return "done";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A handler signals "do not retry" by setting .terminal on the error it throws.
    const terminal = Boolean((error as { terminal?: boolean })?.terminal);
    const outcome = await failJob(job, message, terminal);
    console.error(`[uat-job] ${job.jobType} ${job.id} failed (${outcome}): ${message}`);
    return outcome;
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return; // a slow job must not overlap its own next poll
  running = true;
  try {
    // Drain rather than one-per-poll: a burst of submissions should not take a minute per
    // item to clear. Bounded so one worker cannot monopolise the process.
    for (let i = 0; i < 5; i++) {
      const result = await runOnce();
      if (result === "idle") break;
    }
  } catch (error) {
    console.error("[uat-job] runner tick failed:", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

export function startUatJobRunner(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  // unref so a pending poll never holds the process open during a graceful shutdown.
  timer.unref?.();
  console.log(`[uat-job] runner started (owner ${OWNER}, poll ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopUatJobRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Queue depth by state, for GET /api/uat/health. */
export async function jobHealth(): Promise<Record<string, number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT state, COUNT(*) AS c FROM uat_job GROUP BY state`
  );
  const out: Record<string, number> = { queued: 0, leased: 0, done: 0, failed: 0, dead: 0 };
  for (const r of rows) out[String(r.state)] = Number(r.c);
  return out;
}
