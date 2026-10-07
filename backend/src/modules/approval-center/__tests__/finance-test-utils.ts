import type { LoopbackCtx } from "../types.js";

export interface Call { method: string; path: string; query?: any; body?: any }

/** Fake ctx: routes "METHOD path" to a canned payload (or function) and records every call. */
export function fakeCtx(routes: Record<string, any>, userId = "u-me") {
  const calls: Call[] = [];
  const ctx: LoopbackCtx = {
    userId,
    async call(method, path, opts) {
      calls.push({ method, path, query: opts?.query, body: opts?.body });
      const key = `${method} ${path}`;
      if (!(key in routes)) throw new Error(`unexpected call ${key}`);
      const v = routes[key];
      return typeof v === "function" ? v(opts) : v;
    },
  } as LoopbackCtx;
  return { ctx, calls };
}

export const field = (item: { fields: Array<{ label: string; value: string }> }, label: string) =>
  item.fields.find((x) => x.label === label)?.value;
