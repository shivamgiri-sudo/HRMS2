/**
 * A lazily-built, in-process index of the repository used to turn "which page was the user
 * on" into "which files could this change touch".
 *
 * WHAT IT BUILDS
 *   - route -> page component, parsed from src/config/routes/lazy.ts and the *.routes.tsx files
 *   - a forward import edge map  (file -> files it imports)
 *   - a reverse import edge map  (file -> files that import it), which is what makes the
 *     fan-in check (checklist BR-04) cheap
 *   - the /api/... string literals each page component mentions, which links a page to the
 *     backend routers it actually calls
 *
 * SCOPE, STATED HONESTLY
 *   This is the FAST pass: it reads only `import ... from "..."` lines and resolves path
 *   aliases, relative paths, directory index files and extensionless specifiers. It does
 *   NOT resolve re-exports through barrel files, dynamic import() with a computed specifier,
 *   or coupling that is not an import at all (DI containers, string-keyed registries).
 *
 *   That is sufficient for Phase 1, where the scan's job is to produce a risk verdict for a
 *   human triager and to hard-block deny-tier requests — and where the capability registry's
 *   keyword and table signals catch the domains that matter even when no import edge does.
 *   It is NOT sufficient for Phase 4, where the same index would decide which files an agent
 *   may edit. resolverMode is recorded on every scan for exactly this reason: a Phase 4 scan
 *   must record "typescript", and the gate can refuse anything scanned in "fast" mode.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { normalisePath, repoRoot } from "./control-plane.js";

export interface ImpactIndex {
  builtAt: number;
  /** file -> files it imports (repo-relative, normalised to "/") */
  forward: Map<string, Set<string>>;
  /** file -> files that import it */
  reverse: Map<string, Set<string>>;
  /** route path -> page component file */
  routeToComponent: Map<string, string>;
  /** file -> "/api/..." literals it mentions */
  apiLiterals: Map<string, Set<string>>;
  fileCount: number;
}

const SOURCE_ROOTS = ["backend/src", "src"];
const SOURCE_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", "coverage", "__snapshots__", ".next", ".turbo",
]);

// Rebuilt when older than this. The repository changes under a running dev server, and a
// scan reading a stale graph would classify against code that no longer exists.
const MAX_AGE_MS = 60_000;

let cached: ImpactIndex | null = null;

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (SOURCE_EXT.has(extname(e.name))) {
      out.push(full);
    }
  }
}

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*\(\s*["']([^"']+)["']\s*\)/g;
const API_LITERAL_RE = /["'`](\/api\/[A-Za-z0-9_\-/:.]*)["'`]/g;

/**
 * Resolve an import specifier to a repo-relative source file, or null for a package import.
 * Handles: "@/x" (frontend alias -> src/x), relative paths, the ".js" -> ".ts" rewrite the
 * backend's ESM+TS setup requires, extensionless specifiers, and directory index files.
 */
function resolveSpecifier(fromFile: string, spec: string, root: string, known: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = join(root, "src", spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolve(dirname(join(root, fromFile)), spec);
  } else {
    return null; // bare package specifier
  }

  const relBase = normalisePath(relative(root, base));
  const candidates = [relBase];

  // Backend ESM imports name ".js" but the file on disk is ".ts".
  if (relBase.endsWith(".js")) candidates.push(relBase.slice(0, -3) + ".ts");
  if (relBase.endsWith(".jsx")) candidates.push(relBase.slice(0, -4) + ".tsx");

  for (const ext of [".ts", ".tsx"]) candidates.push(relBase + ext);
  for (const ext of [".ts", ".tsx"]) candidates.push(`${relBase}/index${ext}`);

  for (const c of candidates) if (known.has(c)) return c;
  return null;
}

const LAZY_DECL_RE =
  /(?:const|let)\s+(\w+)\s*=\s*lazy(?:WithRecovery)?\s*\(\s*\(\)\s*=>\s*import\s*\(\s*["']([^"']+)["']/g;

function parseRoutes(root: string, known: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  const routesDir = join(root, "src/config/routes");

  let files: string[] = [];
  try {
    files = readdirSync(routesDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  } catch {
    return map;
  }

  /**
   * Collect `const NativeX = lazy(() => import("@/pages/NativeX"))` from EVERY routes file,
   * not just lazy.ts.
   *
   * In this repository lazy.ts exports the lazyWithRecovery helper and holds no component
   * declarations at all — each *.routes.tsx declares its own. Parsing only lazy.ts silently
   * produced an empty route->component map, which would have made the page the user was on
   * (the highest-confidence scan anchor) resolve to nothing while still looking like it
   * worked.
   */
  const componentByName = new Map<string, string>();
  for (const f of files) {
    const rel = `src/config/routes/${f}`;
    let src: string;
    try {
      src = readFileSync(join(routesDir, f), "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(LAZY_DECL_RE)) {
      const file = resolveSpecifier(rel, m[2], root, known);
      if (file) componentByName.set(m[1], file);
    }
  }

  // *.routes.tsx hold `<Route path="/x" element={<... <NativeX /> ...} />`
  for (const f of files) {
    let src: string;
    try {
      src = readFileSync(join(routesDir, f), "utf8");
    } catch {
      continue;
    }
    /**
     * For each `path="..."`, scan a fixed window of the following source for the first JSX
     * element whose name is a known lazy component.
     *
     * Deliberately window-based rather than delimiter-based. Terminating at the first "/>"
     * fails on the shape this repo actually uses:
     *   <Route path="/helpdesk" element={<ProtectedRoute><Gate ...><NativeHelpdesk /></...>} />
     * because the first "/>" belongs to the page component itself, so the captured tail
     * stops just before the only name that matters. Matching a window and filtering by
     * "is this a component I know about" skips the wrappers without having to model them.
     */
    for (const m of src.matchAll(/path\s*=\s*["']([^"']+)["']/g)) {
      const routePath = m[1];
      const from = (m.index ?? 0) + m[0].length;
      const windowSrc = src.slice(from, from + 400);
      const comp = [...windowSrc.matchAll(/<(\w+)[\s/>]/g)]
        .map((x) => x[1])
        .find((name) => componentByName.has(name));
      if (comp) {
        map.set(routePath.startsWith("/") ? routePath : `/${routePath}`, componentByName.get(comp)!);
      }
    }
  }
  return map;
}

export function buildImpactIndex(force = false): ImpactIndex {
  if (!force && cached && Date.now() - cached.builtAt < MAX_AGE_MS) return cached;

  const root = repoRoot();
  const abs: string[] = [];
  for (const r of SOURCE_ROOTS) {
    try {
      if (statSync(join(root, r)).isDirectory()) walk(join(root, r), abs);
    } catch {
      /* a root that does not exist in this checkout is simply skipped */
    }
  }

  const files = abs.map((a) => normalisePath(relative(root, a)));
  const known = new Set(files);

  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const apiLiterals = new Map<string, Set<string>>();

  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    let src: string;
    try {
      src = readFileSync(abs[i], "utf8");
    } catch {
      continue;
    }

    const deps = new Set<string>();
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const target = resolveSpecifier(rel, spec, root, known);
      if (target) deps.add(target);
    }
    forward.set(rel, deps);
    for (const d of deps) {
      let r = reverse.get(d);
      if (!r) reverse.set(d, (r = new Set()));
      r.add(rel);
    }

    const apis = new Set<string>();
    for (const m of src.matchAll(API_LITERAL_RE)) apis.add(m[1]);
    if (apis.size) apiLiterals.set(rel, apis);
  }

  cached = {
    builtAt: Date.now(),
    forward,
    reverse,
    routeToComponent: parseRoutes(root, known),
    apiLiterals,
    fileCount: files.length,
  };
  return cached;
}

/** Number of distinct files importing this one — the fan-in behind checklist BR-04. */
export function fanIn(file: string, index: ImpactIndex): number {
  return index.reverse.get(normalisePath(file))?.size ?? 0;
}

/** Direct imports of a file, one level deep. Deliberately not transitive: the transitive
 *  closure of a shared util is most of the repository, which tells a reviewer nothing. */
export function directDependencies(file: string, index: ImpactIndex): string[] {
  return [...(index.forward.get(normalisePath(file)) ?? [])];
}

export function componentForRoute(route: string, index: ImpactIndex): string | null {
  if (index.routeToComponent.has(route)) return index.routeToComponent.get(route)!;
  // Try the parameterised form: /employee-stat-card/123 -> /employee-stat-card/:id
  for (const [pattern, file] of index.routeToComponent) {
    if (!pattern.includes(":")) continue;
    const re = new RegExp("^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$");
    if (re.test(route)) return file;
  }
  return null;
}

/** Backend router files whose path plausibly serves one of the given /api literals. */
export function backendFilesForApiPaths(apiPaths: string[], index: ImpactIndex): string[] {
  const out = new Set<string>();
  for (const api of apiPaths) {
    const segment = api.replace(/^\/api\//, "").split("/")[0];
    if (!segment || segment.length < 3) continue;
    for (const f of index.forward.keys()) {
      if (!f.startsWith("backend/src/modules/")) continue;
      if (f.includes(`/${segment}/`) && /\.routes\.ts$/.test(f)) out.add(f);
    }
  }
  return [...out];
}

/** Test seam: drop the cache so a test can rebuild against a fixture tree. */
export function resetImpactIndex(): void {
  cached = null;
}
