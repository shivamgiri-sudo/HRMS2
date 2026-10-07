import type { LoopbackCtx } from "../types.js";

export interface Call { method: string; path: string; query?: Record<string, unknown>; body?: unknown }

/** Fake loopback: routes[`${METHOD} ${path}`] is a payload or a function; every call is recorded. */
export function fakeCtx(routes: Record<string, unknown>, userId = "u-caller") {
  const calls: Call[] = [];
  const ctx: LoopbackCtx = {
    userId,
    async call(method, path, opts) {
      calls.push({ method, path, query: opts?.query, body: opts?.body });
      const hit = routes[`${method} ${path}`];
      if (hit === undefined) throw Object.assign(new Error(`no route ${method} ${path}`), { status: 403 });
      return (typeof hit === "function" ? (hit as (o: unknown) => unknown)(opts) : hit) as never;
    },
  };
  return { ctx, calls };
}
