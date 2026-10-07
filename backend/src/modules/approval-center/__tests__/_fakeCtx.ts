import type { LoopbackCtx } from "../types.js";
import { LoopbackError } from "../types.js";

export interface Call { method: string; path: string; query?: Record<string, unknown>; body?: any }

/** Fake loopback: routes maps "METHOD /path" to a payload or a function. Unmatched => 404 LoopbackError. */
export function fakeCtx(routes: Record<string, unknown | ((c: Call) => unknown)>, userId = "me-user") {
  const calls: Call[] = [];
  const ctx: LoopbackCtx = {
    userId,
    async call(method, path, opts) {
      const call: Call = { method, path, query: opts?.query, body: opts?.body };
      calls.push(call);
      const key = `${method} ${path}`;
      if (!(key in routes)) throw new LoopbackError(404, `no route ${key}`);
      const v = routes[key];
      const out = typeof v === "function" ? (v as (c: Call) => unknown)(call) : v;
      if (out instanceof Error) throw out;
      return out as any;
    },
  };
  return { ctx, calls };
}
