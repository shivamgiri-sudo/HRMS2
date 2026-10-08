import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { followupMode, normaliseMobile10 } from "./qualified-followup.schedule.js";
import type { FollowupMode, RowTag, SourceMode, SourceType } from "./qualified-followup.types.js";

export type { RowTag } from "./qualified-followup.types.js";
export const DEFAULT_CALL_FILE_TO = "shivam.giri@teammas.in";

/** he_model_param.value is DECIMAL, so the screen stores modes as codes (policy.followup.<source>). */
export const SOURCE_MODE_CODES: Record<SourceMode, number> = { off: 0, dry_run: 1, test: 2, canary: 3, live: 4 };
const MODE_BY_CODE: readonly SourceMode[] = ["off", "dry_run", "test", "canary", "live"];
/** Canary first contacts per branch per IST day (D10); any other branch is 0 until a policy.followup.canary_cap.<PREFIX> row sets it. */
export const DEFAULT_CANARY_CAPS: ReadonlyMap<string, number> = new Map([["NOIDA-2", 50], ["AHMEDABAD", 30]]);

export interface FollowupSwitches {
  /** QUAL_FOLLOWUP_MODE as before (off -> the worker makes no query). */
  mode: FollowupMode;
  testMode: boolean;
  testMisconfigured: boolean;
  testPhone: string | null;
  testEmail: string | null;
  pausedSources: ReadonlySet<SourceType>;
  botSources: ReadonlySet<SourceType>;
  callFileTo: string;
  waDailyMax: number;
  sendsPaused: boolean;
  /** The env ceiling: no source runs above it. */
  ceiling: SourceMode;
  sourceModes: Readonly<Record<SourceType, SourceMode>>;
  /** `${source}:${requisitionId}` */
  canary: ReadonlySet<string>;
  canaryCaps: ReadonlyMap<string, number>;
  /** HE_SENDS_PAUSED or the screen's policy.followup.paused = 1. */
  killSwitch: boolean;
  /** policy.followup.upload_wa = 1: upload rows without opt-in may get stage A WhatsApp (D12, default off). */
  uploadWa: boolean;
  /** True when a canary/live screen value runs as dry_run because Pinbot inbound is not verified and the owner did not acknowledge it. */
  inboundGate: boolean;
}

const SOURCES: readonly SourceType[] = ["meta_live", "meta_old", "he"];

function sourceList(raw: string | undefined): Set<SourceType> {
  const out = new Set<SourceType>();
  for (const p of String(raw ?? "").split(",")) {
    const v = p.trim().toLowerCase() as SourceType;
    if (SOURCES.includes(v)) out.add(v);
  }
  return out;
}

/** Fail safe: any non-empty value except an explicit false/0/no/off asks for test mode ("TRUE", "1", "yes" must never mean full live). */
export function isTestModeRequested(value: string | undefined | null): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v !== "" && !["false", "0", "no", "off"].includes(v);
}

export function envCeiling(env: NodeJS.ProcessEnv): SourceMode {
  const m = followupMode(env);
  return m === "live" && isTestModeRequested(env.QUAL_FOLLOWUP_TEST_MODE) ? "test" : m;
}

/** The screen code capped by the env ceiling; a missing or invalid code is off. */
export function resolveSourceMode(ceiling: SourceMode, code: number | undefined): SourceMode {
  if (code === undefined || !Number.isInteger(code) || code < 0 || code > 4) return "off";
  return MODE_BY_CODE[Math.min(code, SOURCE_MODE_CODES[ceiling])];
}

export function readSwitches(
  env: NodeJS.ProcessEnv = process.env, params: ReadonlyMap<string, number> = new Map(),
  canary: ReadonlyArray<{ sourceType: SourceType; requisitionId: string }> = [],
): FollowupSwitches {
  const mode = followupMode(env);
  const requested = isTestModeRequested(env.QUAL_FOLLOWUP_TEST_MODE);
  const testPhone = normaliseMobile10(env.QUAL_FOLLOWUP_TEST_TO_PHONE);
  const emailRaw = String(env.QUAL_FOLLOWUP_TEST_TO_EMAIL ?? "").trim();
  const testEmail = emailRaw.includes("@") ? emailRaw : null;
  const max = Number(String(env.QUAL_FOLLOWUP_WA_DAILY_MAX ?? "").trim());
  const paramMax = Number(params.get("policy.followup.wa_daily_max") ?? 0);
  const sendsPaused = String(env.HE_SENDS_PAUSED ?? "") === "true";
  const ceiling = envCeiling(env);
  const caps = new Map(DEFAULT_CANARY_CAPS);
  for (const [k, v] of params) {
    if (k.startsWith("policy.followup.canary_cap.") && Number.isFinite(v) && v >= 0) caps.set(k.slice("policy.followup.canary_cap.".length).toUpperCase(), Math.floor(v));
  }
  return {
    mode,
    testMode: requested && mode === "live",
    testMisconfigured: requested && (testPhone === null || testEmail === null),
    testPhone,
    testEmail,
    pausedSources: sourceList(env.QUAL_FOLLOWUP_PAUSE_SOURCES),
    botSources: sourceList(env.QUAL_FOLLOWUP_BOT_SOURCES),
    callFileTo: String(env.QUAL_FOLLOWUP_CALL_FILE_TO ?? "").trim() || DEFAULT_CALL_FILE_TO,
    waDailyMax: paramMax > 0 ? Math.floor(paramMax) : Number.isInteger(max) && max > 0 ? max : 500,
    sendsPaused,
    ceiling,
    sourceModes: Object.fromEntries(SOURCES.map((src) => [src, resolveSourceMode(ceiling, params.get(`policy.followup.${src}`))])) as Record<SourceType, SourceMode>,
    canary: new Set(canary.map((c) => `${c.sourceType}:${c.requisitionId}`)),
    canaryCaps: caps,
    killSwitch: sendsPaused || params.get("policy.followup.paused") === 1,
    uploadWa: params.get("policy.followup.upload_wa") === 1,
    inboundGate: false,
  };
}

/** Screen switches + canary list. Env ceiling off -> no query (as today). A read error leaves every source off. */
export async function loadFollowupSwitches(env: NodeJS.ProcessEnv = process.env): Promise<FollowupSwitches> {
  if (envCeiling(env) === "off") return readSwitches(env);
  try {
    const [p] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'policy.followup.%'");
    const [c] = await db.execute<RowDataPacket[]>("SELECT source_type, requisition_id FROM followup_canary");
    const params = new Map(p.map((r) => [String(r.param_key), Number(r.value)]));
    return applyInboundGate(readSwitches(env, params, c.map((r) => ({ sourceType: String(r.source_type) as SourceType, requisitionId: String(r.requisition_id) }))), params);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[qualified-followup] switches unreadable; every source off");
    return readSwitches(env);
  }
}

/** Real sends (canary / live) need the Pinbot inbound loop: without it replies, STOP and receipts on WhatsApp are blind (spec 7). */
export function switchRefusal(mode: SourceMode, inbound: { verified: boolean; acknowledged: boolean }): string | null {
  if (mode !== "canary" && mode !== "live") return null;
  if (inbound.verified || inbound.acknowledged) return null;
  return "Pinbot inbound WhatsApp is not verified: verify it (a reply and a STOP from a test phone appear in the inbox) or acknowledge the risk first";
}

/** Read side of the same rule: a canary/live screen value runs as dry_run (shadow) until inbound is verified or acknowledged. */
export function applyInboundGate(s: FollowupSwitches, params: ReadonlyMap<string, number>): FollowupSwitches {
  const inbound = { verified: params.get("policy.followup.wa_inbound_verified") === 1, acknowledged: params.get("policy.followup.wa_inbound_ack") === 1 };
  let gated = false;
  const modes = { ...s.sourceModes };
  for (const src of SOURCES) if (switchRefusal(modes[src], inbound)) { modes[src] = "dry_run"; gated = true; }
  return gated ? { ...s, sourceModes: modes, inboundGate: true } : s;
}

/** The tag a new enrolment gets for this source; canary only for listed requisitions (others shadow as dry_run). */
export function enrolTag(s: FollowupSwitches, source: SourceType, requisitionId: string): RowTag | null {
  const m = s.sourceModes[source];
  if (m === "off") return null;
  if (m === "canary") return s.canary.has(`${source}:${requisitionId}`) ? "canary" : "dry_run";
  return m;
}

export function runnableTags(mode: SourceMode): RowTag[] {
  if (mode === "off") return [];
  return mode === "live" ? ["live", "canary"] : [mode];
}

/** Which sources each tag runs for in one tick, ordered live, canary, test, dry_run. */
export function tickPlan(s: FollowupSwitches): Array<{ tag: RowTag; sources: SourceType[] }> {
  const out: Array<{ tag: RowTag; sources: SourceType[] }> = [];
  for (const tag of ["live", "canary", "test", "dry_run"] as const) {
    const sources = SOURCES.filter((src) => runnableTags(s.sourceModes[src]).includes(tag));
    if (sources.length) out.push({ tag, sources });
  }
  return out;
}

/** Longest configured prefix of the branch (case-insensitive); an unlisted or missing branch gets cap 0. */
export function canaryCapFor(s: FollowupSwitches, branchName: string | null): { prefix: string; cap: number } {
  const b = String(branchName ?? "").trim().toUpperCase();
  let best: { prefix: string; cap: number } | null = null;
  if (b) for (const [prefix, cap] of s.canaryCaps) if (b.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { prefix, cap };
  return best ?? { prefix: b, cap: 0 };
}

/** Rows the legacy rowTag would have used (env only). Kept for the callers Task 9 moves to tickPlan. */
export function rowTag(s: FollowupSwitches): RowTag | null {
  if (s.mode === "off") return null;
  if (s.mode === "dry_run") return "dry_run";
  // A misconfigured test run still tags "test" so it never touches live rows.
  return s.testMode || s.testMisconfigured ? "test" : "live";
}

/** @deprecated the engine and legacy skip by row existence (followupSkipSql); removed with the legacy retirement. */
export function pipelineOwnsSends(env: NodeJS.ProcessEnv = process.env): boolean {
  return followupMode(env) === "live" && !isTestModeRequested(env.QUAL_FOLLOWUP_TEST_MODE);
}

/** Row-based: a live/canary pipeline row for this person and requisition (open or stopped), or any requisition while the person's
 *  live/canary journey is in stage A/B. Independent of the current mode, so a rollback keeps those people away from other senders. */
export function followupSkipSql(a: { mobileExpr: string; requisitionExpr: string }): string {
  return ` AND NOT EXISTS (SELECT 1 FROM qualified_followup qf WHERE qf.mobile10 = ${a.mobileExpr} COLLATE utf8mb4_unicode_ci AND qf.owner = 'pipeline' AND qf.mode_at_enqueue IN ('live','canary') AND (qf.requisition_id = ${a.requisitionExpr} COLLATE utf8mb4_unicode_ci OR qf.journey_state IN ('reach','engaged','confirmed','reminded')))`;
}

/** First-contact sends wait out the 7-day re-contact hold (followup_person). */
export function firstContactHoldSql(a: { mobileExpr: string }): string {
  return ` AND NOT EXISTS (SELECT 1 FROM followup_person fp WHERE fp.mobile10 = ${a.mobileExpr} COLLATE utf8mb4_unicode_ci AND fp.last_first_contact_at > DATE_SUB(NOW(), INTERVAL 7 DAY))`;
}
