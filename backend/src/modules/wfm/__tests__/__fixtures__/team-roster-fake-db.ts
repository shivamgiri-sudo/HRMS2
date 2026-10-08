/**
 * A scripted SQL router for the Team Roster tests. No database is touched: each test declares which
 * SQL text (regex) answers with which rows, and can inspect every statement that was executed.
 * An unrouted statement throws, so a test never passes by silently receiving an empty result.
 */
import { vi } from "vitest";

export type Route = [RegExp, (sql: string, params: any[]) => any];

export interface FakeDb {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  getConnection: ReturnType<typeof vi.fn>;
  conn: {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  routes: Route[];
  /** Every executed statement (pool and connection alike), in order. */
  log: Array<{ sql: string; params: any[] }>;
  on(pattern: RegExp, answer: (sql: string, params: any[]) => any): void;
  reset(): void;
  statements(pattern: RegExp): Array<{ sql: string; params: any[] }>;
}

export const rows = (data: any[]) => [data, []];
export const header = (extra: Record<string, unknown> = {}) => [{ affectedRows: 1, insertId: 1, ...extra }, []];

export function createFakeDb(): FakeDb {
  const routes: Route[] = [];
  const log: Array<{ sql: string; params: any[] }> = [];
  const run = async (sql: string, params: any[] = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    log.push({ sql: text, params });
    for (const [pattern, answer] of routes) {
      if (pattern.test(text)) {
        const out = answer(text, params);
        if (out instanceof Error) throw out;
        return out;
      }
    }
    throw new Error(`Unrouted SQL in test: ${text.slice(0, 200)}`);
  };
  const conn = {
    execute: vi.fn(run),
    query: vi.fn(async () => [[{ acquired: 1 }], []]),
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
  };
  const fake: FakeDb = {
    execute: vi.fn(run),
    query: vi.fn(async () => [[], []]),
    getConnection: vi.fn(async () => conn),
    conn,
    routes,
    log,
    on(pattern, answer) {
      routes.unshift([pattern, answer]);
    },
    reset() {
      routes.length = 0;
      log.length = 0;
      conn.beginTransaction.mockClear();
      conn.commit.mockClear();
      conn.rollback.mockClear();
      conn.release.mockClear();
    },
    statements(pattern) {
      return log.filter((l) => pattern.test(l.sql));
    },
  };
  return fake;
}
