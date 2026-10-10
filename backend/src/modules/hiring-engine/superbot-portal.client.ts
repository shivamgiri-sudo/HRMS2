/**
 * The calling tool's portal API (Superbot): sign in, bulk-import a calling file into the HRMS campaign, read its upload log and its call
 * list. Settings (server env): SUPERBOT_EMAIL, SUPERBOT_PASSWORD, SUPERBOT_ACCOUNT_ID, SUPERBOT_CAMPAIGN_ID, SUPERBOT_API_BASE
 * (default https://bytelink.superbot.one/api), SUPERBOT_UPLOAD_MODE (off | live; default off), SUPERBOT_LANGUAGE_ID (default 1 = Hindi).
 * Nothing here logs a password, a token or a phone number. Never throws on a bad response: callers get { ok:false, error }.
 */
const TIMEOUT_MS = 30_000;
export const BOT_PARAMS = ["phone", "name", "role", "interview_date", "interview_time", "branch_address", "reference_id"] as const;

export interface BotConfig { email: string; password: string; accountId: string; campaignId: string; base: string; uploadMode: "off" | "live"; languageId: number }
export function botConfig(env: NodeJS.ProcessEnv = process.env): BotConfig | null {
  const v = (k: string) => env[k]?.trim() ?? "";
  const email = v("SUPERBOT_EMAIL"), password = v("SUPERBOT_PASSWORD"), accountId = v("SUPERBOT_ACCOUNT_ID"), campaignId = v("SUPERBOT_CAMPAIGN_ID");
  if (!email || !password || !/^\d+$/.test(accountId) || !/^\d+$/.test(campaignId)) return null;
  return { email, password, accountId, campaignId, base: (v("SUPERBOT_API_BASE") || "https://bytelink.superbot.one/api").replace(/\/$/, ""),
    uploadMode: v("SUPERBOT_UPLOAD_MODE").toLowerCase() === "live" ? "live" : "off", languageId: Number(v("SUPERBOT_LANGUAGE_ID")) || 1 };
}

let cached: { token: string; at: number } | null = null;
const TOKEN_TTL_MS = 20 * 60_000;
export const resetBotToken = (): void => { cached = null; };

async function call(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    return { status: r.status, body: await r.json().catch(() => null) };
  } finally { clearTimeout(t); }
}

async function token(c: BotConfig): Promise<string | null> {
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  try {
    const r = await call(`${c.base}/login`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) });
    const tok = (r.body as { token?: unknown } | null)?.token;
    if (r.status === 200 && typeof tok === "string" && tok) { cached = { token: tok, at: Date.now() }; return tok; }
  } catch { /* fall through */ }
  return null;
}

async function authed(c: BotConfig, path: string, init: { method?: string; json?: unknown } = {}): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  const tok = await token(c);
  if (!tok) return { ok: false, status: 0, body: null, error: "portal sign-in failed" };
  try {
    const r = await call(`${c.base}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/json", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    if (r.status === 401) resetBotToken();
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: (e as Error).name === "AbortError" ? "portal timed out" : "portal unreachable" };
  }
}

export interface UploadResult { ok: boolean; status: number; message: string; total: number }

/** Bulk-import rows (already shaped as BOT_PARAMS order, phone = 10 digits). Tries the India country as id 1, then as "+91". */
export async function bulkImport(c: BotConfig, rows: string[][]): Promise<UploadResult> {
  if (!rows.length) return { ok: true, status: 200, message: "nothing to upload", total: 0 };
  let last: UploadResult = { ok: false, status: 0, message: "not attempted", total: rows.length };
  for (const country of [1, "+91"] as const) {
    const r = await authed(c, `/account/${c.accountId}/campaign/${c.campaignId}/bulk-import`, {
      method: "POST", json: { language_id: c.languageId, country_code: country, parameters: [...BOT_PARAMS], data: rows, total_data: rows.length },
    });
    const b = (r.body ?? {}) as { success?: boolean; message?: string };
    last = { ok: r.ok && b.success !== false, status: r.status, message: String(b.message ?? r.error ?? (r.ok ? "ok" : "rejected")).slice(0, 200), total: rows.length };
    if (last.ok) return last;
    if (r.status === 0 || r.status === 401 || r.status >= 500) break; // transport or server error: another country value will not help
  }
  return last;
}

export interface BotLog { id: number; createdAt: string; total: number; accepted: number; rejected: number }
export async function uploadLogs(c: BotConfig): Promise<BotLog[]> {
  const r = await authed(c, `/account/${c.accountId}/campaign/${c.campaignId}/upload-logs`);
  const d = ((r.body as { data?: unknown } | null)?.data ?? []) as Array<Record<string, unknown>>;
  return Array.isArray(d) ? d.map((x) => ({ id: Number(x.id), createdAt: String(x.created_at ?? ""), total: Number(x.total_numbers ?? 0), accepted: Number(x.accepted_numbers ?? 0), rejected: Number(x.rejected_numbers ?? 0) })) : [];
}

export interface BotCall {
  callId: string; reference: string; disposition: string; status: string; callStatus: string; noOfCalls: number;
  /** IST wall clock "YYYY-MM-DD HH:MM:SS" (the portal stores UTC). */
  processedAtIst: string | null; maskedPhone: string;
}
const IST_MS = 5.5 * 3600_000;
const toIst = (utc: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(utc ?? ""));
  if (!m) return null;
  return new Date(new Date(`${m[1]}T${m[2]}Z`).getTime() + IST_MS).toISOString().slice(0, 19).replace("T", " ");
};

/** All calls of the campaign, newest page first, up to maxPages x 100. */
export async function listCalls(c: BotConfig, maxPages = 8): Promise<{ ok: boolean; calls: BotCall[] }> {
  const calls: BotCall[] = [];
  for (let p = 1; p <= maxPages; p++) {
    const r = await authed(c, `/account/${c.accountId}/campaign/${c.campaignId}/phone?per_page=100&page=${p}`);
    if (!r.ok) return { ok: calls.length > 0, calls };
    const j = r.body as { data?: { data?: unknown } | unknown[] } | null;
    const rows = (Array.isArray(j?.data) ? j?.data : (j?.data as { data?: unknown } | undefined)?.data) as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const x of rows) {
      calls.push({
        callId: String(x.call_id ?? x.id ?? ""), reference: String(x.callback_reference_id ?? "").trim(), disposition: String(x.disposition ?? "").trim(),
        status: String(x.status ?? "").trim(), callStatus: String(x.call_status ?? "").trim(), noOfCalls: Number(x.no_of_calls ?? 0),
        processedAtIst: toIst(x.processed_at), maskedPhone: String(x.masked_phone_number ?? ""),
      });
    }
    if (rows.length < 100) break;
  }
  return { ok: true, calls };
}
