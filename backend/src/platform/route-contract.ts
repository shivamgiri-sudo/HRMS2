/**
 * Route contract: does every API path the frontend calls actually exist?
 *
 * Three separate production bugs in one week were a client calling a path the
 * backend never served — the salary-certificate page on /api/payroll/certificates
 * when the router mounts at /api/payroll/salary-certificates, the BGV review on a
 * flat path instead of the nested one, and the recruiter workspace on a
 * resend-token endpoint that was never written. Each was invisible until a user
 * clicked, because nothing compares the two sides.
 *
 * Worse, they are invisible to probing too: clientRouter applies requireAuth on
 * the bare /api prefix, so an unauthenticated request to a route that does not
 * exist returns 401 exactly like a real one. Only the registered route table can
 * settle it, which is what this module reads.
 *
 * The comparison is deliberately conservative — it reports a path as missing only
 * when it can be certain, so that a failure always means a real defect:
 *   - only literal paths are extracted; a fully dynamic URL is skipped, not guessed
 *   - a `${...}` segment matches any single backend `:param` and vice versa
 *   - query strings are ignored (the backend never routes on them)
 */

/** One API call found in frontend source. */
export type FrontendCall = {
  method: string;
  path: string;
  /** Repo-relative file the call was found in. */
  file: string;
  line: number;
};

/** One route registered on the Express app. */
export type RegisteredRoute = {
  method: string;
  path: string;
};

const HTTP_VERBS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Normalise a path for comparison: drop the query string and the trailing slash,
 * and reduce every dynamic segment — `${x}` on the client, `:name` on the server —
 * to a single marker.
 */
export function normalizePath(rawPath: string): string {
  let path = rawPath.trim();

  // The backend never routes on the query string or the hash.
  // Only consider ? or # that are NOT inside a ${...} template expression:
  // optional-chaining operators (journey?.bgv?.id) contain ? and would
  // otherwise be misread as query-string delimiters, truncating the path.
  const cutCandidates: number[] = [];
  let depth = 0;
  for (let k = 0; k < path.length; k++) {
    if (path[k] === "$" && path[k + 1] === "{") { depth++; k++; continue; }
    if (path[k] === "}" && depth > 0) { depth--; continue; }
    if (depth === 0 && (path[k] === "?" || path[k] === "#")) {
      cutCandidates.push(k);
      break;
    }
  }
  const cut = cutCandidates.length > 0 ? cutCandidates[0] : path.length;
  path = path.slice(0, cut);

  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  return path
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (segment.startsWith(":")) return ":p";
      // A segment that interpolates anything is dynamic. `${a}-${b}` and
      // `prefix${a}` are dynamic too — the value is not knowable statically.
      if (segment.includes("${")) return ":p";
      return segment;
    })
    .join("/");
}

/**
 * Pull `hrmsApi.<verb>("<path>")` calls out of one source file.
 *
 * Written as a small scanner rather than one regex because the calls carry type
 * arguments — `hrmsApi.get<{ success: boolean; data: T[] }>(...)` — and a generic
 * containing `>` defeats the obvious pattern.
 */
export function extractFrontendCalls(source: string, file: string): FrontendCall[] {
  const calls: FrontendCall[] = [];
  const verbPattern = new RegExp(`hrmsApi\\s*\\.\\s*(${HTTP_VERBS.join("|")})\\b`, "g");

  let match: RegExpExecArray | null;
  while ((match = verbPattern.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    // Skip any type arguments, then find the opening paren of the call.
    const open = source.indexOf("(", match.index + match[0].length);
    if (open === -1) continue;

    // First non-whitespace character after "(" must start a string literal,
    // otherwise the URL is built dynamically and cannot be checked statically.
    let i = open + 1;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    const quote = source[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;

    let literal = "";
    let j = i + 1;
    for (; j < source.length; j += 1) {
      const ch = source[j];
      if (ch === "\\") { literal += ch + source[j + 1]; j += 1; continue; }
      if (ch === quote) break;
      literal += ch;
    }
    if (j >= source.length) continue;

    // Only API paths are routed by Express; ignore asset or external URLs.
    if (!literal.startsWith("/api/")) continue;

    calls.push({
      method,
      path: literal,
      file,
      line: source.slice(0, match.index).split("\n").length,
    });
  }

  return calls;
}

/**
 * Recover the mount prefix a router layer was attached at.
 *
 * Express stores it as a compiled regexp; for `app.use("/api/ats", r)` the source
 * is `^\/api\/ats\/?(?=\/|$)`. Reconstructing it with string operations is
 * deliberate: building a regexp to parse a regexp is where the previous attempt
 * at this went wrong and silently produced empty prefixes, which made every route
 * look unmounted.
 */
export function mountPrefixOf(layer: { regexp?: RegExp; path?: string }): string {
  const source = layer.regexp?.source;
  if (!source) return "";

  // Root mount: app.use(router) with no path.
  if (source === "^\\/?(?=\\/|$)" || source === "^\\/?$") return "";

  let prefix = source.startsWith("^") ? source.slice(1) : source;

  const lookahead = prefix.indexOf("\\/?(?=");
  if (lookahead >= 0) prefix = prefix.slice(0, lookahead);
  else if (prefix.endsWith("\\/?$")) prefix = prefix.slice(0, -4);
  else if (prefix.endsWith("$")) prefix = prefix.slice(0, -1);

  prefix = prefix.replace(/\\\//g, "/");

  // A parameterised mount ("/:id") compiles to a character class; treat it as dynamic.
  prefix = prefix.replace(/\(\?:\(\[\^\\?\/\]\+\?\)\)/g, ":p");

  return prefix;
}

/** Walk an Express app's router stack and return every registered route. */
export function enumerateRoutes(app: unknown): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const seen = new Set<string>();

  const walk = (stack: unknown[], prefix: string): void => {
    for (const entry of stack) {
      const layer = entry as {
        route?: { path?: string | string[]; methods?: Record<string, boolean> };
        handle?: { stack?: unknown[] };
        regexp?: RegExp;
        name?: string;
      };

      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path ?? ""];
        for (const routePath of paths) {
          for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
            if (!enabled) continue;
            const key = `${method.toUpperCase()} ${normalizePath(prefix + routePath)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            routes.push({ method: method.toUpperCase(), path: normalizePath(prefix + routePath) });
          }
        }
        continue;
      }

      if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPrefixOf(layer));
      }
    }
  };

  const router = (app as { _router?: { stack?: unknown[] }; router?: { stack?: unknown[] } });
  const stack = router._router?.stack ?? router.router?.stack ?? [];
  walk(stack, "");
  return routes;
}

/** True when a client path and a registered route can address each other. */
export function pathsMatch(callPath: string, routePath: string): boolean {
  const callSegments = callPath.split("/");
  const routeSegments = routePath.split("/");

  // Express wildcards swallow the remainder.
  const wildcard = routeSegments.indexOf("*");
  if (wildcard >= 0) {
    return callSegments.length >= wildcard
      && routeSegments.slice(0, wildcard).every((seg, i) => seg === callSegments[i] || seg === ":p" || callSegments[i] === ":p");
  }

  if (callSegments.length !== routeSegments.length) return false;

  return routeSegments.every((routeSegment, i) => {
    const callSegment = callSegments[i];
    if (routeSegment === ":p" || callSegment === ":p") return true;
    return routeSegment === callSegment;
  });
}

/** Frontend calls with no registered route that could serve them. */
export function findOrphans(calls: FrontendCall[], routes: RegisteredRoute[]): FrontendCall[] {
  return calls.filter((call) => {
    const normalized = normalizePath(call.path);
    return !routes.some(
      (route) => route.method === call.method && pathsMatch(normalized, route.path),
    );
  });
}

/** Stable identity for allow-listing a known gap. */
export function orphanKey(call: { method: string; path: string }): string {
  return `${call.method} ${normalizePath(call.path)}`;
}
