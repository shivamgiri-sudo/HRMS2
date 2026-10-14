/**
 * PII scrubbing for error reports.
 *
 * Every error event leaves HRMS only after passing through scrubEvent(). The rules are
 * deliberately blunt: an error report exists to find a bug, and no bug needs an employee's PAN,
 * Aadhaar, bank account, salary, phone, email or a session token to be found.
 *
 *  1. Keys that name sensitive data (pan, aadhaar, ifsc, salary, password, token and so on) have
 *     their whole value replaced. Matching is token-aware: "panNumber", "employee_pan" and
 *     "PAN-No" match "pan"; "company" and "expansion" do not.
 *  2. Every remaining string is pattern-masked: JWTs, bearer tokens, emails, PAN, Aadhaar/UAN
 *     (12 digits), IFSC, Indian mobile numbers and long digit runs (bank accounts).
 *  3. URL query values are dropped (keys kept), because ids and names ride in query strings.
 *  4. Request bodies, cookies and headers are removed. The user is reduced to id and role.
 *
 * Stack frames (file names, function names, line numbers) are left alone: they hold code, not
 * people, and they are what makes a report useful.
 *
 * KEEP IN STEP with src/lib/piiScrub.ts in the frontend. A parity test runs both on the same
 * fixtures (src/lib/__tests__/piiScrub.parity.test.ts).
 */

export const FILTERED = "[Filtered]";

const SENSITIVE_TOKENS = new Set([
  "password", "passwd", "pwd", "secret", "token", "authorization", "auth", "cookie", "session",
  "otp", "pin", "jwt", "apikey", "signature", "credential", "credentials",
  "pan", "aadhaar", "aadhar", "uid", "uan", "esic", "esi", "pf", "epf", "ifsc", "account",
  "acct", "bank", "salary", "ctc", "gross", "net", "basic", "payable", "dob", "birth",
  "mobile", "phone", "email", "address", "passport", "voter", "licence", "license",
  "nominee", "father", "mother", "spouse",
]);

/** Split "panNumber" / "employee_pan" / "X-Api-Key" into lower-case tokens. */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  const tokens = keyTokens(key);
  if (tokens.some((t) => SENSITIVE_TOKENS.has(t))) return true;
  // "apiKey" / "X-Api-Key" split into api+key; check every adjacent pair joined as well.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (SENSITIVE_TOKENS.has(tokens[i] + tokens[i + 1])) return true;
  }
  return false;
}

const PATTERNS: Array<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [Filtered]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // PAN and IFSC are issued in capitals; matching them case-sensitively keeps ordinary
  // identifiers in error messages ("user0config", "abcde1234f") readable.
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "[pan]"],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, "[ifsc]"],
  [/\b\d{4}[ -]\d{4}[ -]\d{4}\b/g, "[aadhaar]"],
  [/(?:\+91[ -]?|\b91[ -])?\b[6-9]\d{9}\b/g, "[phone]"],
  [/\b\d{9,18}\b/g, "[number]"],
];

export function scrubString(value: string): string {
  let out = value;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Keep the path, drop every query value. Unparseable input is pattern-masked instead. */
export function scrubUrl(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return scrubString(url);
  const hashAt = url.indexOf("#", q);
  const base = url.slice(0, q);
  const query = url.slice(q + 1, hashAt === -1 ? undefined : hashAt);
  const keys = query
    .split("&")
    .filter(Boolean)
    .map((pair) => `${pair.split("=")[0]}=${FILTERED}`);
  return `${scrubString(base)}?${keys.join("&")}`;
}

const MAX_DEPTH = 8;

/** Deep-scrub any JSON-like value. Never throws; returns a new value. */
export function scrubValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return looksLikeUrl(value) ? scrubUrl(value) : scrubString(value);
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) && v !== null && v !== undefined && v !== "" ? FILTERED : scrubValue(v, depth + 1, seen);
  }
  return out;
}

function looksLikeUrl(s: string): boolean {
  return /^(https?:\/\/|\/)[^\s]*\?/.test(s);
}

// ─── Event-level scrubbing ───────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

export type ScrubbableEvent = {
  message?: string;
  exception?: { values?: Array<{ type?: string; value?: string; stacktrace?: unknown; mechanism?: unknown }> };
  breadcrumbs?: Array<AnyRecord>;
  request?: AnyRecord;
  user?: AnyRecord;
  extra?: AnyRecord;
  contexts?: AnyRecord;
  tags?: AnyRecord;
  logentry?: { message?: string; formatted?: string; params?: unknown[] };
  server_name?: string;
  [k: string]: unknown;
};

export function scrubBreadcrumb<T extends AnyRecord>(crumb: T): T {
  const out: AnyRecord = { ...crumb };
  if (typeof out.message === "string") out.message = scrubString(out.message);
  if (out.data && typeof out.data === "object") {
    const data = { ...(out.data as AnyRecord) };
    for (const k of ["url", "to", "from"]) {
      if (typeof data[k] === "string") data[k] = scrubUrl(data[k] as string);
    }
    // Request/response bodies never belong in a breadcrumb.
    delete data.body;
    delete data.request_body;
    delete data.response_body;
    out.data = scrubValue(data);
  }
  return out as T;
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const out: ScrubbableEvent = { ...event };
  if (typeof out.message === "string") out.message = scrubString(out.message);
  if (out.logentry) {
    out.logentry = {
      ...out.logentry,
      message: out.logentry.message ? scrubString(out.logentry.message) : out.logentry.message,
      formatted: out.logentry.formatted ? scrubString(out.logentry.formatted) : out.logentry.formatted,
      params: out.logentry.params ? (scrubValue(out.logentry.params) as unknown[]) : out.logentry.params,
    };
  }
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => ({ ...v, value: typeof v.value === "string" ? scrubString(v.value) : v.value })),
    };
  }
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map((b) => scrubBreadcrumb(b));
  if (out.request) {
    const r = out.request;
    const kept: AnyRecord = {};
    if (typeof r.method === "string") kept.method = r.method;
    if (typeof r.url === "string") kept.url = scrubUrl(r.url);
    // Only the browser/agent string survives from headers; cookies, auth and bodies never do.
    const headers = r.headers as AnyRecord | undefined;
    const ua = headers && (headers["User-Agent"] ?? headers["user-agent"]);
    if (typeof ua === "string") kept.headers = { "User-Agent": ua };
    out.request = kept;
  }
  if (out.user) {
    const u: AnyRecord = {};
    if (out.user.id !== undefined) u.id = String(out.user.id);
    out.user = Object.keys(u).length ? u : undefined;
  }
  if (out.extra) out.extra = scrubValue(out.extra) as AnyRecord;
  if (out.contexts) out.contexts = scrubValue(out.contexts) as AnyRecord;
  if (out.tags) {
    const tags: AnyRecord = {};
    for (const [k, v] of Object.entries(out.tags)) tags[k] = typeof v === "string" ? scrubString(v) : v;
    out.tags = tags;
  }
  return out as T;
}
