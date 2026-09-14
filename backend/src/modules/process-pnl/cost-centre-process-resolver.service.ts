import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";

/**
 * Self-maintaining process attribution for cost_centre_master.process_id.
 *
 * THE PROBLEM (found 2026-09-11, June 2026 data)
 * -----------------------------------------------
 * Only 47 of 941 cost_centre_master rows carry a stored process_id — it is NULL almost
 * everywhere (see the comment on PROCESS_BY_COST_CENTRE in pnl-actuals.service.ts). Revenue
 * queries already cover most of that gap at query time via PROCESS_BY_COST_CENTRE, a live
 * fallback that infers the process from the employees actually posted to a cost centre. That
 * fallback is blind, though, for cost centres that carry real invoiced revenue but have NO
 * employees mapped to them in mas_hrms — pure client-billing lines. For June 2026, 50 such cost
 * centres carried Rs 1,24,47,317 of real, already-synced invoice revenue with no process
 * attribution anywhere: neither a stored process_id nor an employee-derived fallback.
 *
 * DIALDESK CARVE-OUT (user-confirmed 2026-09-11) — READ BEFORE TOUCHING THIS FILE
 * ---------------------------------------------------------------------------------
 * 34 of those 50 cost centres sit under the NOIDA-DIALDESK branch (branch_master.id
 * 'febeee54-6583-11f1-adb1-00155d0ab410', branch_code 'NOIDA-DD'). DialDesk/Ispark Dataconnect
 * is NOT MAS Callnet — ceo-overview.service.ts already documents this ("NOIDA-DIALDESK is a
 * third entity again, Ispark Dataconnect. Confirmed with the user: IDC is a separate company
 * and this page is MAS Callnet's") and pnl-actuals.service.ts's OWN_COMPANY_SQL already exists
 * to keep IDC/DialDesk revenue out of MAS Callnet's P&L by filtering cost_centre_master
 * .company_name LIKE '%mascallnet%'.
 *
 * That company_name filter is NOT reliable for this branch on its own: 17 of the 347 cost
 * centres under NOIDA-DIALDESK are mislabelled company_name='Mas Callnet India Pvt Ltd'
 * (verified live 2026-09-11) instead of 'IDC' — including BSS/OB/NOIDA-DD/597, which carries
 * real revenue (Rs 69,000/month, Apr-Jul 2026). If this resolver ever assigned that cost centre
 * a process_id, OWN_COMPANY_SQL would no longer be the thing keeping it out of the P&L, and it
 * would leak. So EXCLUDED_BRANCH_IDS below is the authoritative, durable exclusion — checked by
 * branch_id, which is never mislabelled here, not by company_name — and it is applied before any
 * row is even considered for matching, let alone written. Extend this set (never remove from it
 * without the user's explicit approval) if another out-of-scope entity is found sharing this
 * problem.
 *
 * THE FIX
 * -------
 * For every cost centre with process_id IS NULL, NOT under an excluded branch, and carrying an
 * invoice-derived client_name/billing_client_name, compare that name (tokenised, legal-entity
 * boilerplate stripped) against every active process_master.process_name. Client-per-process
 * account naming is already this codebase's real convention — "DIALDESK", "Godfrey Philips
 * India Ltd", "Adani Wilmar Limited", "Finnable" are process_master rows in production today,
 * not made up for this fix — so a high-confidence token match (exact token-set containment,
 * allowing a small Levenshtein slack per token for spelling drift such as "Phillips"/"Philips")
 * is a real, majority-usable signal for THIS specific case, not a forced one. It is deliberately
 * NOT used as a sole per-row database fact when the match is weak: rows with no confident match
 * are left NULL and reported, never guessed.
 *
 * This keeps cost_centre_master.process_id as the stored source of truth (per the user's
 * explicit "fix this permanently... automatically" requirement) rather than only patching the
 * read path, so a brand-new cost centre added tomorrow is resolved the next time this runs
 * (scheduled worker, see cost-centre-process-resolver.worker.ts) with zero manual step, and every
 * consumer of cost_centre_master.process_id (not just bpo-pnl.service.ts) benefits identically.
 */

/** NOIDA-DIALDESK / Ispark Dataconnect — not MAS Callnet (existing project finding: "DialDesk/
 *  I-Spark out of scope"). See file header. Never write process_id for a cost centre under any
 *  of these branches.
 *
 *  This branch list is a defence-in-depth layer, NOT the only DialDesk safeguard — see
 *  DIALDESK_NAME_RE below for the independent, branch-agnostic one, added after a live dry run
 *  (2026-09-11) found a cost centre OUTSIDE these branches (branch_id 77769026-..., ordinary
 *  NOIDA) whose client_name ("Dialdesk Outsource Noida") matched process_master's real
 *  "DIALDESK" process. Branch id alone would have missed it. */
export const EXCLUDED_BRANCH_IDS = new Set<string>([
  "febeee54-6583-11f1-adb1-00155d0ab410", // NOIDA-DIALDESK (branch_code NOIDA-DD)
  "febb909f-6583-11f1-adb1-00155d0ab410", // NOIDA ISPARK-2 (branch_code NOIDA_ISPARK-2)
  "fec0d5da-6583-11f1-adb1-00155d0ab410", // NOIDA-ISPARK (branch_code NOI_ISPARK)
]);

/**
 * Hard, unconditional safeguard: this resolver must never assign a cost centre to a process
 * whose name is (or contains) "DIALDESK", regardless of the cost centre's own branch. The user's
 * instruction was explicit and unconditional ("do not add dialdesk in P&L page ... by any
 * path"). process_master does carry a real, active "DIALDESK" process used elsewhere in the
 * codebase (pnl-trend.service.ts matches db_bill's cost_process column against it directly) —
 * this constant does not touch that path or delete the process; it only stops THIS resolver from
 * ever being a new route to it. Confirmed live 2026-09-11: without this, a dry run matched
 * "BSS/IB/JPR/451" (client_name literally "DIALDESK", branch = Jaipur, not in EXCLUDED_BRANCH_IDS)
 * straight onto the DIALDESK process.
 */
const DIALDESK_NAME_RE = /DIALDESK/i;

const LEGAL_BOILERPLATE = new Set([
  "LTD", "LIMITED", "PVT", "PRIVATE", "LLP", "INC", "CO", "COMPANY",
  "INDIA", "THE", "AND", "SERVICES", "SERVICE",
]);

/**
 * Words that describe a business FUNCTION/CATEGORY rather than a named client or brand. A cost
 * centre's client name and an internal overhead process name can share one of these purely by
 * coincidence — "Bajaj Digital Collection" and "DU Digital" both contain "Digital", but Bajaj is
 * not DU Digital's client. Found live 2026-09-11 via adversarial review of a first dry run that
 * (before this list existed) produced 34 matches instead of the ~18 that survive scrutiny,
 * including "Knowy Corprate" -> "HR-CORPORATE" and "Be wealthy" -> "Appriciate Wealth" on nothing
 * but the word "corporate"/"wealth". These words are stripped from BOTH sides before the
 * containment check runs; if a side becomes empty because every one of its tokens was generic,
 * the match is refused outright rather than falling back to a weaker check — a process whose
 * name is entirely generic (e.g. "OTHERS", "HR-CORPORATE") becomes permanently unmatchable here,
 * which is correct: it is an internal bucket, not a client account.
 */
const GENERIC_WORDS = new Set([
  "SYSTEM", "SYSTEMS", "DIGITAL", "WEALTH", "WEALTHY", "ACQUISITION", "CUSTOMER", "PREPAID",
  "POSTPAID", "POST", "PAID", "BILL", "DELIVERY", "HEALTH", "CHECK",
  "CORPORATE", "CORP", "OFFICE", "BACK", "OTHERS", "OTHER", "RETENTION", "UPSELLING",
  "COLLECTION", "MANAGEMENT", "FINANCE", "GENERAL", "ADMIN", "SUPPORT", "OPERATIONS", "TEAM",
  "DESK", "OUTSOURCE", "PROJECT", "GROUP", "HOLDINGS", "ENTERPRISES", "VENTURES", "SOLUTIONS",
  "TECHNOLOGIES", "TECHNOLOGY", "GLOBAL", "NETWORK", "NETWORKS",
  // Telecom/BPO process-CATEGORY jargon — describes what kind of work a process does, not who
  // the client is. Found live 2026-09-11: "MNP Collection", "MNP POSTPAID" and "MNP Postpaid"
  // (three different clients/cost centres) all matched process "MNP REJECTION" on the shared
  // acronym alone — different business processes, coincidentally sharing a category tag, not
  // the same client account. Likewise "Cloud walker Inbound Process" and "Ecom Express ...
  // Inbound" matched "INBOUND CUSTOMER SERVICES" purely on "Inbound".
  "MNP", "INBOUND", "OUTBOUND", "PROCESS", "REJECTION",
]);

function tokenize(name: string | null | undefined): string[] {
  return (name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !LEGAL_BOILERPLATE.has(w));
}

/** Tokens with generic business-function words removed — used only for the match decision, not
 *  for display. See GENERIC_WORDS above. */
function meaningfulTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !GENERIC_WORDS.has(t));
}

/** Small Levenshtein distance, used only to tolerate a spelling slip on one already-matched
 *  token (e.g. "PHILLIPS" vs "PHILIPS"), never to invent a match between different words. */
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function tokensEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6) return false; // slack only worth it on longer brand words
  if (Math.abs(a.length - b.length) > 2) return false;
  return levenshtein(a, b) <= 1;
}

/** True when every token on the shorter side has a (possibly fuzzy) match on the longer side —
 *  i.e. one name's distinguishing words are fully contained in the other's. */
function tokenSetContained(shortTokens: string[], longTokens: string[]): boolean {
  if (shortTokens.length === 0) return false;
  return shortTokens.every((s) => longTokens.some((l) => tokensEqual(s, l)));
}

export interface ProcessCandidate {
  id: string;
  process_name: string;
  tokens: string[];
}

export interface ResolutionCandidate {
  costCentreId: string;
  costCentreCode: string;
  branchId: string | null;
  clientNameUsed: string;
  matchedProcessId: string;
  matchedProcessName: string;
  confidence: "high";
}

export interface UnresolvedRow {
  costCentreId: string;
  costCentreCode: string;
  branchId: string | null;
  clientName: string | null;
  billingClientName: string | null;
  reason: "excluded_branch" | "no_client_name" | "no_process_match";
}

interface CostCentreRow extends RowDataPacket {
  id: string;
  cost_centre_code: string;
  branch_id: string | null;
  client_name: string | null;
  billing_client_name: string | null;
}

interface ProcessRow extends RowDataPacket {
  id: string;
  process_name: string;
}

/** Finds the single best process_master match for a client name, or null if none is confident
 *  enough. "Confident" = full token-set containment either direction, i.e. the process's whole
 *  name is a (fuzzy) subset of the client's tokens, or vice versa — not a partial-token overlap. */
export function matchClientToProcess(
  clientName: string | null | undefined,
  processes: ProcessCandidate[],
): ProcessCandidate | null {
  const clientTokensAll = tokenize(clientName);
  if (clientTokensAll.length === 0) return null;
  const clientTokens = meaningfulTokens(clientTokensAll);
  // Every one of the client's tokens was a generic business word (e.g. billing_client_name was
  // literally "Acquisition") — nothing distinctive left to match on. Refuse.
  if (clientTokens.length === 0) return null;

  const eligible = processes.filter((p) => !DIALDESK_NAME_RE.test(p.process_name)); // hard rule, see DIALDESK_NAME_RE

  const hits = eligible.filter((p) => {
    if (p.tokens.length === 0) return false;
    const processTokens = meaningfulTokens(p.tokens);
    // Process name is entirely generic (e.g. "OTHERS", "HR-CORPORATE") — an internal bucket,
    // never a valid match target.
    if (processTokens.length === 0) return false;
    return (
      tokenSetContained(processTokens, clientTokens) || tokenSetContained(clientTokens, processTokens)
    );
  });
  if (hits.length !== 1) return null; // 0 = no match; >1 = ambiguous, refuse rather than guess
  return hits[0];
}

/**
 * Scans cost_centre_master for rows missing process_id, matches them against active
 * process_master rows by client name, and (when apply=true) writes the high-confidence matches.
 *
 * Always excludes EXCLUDED_BRANCH_IDS from both resolution and writing — DialDesk/IDC cost
 * centres are never candidates here, by design (see file header).
 */
export async function resolveCostCentreProcesses(
  options: { apply: boolean } = { apply: false },
): Promise<{
  resolved: ResolutionCandidate[];
  unresolved: UnresolvedRow[];
  excludedCount: number;
}> {
  const [ccRows] = await db.execute<CostCentreRow[]>(
    `SELECT id, cost_centre_code, branch_id, client_name, billing_client_name
       FROM cost_centre_master
      WHERE process_id IS NULL`,
  );
  const [processRows] = await db.execute<ProcessRow[]>(
    `SELECT id, process_name FROM process_master WHERE active_status = 1`,
  );
  const processes: ProcessCandidate[] = processRows.map((p) => ({
    id: String(p.id),
    process_name: p.process_name,
    tokens: tokenize(p.process_name),
  }));

  const resolved: ResolutionCandidate[] = [];
  const unresolved: UnresolvedRow[] = [];
  let excludedCount = 0;

  for (const cc of ccRows) {
    const branchId = cc.branch_id ? String(cc.branch_id) : null;
    if (branchId && EXCLUDED_BRANCH_IDS.has(branchId)) {
      excludedCount++;
      continue; // DialDesk/IDC — never resolved, never written. See file header.
    }

    const clientName = cc.client_name || cc.billing_client_name || null;
    if (!clientName) {
      unresolved.push({
        costCentreId: String(cc.id), costCentreCode: cc.cost_centre_code, branchId,
        clientName: cc.client_name, billingClientName: cc.billing_client_name,
        reason: "no_client_name",
      });
      continue;
    }

    const match = matchClientToProcess(clientName, processes);
    if (!match) {
      unresolved.push({
        costCentreId: String(cc.id), costCentreCode: cc.cost_centre_code, branchId,
        clientName: cc.client_name, billingClientName: cc.billing_client_name,
        reason: "no_process_match",
      });
      continue;
    }

    resolved.push({
      costCentreId: String(cc.id), costCentreCode: cc.cost_centre_code, branchId,
      clientNameUsed: clientName, matchedProcessId: match.id, matchedProcessName: match.process_name,
      confidence: "high",
    });
  }

  if (options.apply && resolved.length > 0) {
    for (const r of resolved) {
      // Belt-and-braces: re-check the exclusion immediately before the write, since this list is
      // the one thing in this function that must never regress silently.
      if (r.branchId && EXCLUDED_BRANCH_IDS.has(r.branchId)) continue;
      await db.execute(
        `UPDATE cost_centre_master SET process_id = ? WHERE id = ? AND process_id IS NULL`,
        [r.matchedProcessId, r.costCentreId],
      );
    }
    logger.info(
      { module: "cost-centre-process-resolver", written: resolved.length, unresolved: unresolved.length, excludedCount },
      `[cost-centre-process-resolver] wrote process_id for ${resolved.length} cost centre(s)`,
    );
  }

  return { resolved, unresolved, excludedCount };
}
