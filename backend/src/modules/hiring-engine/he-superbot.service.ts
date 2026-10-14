/**
 * Superbot (voice bot) client: queue one confirmation call, take it back off the queue, and test the connection.
 * The script itself (identity first, email check, confirm date/time/address, hand-off on a second decline) lives in the Superbot campaign;
 * we only send the per-call parameters and read the result on /api/he-hook/superbot.
 */
import axios from "axios";
import { logger } from "../../logger.js";
import { existingRef } from "./he-call-ref.service.js";
import { superbotConfig, type SuperbotConfig } from "./he-secrets.service.js";
import { classifyQueueError, sbPhone, type QueueFailure, type SuperbotParams } from "./he-superbot.js";

/** Every per-campaign endpoint lives under /superbot/{id}/campaign/{campaign} (queue, bulk queue, dequeue). */
const campaignUrl = (cfg: SuperbotConfig, campaignId?: string) => `${cfg.baseUrl}/superbot/${cfg.superbotId}/campaign/${campaignId || cfg.campaignId}`;

export type SuperbotQueue = { ok: true; requestId: string; alreadyQueued?: boolean } | { ok: false; reason: "not_configured" | QueueFailure; error: string };

export async function queueSuperbotCall(a: { referenceId: string; mobile10: string; params: SuperbotParams; campaignId?: string }): Promise<SuperbotQueue> {
  const cfg = await superbotConfig();
  if (!cfg) return { ok: false, reason: "not_configured", error: "superbot_not_configured" };
  try {
    const { data } = await axios.post(`${campaignUrl(cfg, a.campaignId)}/call`,
      { numbers: [{ parameters: a.params, phone: sbPhone(a.mobile10), reference_id: a.referenceId }], lang: cfg.lang },
      { headers: { apiKey: cfg.apiKey, "Content-Type": "application/json" }, timeout: 20000 });
    if (data?.status === false) return { ok: false, reason: "provider_error", error: String(data?.message ?? "rejected").slice(0, 200) };
    return { ok: true, requestId: String(data?.capture_request_id ?? "") };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      const reason = classifyQueueError(err.response.status, err.response.data ?? null);
      const msg = String(err.response.data?.message ?? err.message).slice(0, 200);
      if (reason === "already_queued") return { ok: true, requestId: "", alreadyQueued: true };
      logger.warn({ status: err.response.status, reason }, "[he-superbot] queue refused");
      return { ok: false, reason, error: msg };
    }
    logger.warn({ error: (err as Error).message }, "[he-superbot] queue failed");
    return { ok: false, reason: "provider_error", error: (err as Error).message };
  }
}

/** Best effort: take a waiting call back off the queue when the candidate answered elsewhere. Never throws. */
export async function dequeueSuperbotCall(referenceId: string): Promise<boolean> {
  try {
    const cfg = await superbotConfig();
    if (!cfg) return false;
    const { data } = await axios.post(`${campaignUrl(cfg)}/contact/dequeue/`, { reference_id: referenceId }, { headers: { apiKey: cfg.apiKey, "Content-Type": "application/json" }, timeout: 10000 });
    return data?.status === true;
  } catch { return false; }
}

/**
 * Dequeues a reference that cannot exist. Only Superbot's own 404 "Contact Not Found In Queue" proves the key, Superbot id and campaign are right;
 * a bare 404 (wrong path or id) or 401 does not. No side effects.
 */
export async function testSuperbotConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await superbotConfig();
  if (!cfg) return { ok: false, message: "Enter the API key, Superbot id and campaign id first." };
  try {
    await axios.post(`${campaignUrl(cfg)}/contact/dequeue/`, { reference_id: "HE-CONNECTION-TEST" }, { headers: { apiKey: cfg.apiKey, "Content-Type": "application/json" }, timeout: 10000 });
    return { ok: true, message: "Connected to Superbot." };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      const msg = String((err.response.data as { message?: unknown } | null)?.message ?? "");
      if (err.response.status === 401) return { ok: false, message: "Superbot rejected the API key (401)." };
      if (err.response.status === 404 && /not found in queue/i.test(msg)) return { ok: true, message: "Connected to Superbot (key, Superbot id and campaign accepted)." };
      if (err.response.status === 404) return { ok: false, message: "Superbot answered 404: check the Superbot id, campaign id and base URL." };
      return { ok: false, message: `Superbot answered ${err.response.status}${msg ? `: ${msg.slice(0, 120)}` : ""}.` };
    }
    return { ok: false, message: "Could not reach Superbot. If this server's IP is not whitelisted by Superbot, ask them to add it." };
  }
}

/** Dequeue by match: only if the match was ever given a reference (a call may be waiting under it). Never throws. */
export async function dequeueSuperbotForMatch(matchId: string): Promise<boolean> {
  try { const ref = await existingRef(matchId); return ref ? await dequeueSuperbotCall(ref) : false; } catch { return false; }
}
