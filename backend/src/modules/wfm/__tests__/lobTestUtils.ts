/**
 * Shared helpers for the LOB-filter route tests: pull a handler out of an express Router and
 * call it with a fake req/res.
 */
export const LOB_UUID = '123e4567-e89b-12d3-a456-426614174000';

export type Captured = { sql: string; params: unknown[] };

export const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

export function getHandler(router: any, method: 'get' | 'post', path: string) {
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route ${method} ${path} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any, next: any) => Promise<void>;
}

export async function callHandler(
  handler: (req: any, res: any, next: any) => unknown,
  req: { query?: Record<string, unknown>; params?: Record<string, string>; authUser?: unknown }
) {
  const out: { status: number; body: any; next: unknown } = { status: 200, body: undefined, next: undefined };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
  };
  await handler({ query: {}, params: {}, authUser: { id: 'u1', role: 'wfm' }, ...req }, res, (e: unknown) => { out.next = e; });
  return out;
}

/** Placeholders (?) that precede `fragment` in `sql` must equal the index of `value` in params. */
export function expectParamPosition(call: Captured, fragment: string, value: unknown) {
  const idx = call.sql.indexOf(fragment);
  if (idx < 0) throw new Error(`fragment ${fragment} not in SQL`);
  const before = (call.sql.slice(0, idx).match(/\?/g) ?? []).length;
  if (call.params.indexOf(value) !== before) {
    throw new Error(`param order wrong: ${before} placeholders precede fragment but value index is ${call.params.indexOf(value)}`);
  }
}
