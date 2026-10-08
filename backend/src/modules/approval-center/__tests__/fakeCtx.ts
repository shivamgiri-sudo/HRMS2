import { vi } from "vitest";
import { LoopbackError, type LoopbackCtx } from "../types.js";

export type Call = { method: string; path: string; query?: Record<string, unknown>; body?: unknown };

/** Fake loopback ctx. `routes` maps "METHOD /path" to a payload (or a function of the call); unknown routes 404. */
export function makeCtx(routes: Record<string, unknown | ((c: Call) => unknown)> = {}, userId = "u-1") {
  const calls: Call[] = [];
  const call = vi.fn(async (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}) => {
    const c: Call = { method, path, query: opts.query, body: opts.body };
    calls.push(c);
    const key = `${method} ${path}`;
    if (!(key in routes)) throw new LoopbackError(404, `no route ${key}`);
    const v = routes[key];
    const out = typeof v === "function" ? (v as (c: Call) => unknown)(c) : v;
    if (out instanceof Error) throw out;
    return out;
  });
  return { ctx: { userId, call } as unknown as LoopbackCtx, calls };
}
