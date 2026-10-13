import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { loadManualAgentsForRange, saveManualAgent } from "./process-targets.service.js";

/**
 * Housing Owner roster auto-sync: adds a Process Details "manual agent" row for any agent
 * name that shows up in db_masmis.owner_sale or db_masmis.Owner_cdr but isn't on the roster
 * yet. Run right after each owner_sale / Owner_cdr import (see the call at the end of
 * importOwnerSaleBatch / importOwnerCdrBatch), so a brand-new agent's revenue and calls are
 * never silently dropped by the dashboard's roster-based grouping just because nobody has
 * added them to the roster yet -- confirmed live 2026-10-08: "Sameer Calling MCN" had 4 real
 * Oct 1-8 sales (Rs 20,759) dropped from the headline Sale Count purely because the name
 * wasn't on the roster, Sale Count showing 181 instead of the raw 185.
 *
 * Goes through saveManualAgent() -- the exact function Process Details' own "Add Agent" button
 * calls -- rather than inserting into db_masmis.owner_agent_details directly. That table is
 * the UPLOADED roster; a second, independent writer into it would fight the next roster
 * upload and would not match how a human already fills this gap in by hand. Confirmed live:
 * two agents ("Shreya New MCN", "Abhay MCN") found missing on 2026-10-07 had already been
 * added this same way by the time of the next check, which is how this was discovered.
 *
 * Only the agent's own name, and a best-effort TL/AM read from their own most recent sale/cdr
 * row, are filled in -- monthlyTarget 0, status Active, no DOJ. Everything else (MAS ID /
 * empId, target, DOJ) is left for a human to complete on the Process Details page, exactly as
 * asked: "automatic add in Agent details, only need to add their masid and other details
 * which is I can do manually." A name with no usable TL/AM on its own rows is skipped (and
 * logged) rather than guessed, since saveManualAgent requires both.
 */

const isNamedAgent = (name: string): boolean =>
  name !== "" && name !== "-" && name !== "--" && name !== "0" && name !== "Unassigned";
const normalizeName = (v: unknown): string => String(v ?? "").trim().replace(/\s+/g, " ");
const currentMonth = (): string => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; };

export interface OwnerRosterSyncResult { added: string[]; skipped: Array<{ name: string; reason: string }> }

export async function syncMissingOwnerAgents(actorId: string): Promise<OwnerRosterSyncResult> {
  const [rosterRows] = await db.execute<RowDataPacket[]>(
    "SELECT overall FROM db_masmis.owner_agent_details",
  );
  const known = new Set(rosterRows.map((r) => normalizeName(r.overall)));
  const manual = await loadManualAgentsForRange("housing_owner", `${currentMonth()}-28`);
  for (const m of manual) known.add(normalizeName(m.name));

  const [saleRows] = await db.execute<RowDataPacket[]>(
    "SELECT agent_name AS name, tl_name, am FROM db_masmis.owner_sale ORDER BY id DESC",
  );
  const [cdrRows] = await db.execute<RowDataPacket[]>(
    "SELECT agent AS name, tl_name, am FROM db_masmis.Owner_cdr ORDER BY id DESC",
  );

  // Most recent row per agent wins (CDR checked first, then sale), so a new entry's TL/AM
  // looks like the agent's current assignment rather than a stale one -- a starting point for
  // the human completing the row on Process Details, never treated as authoritative here.
  const bestGuess = new Map<string, { tl: string | null; am: string | null }>();
  for (const rows of [cdrRows, saleRows]) {
    for (const r of rows) {
      const name = normalizeName(r.name);
      if (!isNamedAgent(name) || known.has(name) || bestGuess.has(name)) continue;
      bestGuess.set(name, { tl: normalizeName(r.tl_name) || null, am: normalizeName(r.am) || null });
    }
  }

  const added: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const [name, g] of bestGuess) {
    if (!g.tl || !g.am) {
      skipped.push({ name, reason: "no TL/AM on its own rows to start from" });
      continue;
    }
    try {
      await saveManualAgent("housing_owner", {
        name, tl: g.tl, group: g.am, status: "Active", monthlyTarget: 0, effectiveFrom: currentMonth(),
      }, actorId);
      added.push(name);
    } catch (err) {
      // Already on the roster, already added, or a genuine validation failure -- never fails
      // the upload that triggered this; just records why this one name was not added.
      skipped.push({ name, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  if (added.length > 0) {
    console.log(`[housing-owner-roster-sync] added ${added.length} new agent(s): ${added.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`[housing-owner-roster-sync] skipped ${skipped.length}: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`);
  }
  return { added, skipped };
}
