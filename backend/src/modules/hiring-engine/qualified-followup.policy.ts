import { followupMode, normaliseMobile10 } from "./qualified-followup.schedule.js";
import type { FollowupMode, SourceType } from "./qualified-followup.types.js";

export type RowTag = "dry_run" | "live" | "test";
export const DEFAULT_CALL_FILE_TO = "shivam.giri@teammas.in";

export interface FollowupSwitches {
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

export function readSwitches(env: NodeJS.ProcessEnv = process.env): FollowupSwitches {
  const mode = followupMode(env);
  const requested = String(env.QUAL_FOLLOWUP_TEST_MODE ?? "") === "true";
  const testPhone = normaliseMobile10(env.QUAL_FOLLOWUP_TEST_TO_PHONE);
  const emailRaw = String(env.QUAL_FOLLOWUP_TEST_TO_EMAIL ?? "").trim();
  const testEmail = emailRaw.includes("@") ? emailRaw : null;
  const max = Number(String(env.QUAL_FOLLOWUP_WA_DAILY_MAX ?? "").trim());
  return {
    mode,
    testMode: requested && mode === "live",
    testMisconfigured: requested && (testPhone === null || testEmail === null),
    testPhone,
    testEmail,
    pausedSources: sourceList(env.QUAL_FOLLOWUP_PAUSE_SOURCES),
    botSources: sourceList(env.QUAL_FOLLOWUP_BOT_SOURCES),
    callFileTo: String(env.QUAL_FOLLOWUP_CALL_FILE_TO ?? "").trim() || DEFAULT_CALL_FILE_TO,
    waDailyMax: Number.isInteger(max) && max > 0 ? max : 500,
    sendsPaused: String(env.HE_SENDS_PAUSED ?? "") === "true",
  };
}

export function rowTag(s: FollowupSwitches): RowTag | null {
  if (s.mode === "off") return null;
  if (s.mode === "dry_run") return "dry_run";
  // A misconfigured test run still tags "test" so it never touches live rows.
  return s.testMode || s.testMisconfigured ? "test" : "live";
}

export function pipelineOwnsSends(env: NodeJS.ProcessEnv = process.env): boolean {
  return followupMode(env) === "live" && String(env.QUAL_FOLLOWUP_TEST_MODE ?? "") !== "true";
}

export function followupSkipSql(a: { mobileExpr: string; requisitionExpr: string }, env: NodeJS.ProcessEnv = process.env): string {
  if (!pipelineOwnsSends(env)) return "";
  return ` AND NOT EXISTS (SELECT 1 FROM qualified_followup qf WHERE qf.mobile10 = ${a.mobileExpr} COLLATE utf8mb4_unicode_ci AND qf.requisition_id = ${a.requisitionExpr} AND qf.stopped_reason IS NULL AND qf.mode_at_enqueue = 'live')`;
}
