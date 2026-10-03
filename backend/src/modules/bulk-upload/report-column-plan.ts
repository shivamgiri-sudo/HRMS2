/**
 * Schema-tolerant column mapping for dialer / MIS exports whose layout drifts: columns reordered, renamed, dropped, or the same header
 * appearing twice. Instead of trusting header text, a plan is built once per batch from the staged rows:
 *
 *   1. exact      normalised header == canonical name (case / space / punctuation blind)
 *   2. alias      normalised header is a known synonym ("AGENT ID" for ID)
 *   3. fuzzy      one edit-distance-close header, unique best match only ("LOGOUT TIME" typo -> "Logout")
 *   4. profile    for identity columns only (employee code, person name), from what the values look like
 *   5. resolver   headers that collide after normalisation (two "Login" columns) are told apart by their values
 *
 * Nothing is guessed silently: the plan reports what mapped how, what is missing, what was not recognised, and a report that
 * does not look like the expected one at all fails the batch rather than importing the wrong columns.
 */
import { normalizeKey as baseNormalize } from "./dalmia-import-helpers.js";

/** Like the shared normaliser, but a "%" is kept as a word: "WAIT %" (a share of time) must never collide with "WAIT" (a duration). */
const normalizeKey = (k: string): string => baseNormalize(k.replace(/%/g, " pct "));

export type ColKind = "id" | "name" | "other";
export interface ColumnSpec { canonical: string; aliases?: string[]; kind?: ColKind; required?: boolean }
export type MapVia = "exact" | "alias" | "fuzzy" | "profile" | "value";
export interface PlanReport {
  mapped: Array<{ source: string; canonical: string; via: MapVia }>;
  /** Canonical columns no source column was found for (their cells are left empty / derived). */
  missing: string[];
  /** Source columns that matched nothing (ignored). */
  unrecognised: string[];
  notes: string[];
}
export interface ColumnPlan { rename: Map<string, string>; report: PlanReport; fatal: string | null }

/** Tells apart source columns that normalise to the same key. Receives the colliding source keys and a lookup of already-mapped columns. */
export type Resolver = (keys: string[], ctx: { sample: Array<Record<string, unknown>>; sourceOf: (canonical: string) => string | undefined }) =>
  { assign: Record<string, string>; note?: string };

export interface PlanOptions {
  /** Fewer recognised columns than this and the file is not the expected report. */
  minRecognised?: number;
  /** Keyed by the shared normalised key (e.g. "login"). */
  resolvers?: Record<string, Resolver>;
  fuzzyMin?: number;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n]!;
}
export const similarity = (a: string, b: string): number => (a || b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);

const present = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";

/** Header text with a duplicate-column suffix removed ("Login_1" -> "Login") when another header shares the base. */
function baseOf(key: string, allKeys: string[]): string {
  const stripped = key.replace(/[_.]\d+$/, "");
  if (stripped !== key && allKeys.some((k) => k !== key && normalizeKey(k) === normalizeKey(stripped))) return normalizeKey(stripped);
  return normalizeKey(key);
}

const looksLikeCode = (v: unknown): boolean => /^[A-Za-z]{1,5}\d{3,}$/.test(String(v ?? "").trim());
const looksLikeName = (v: unknown): boolean => /^[A-Za-z][A-Za-z .'-]{2,}$/.test(String(v ?? "").trim()) && !/^totals?$/i.test(String(v ?? "").trim());

export function buildColumnPlan(sample: Array<Record<string, unknown>>, specs: ColumnSpec[], opts: PlanOptions = {}): ColumnPlan {
  const keys = [...new Set(sample.flatMap((r) => Object.keys(r)))];
  const rename = new Map<string, string>();
  const mapped: PlanReport["mapped"] = [];
  const notes: string[] = [];
  const taken = new Set<string>();           // canonical names already assigned
  const used = new Set<string>();            // source keys already assigned
  const assign = (source: string, canonical: string, via: MapVia) => {
    rename.set(source, canonical); mapped.push({ source, canonical, via }); taken.add(canonical); used.add(source);
  };

  const specKey = new Map<string, ColumnSpec[]>();    // normalised canonical/alias -> specs
  for (const sp of specs) for (const n of [sp.canonical, ...(sp.aliases ?? [])].map(normalizeKey)) specKey.set(n, [...(specKey.get(n) ?? []), sp]);
  const base = new Map(keys.map((k) => [k, baseOf(k, keys)] as const));

  // Collisions: more than one source column, or more than one canonical column, behind one normalised key.
  const bySharedKey = new Map<string, string[]>();
  for (const k of keys) bySharedKey.set(base.get(k)!, [...(bySharedKey.get(base.get(k)!) ?? []), k]);
  const collided = new Set<string>();
  for (const [nk, ks] of bySharedKey) {
    const sps = [...new Set((specKey.get(nk) ?? []).map((s) => s.canonical))];
    if (ks.length > 1 || sps.length > 1) collided.add(nk);
  }

  // 1-2. exact and alias, skipping collisions (the resolver decides those).
  for (const k of keys) {
    const nk = base.get(k)!; if (collided.has(nk)) continue;
    const sp = specKey.get(nk)?.[0]; if (!sp || taken.has(sp.canonical)) continue;
    assign(k, sp.canonical, normalizeKey(sp.canonical) === nk ? "exact" : "alias");
  }

  // 3. fuzzy: unique best, close enough, nothing else equally close.
  const fuzzyMin = opts.fuzzyMin ?? 0.84;
  for (const k of keys) {
    if (used.has(k) || collided.has(base.get(k)!)) continue;
    const nk = base.get(k)!; if (nk.length < 4) continue;
    const scored = specs.filter((s) => !taken.has(s.canonical)).map((s) => ({ s, sc: Math.max(...[s.canonical, ...(s.aliases ?? [])].map((n) => similarity(nk, normalizeKey(n)))) }))
      .filter((x) => x.sc >= fuzzyMin).sort((a, b) => b.sc - a.sc);
    if (scored.length === 1 || (scored.length > 1 && scored[0]!.sc - scored[1]!.sc >= 0.08)) assign(k, scored[0]!.s.canonical, "fuzzy");
  }

  // 4. profile: identity columns only (a wrong guess on a metric would corrupt numbers; on an identity it fails loudly).
  const prof = (kind: ColKind, test: (v: unknown) => boolean, unique: boolean) => {
    const sp = specs.find((s) => s.kind === kind && !taken.has(s.canonical)); if (!sp) return;
    const cands = keys.filter((k) => !used.has(k) && !collided.has(base.get(k)!)).filter((k) => {
      const vals = sample.map((r) => r[k]).filter(present);
      if (vals.length < 3) return false;
      const ok = vals.filter(test).length / vals.length >= 0.8;
      return ok && (!unique || new Set(vals.map(String)).size / vals.length >= 0.9);
    });
    if (cands.length === 1) assign(cands[0]!, sp.canonical, "profile");
  };
  prof("id", looksLikeCode, true);
  prof("name", looksLikeName, false);

  // 5. resolvers for collided keys.
  const sourceOf = (canonical: string) => [...rename.entries()].find(([, c]) => c === canonical)?.[0];
  for (const nk of collided) {
    const ks = (bySharedKey.get(nk) ?? []).filter((k) => !used.has(k));
    const res = opts.resolvers?.[nk];
    if (ks.length === 0) continue;
    if (res) {
      const out = res(ks, { sample, sourceOf });
      for (const [src, can] of Object.entries(out.assign)) if (!taken.has(can)) assign(src, can, "value");
      if (out.note) notes.push(out.note);
    } else {
      const sp = specKey.get(nk)?.[0]; if (sp && !taken.has(sp.canonical)) assign(ks[0]!, sp.canonical, "exact");
      if (ks.length > 1) notes.push(`Header "${ks[1]}" repeats "${ks[0]}"; only the first was used.`);
    }
  }

  const missing = specs.filter((s) => !taken.has(s.canonical)).map((s) => s.canonical);
  const unrecognised = keys.filter((k) => !used.has(k));
  const missingRequired = specs.filter((s) => s.required && !taken.has(s.canonical)).map((s) => s.canonical);
  let fatal: string | null = null;
  if (missingRequired.length) fatal = `Required column(s) not found: ${missingRequired.join(", ")}. Headers seen: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? " ..." : ""}.`;
  else if (mapped.length < (opts.minRecognised ?? 1)) fatal = `Only ${mapped.length} of the expected columns were recognised; this does not look like the expected report. Headers seen: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? " ..." : ""}.`;
  return { rename, report: { mapped, missing, unrecognised, notes }, fatal };
}

/** Re-keys a row by the plan, keeping only the recognised columns. */
export function applyPlan(row: Record<string, unknown>, plan: ColumnPlan): Record<string, unknown> {
  // Unrecognised columns are dropped, not passed through: a later name-based pass must not be able to fill a canonical column the
  // file really lacks from a look-alike (a "WAIT %" share into WAIT seconds).
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const c = plan.rename.get(k);
    if (c && !present(out[c])) out[c] = v;
  }
  return out;
}

/** One short human summary of a plan, stored with the batch so an operator can see what was assumed. */
export function describePlan(plan: ColumnPlan, expected: number): string[] {
  const r = plan.report; const lines: string[] = [];
  const viaCount = (v: MapVia) => r.mapped.filter((m) => m.via === v);
  lines.push(`Columns mapped: ${r.mapped.length} of ${expected}.`);
  for (const v of ["alias", "fuzzy", "profile", "value"] as MapVia[]) {
    const m = viaCount(v);
    if (m.length) lines.push(`Matched by ${v === "value" ? "cell values" : v === "profile" ? "content" : v}: ${m.map((x) => `"${x.source}" -> ${x.canonical}`).join(", ")}.`);
  }
  if (r.missing.length) lines.push(`Not in this file (left empty or derived): ${r.missing.join(", ")}.`);
  if (r.unrecognised.length) lines.push(`Ignored columns: ${r.unrecognised.slice(0, 10).join(", ")}${r.unrecognised.length > 10 ? ` and ${r.unrecognised.length - 10} more` : ""}.`);
  lines.push(...r.notes);
  return lines;
}
