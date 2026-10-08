/**
 * A worker that checks out a pooled connection must return it on every path.
 *
 * All 45 workers registered in all-workers.ts share ONE mysql2 pool of 25 connections
 * (DB_POOL_MAX=25 in production). So a single worker that leaks one connection per poll takes
 * down every other worker in the process within about half an hour, and stays down until
 * somebody restarts it.
 *
 * That is not hypothetical. report-email-delivery claimed a connection, found no queued rows --
 * the branch that runs on almost every poll -- and `return`ed without releasing:
 *
 *     if (!rows.length) {
 *       await conn.rollback();
 *       return;              // <- connection never returned to the pool
 *     }
 *
 * Measured on production 2026-08-12: the workers process held 26 connections, 31 of the
 * server's 33 connections were asleep, and the oldest had been idle 7,967 seconds -- almost
 * exactly the process uptime, i.e. leaked shortly after boot and never reclaimed. MySQL itself
 * was using 33 of 300 available connections, so the database was never the constraint. Report
 * generation, report email delivery and performance ingestion had been failing every minute
 * with "Queue limit reached" since 2026-07-27 -- 25,631 logged failures across sixteen days.
 *
 * The diagnosis was only possible because the circuit breaker had started naming its cause;
 * before that fix every one of those trips logged "Tripped by: UNKNOWN: ".
 *
 * This is a source-level contract because the failure is structural: the leak is a missing
 * `finally`, and a behavioural test of one worker would not stop the forty-sixth from
 * reintroducing it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const WORKERS_DIR = path.resolve(__dirname, "..");

/** Source with comments stripped — these files DISCUSS release() in prose. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function workerFiles(): string[] {
  return readdirSync(WORKERS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(WORKERS_DIR, f));
}

/**
 * Files that check a connection out of the shared pool.
 *
 * `db.getConnection()` is the only way to hold one across statements; `db.execute()` borrows and
 * returns internally and cannot leak.
 */
function acquiringWorkers(): Array<{ file: string; src: string; acquisitions: number }> {
  return workerFiles()
    .map((file) => ({ file, src: strip(readFileSync(file, "utf8")) }))
    .map((w) => ({ ...w, acquisitions: (w.src.match(/\.getConnection\(\)/g) ?? []).length }))
    .filter((w) => w.acquisitions > 0);
}

describe("every worker returns pooled connections on all paths", () => {
  it("still has workers that check out connections, or this suite guards nothing", () => {
    expect(acquiringWorkers().length).toBeGreaterThan(0);
  });

  it("releases in a finally, not on the happy path only", () => {
    const offenders = acquiringWorkers()
      .filter((w) => {
        const finallyReleases = (w.src.match(/finally\s*\{[^}]*?\.release\(\)/gs) ?? []).length;
        return finallyReleases < w.acquisitions;
      })
      .map((w) => path.basename(w.file));

    expect(
      offenders,
      "a worker checking out a connection must release it in a finally — an early return or a " +
        "throwing rollback otherwise leaks it, and 45 workers share one pool of 25",
    ).toEqual([]);
  });

  it("does not also release outside the finally, which would return a connection twice", () => {
    // Double release hands the same connection to two callers — corruption, not starvation, and
    // far harder to see than the leak it replaces.
    const offenders = acquiringWorkers()
      .filter((w) => {
        const total = (w.src.match(/\.release\(\)/g) ?? []).length;
        const inFinally = (w.src.match(/finally\s*\{[^}]*?\.release\(\)/gs) ?? []).length;
        return total > inFinally;
      })
      .map((w) => path.basename(w.file));

    expect(offenders, "release() appears outside its finally — risk of a double release").toEqual([]);
  });

  it("never lets a failing rollback mask the original error", () => {
    // `await conn.rollback()` inside a catch throws when the connection is broken, replacing the
    // real failure with a rollback error — which is how the underlying cause stays invisible.
    const offenders = acquiringWorkers()
      .filter((w) => /catch[^{]*\{[^}]*await\s+conn\.rollback\(\)\s*;/s.test(w.src))
      .map((w) => path.basename(w.file));

    expect(
      offenders,
      "guard rollback in a catch handler (.catch(() => undefined)) so the real error survives",
    ).toEqual([]);
  });
});
