import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildTallyXml } from "./salary-voucher-formats.js";
import type { Voucher } from "./salary-voucher.service.js";

/**
 * Posts salary vouchers to TallyPrime over its HTTP gateway (XML over HTTP POST).
 *
 * The gateway URL comes from the server's environment ONLY (TALLY_GATEWAY_URL, e.g.
 * http://192.168.1.50:9000) and never from a request, so a caller cannot point the server at an
 * arbitrary host. TALLY_COMPANY names the Tally company to post into; without it Tally uses
 * whichever company is open. The server running this must be able to reach that address:
 * Tally listens on the machine it runs on, which is not the HRMS server.
 *
 * Tally answers 200 even when it rejects a voucher, so the response body is parsed for its
 * CREATED / ERRORS / EXCEPTIONS counters and LINEERROR text instead of trusting the status.
 */

const TIMEOUT_MS = 30_000;

export function tallyConfig() {
  const url = (process.env.TALLY_GATEWAY_URL ?? "").trim().replace(/\/+$/, "");
  return { url, company: (process.env.TALLY_COMPANY ?? "").trim() || undefined, configured: /^https?:\/\//i.test(url) };
}

async function tallyFetch(init: { method: "GET" | "POST"; body?: string }): Promise<string> {
  const cfg = tallyConfig();
  if (!cfg.configured) throw new Error("Tally gateway is not configured (TALLY_GATEWAY_URL is not set on the server).");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url, {
      method: init.method,
      headers: init.body ? { "Content-Type": "text/xml; charset=utf-8" } : undefined,
      body: init.body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Tally gateway answered HTTP ${res.status}`);
    return await res.text();
  } catch (error) {
    const e = error as Error & { name?: string; cause?: { code?: string } };
    if (e.name === "AbortError") throw new Error(`Tally gateway did not answer within ${TIMEOUT_MS / 1000}s.`);
    throw new Error(`Cannot reach the Tally gateway at ${cfg.url}${e.cause?.code ? ` (${e.cause.code})` : ""}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export type TallyImportResult = { created: number; altered: number; errors: number; exceptions: number; lineErrors: string[] };

/** Pulls the counters and error text out of Tally's import response. Exported for tests. */
export function parseTallyResponse(xml: string): TallyImportResult {
  const num = (tag: string) => Number((xml.match(new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`, "i")) ?? [])[1] ?? 0);
  const lineErrors = [...xml.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map((m) => m[1].trim()).filter(Boolean);
  return { created: num("CREATED"), altered: num("ALTERED"), errors: num("ERRORS"), exceptions: num("EXCEPTIONS"), lineErrors };
}

export const salaryVoucherTallyPush = {
  /** Reachability only — Tally's root URL answers with a plain "server is running" line. */
  async status() {
    const cfg = tallyConfig();
    if (!cfg.configured) return { configured: false, reachable: false, company: null as string | null, message: "TALLY_GATEWAY_URL is not set on the server." };
    try {
      const text = await tallyFetch({ method: "GET" });
      return { configured: true, reachable: true, company: cfg.company ?? null, message: text.replace(/<[^>]*>/g, " ").trim().slice(0, 120) };
    } catch (error) {
      return { configured: true, reachable: false, company: cfg.company ?? null, message: (error as Error).message };
    }
  },

  /** Vouchers already posted for this run, so a second push skips them. */
  async alreadyPosted(runId: string): Promise<Set<string>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT voucher_no FROM salary_voucher_tally_push_log WHERE run_id = ? AND outcome = 'posted'`, [runId]);
    return new Set((rows as RowDataPacket[]).map((r) => String(r.voucher_no)));
  },

  /**
   * One request per voucher, so a rejected voucher is reported on its own and the rest still
   * post. Only balanced vouchers are sent.
   */
  async push(runId: string, vouchers: Voucher[], actorUserId: string, opts: { ignorePosted?: boolean } = {}) {
    const cfg = tallyConfig();
    const done = opts.ignorePosted ? new Set<string>() : await this.alreadyPosted(runId);
    const results: { voucher_no: string; branch_name: string; outcome: "posted" | "failed" | "skipped"; detail: string }[] = [];
    for (const v of vouchers) {
      if (done.has(v.voucher_no)) { results.push({ voucher_no: v.voucher_no, branch_name: v.branch_name, outcome: "skipped", detail: "Already posted to Tally from this run." }); continue; }
      if (!v.totals.balanced) { results.push({ voucher_no: v.voucher_no, branch_name: v.branch_name, outcome: "skipped", detail: "Voucher does not balance, not sent." }); continue; }
      let outcome: "posted" | "failed" = "failed";
      let detail = "";
      try {
        const parsed = parseTallyResponse(await tallyFetch({ method: "POST", body: buildTallyXml([v], cfg.company) }));
        if (parsed.created + parsed.altered > 0 && parsed.errors === 0 && parsed.exceptions === 0) { outcome = "posted"; detail = `Created ${parsed.created}`; }
        else detail = parsed.lineErrors.join("; ") || `Tally rejected it (created ${parsed.created}, errors ${parsed.errors}, exceptions ${parsed.exceptions}).`;
      } catch (error) {
        detail = (error as Error).message;
      }
      await db.execute(
        `INSERT INTO salary_voucher_tally_push_log (id, run_id, company_code, voucher_no, outcome, detail, pushed_by) VALUES (?,?,?,?,?,?,?)`,
        [randomUUID(), runId, v.company_code, v.voucher_no, outcome, detail.slice(0, 2000), actorUserId]);
      results.push({ voucher_no: v.voucher_no, branch_name: v.branch_name, outcome, detail });
      // The gateway is unreachable for everyone if it was for this one: stop rather than log N copies.
      if (outcome === "failed" && /Cannot reach|did not answer|not configured/.test(detail)) break;
    }
    return {
      posted: results.filter((r) => r.outcome === "posted").length,
      failed: results.filter((r) => r.outcome === "failed").length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
      results,
    };
  },
};
