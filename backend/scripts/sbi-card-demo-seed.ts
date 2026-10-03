/**
 * SBI Card Collections - DEMO data for the production dashboards. Removable.
 *
 *   npx tsx scripts/sbi-card-demo-seed.ts --mode=dry-run   report what would be written / removed, write nothing
 *   npx tsx scripts/sbi-card-demo-seed.ts --mode=seed      write the demo data
 *   npx tsx scripts/sbi-card-demo-seed.ts --mode=remove    delete exactly the rows this script wrote
 *
 * Every row is synthetic (generated from a fixed seed, so a re-run rewrites the same rows) and is tagged
 * data_source = 'DEMO_SEED', source_reference = 'demo-seed'. Remove deletes by that tag and nothing else.
 * Rows go through the same mapRow() as the real uploaders, so the demo exercises the real column handling.
 *
 * Keys are chosen not to collide with real files: account numbers 99xxxxxxxx, dialer ids 9001+, employee ids DEMO-Exx,
 * campaigns "DEMO ...", call tables MAS_DEM_..., downtime site "DEMO SITE". The one shared key is the Outcome row
 * (date + segment CD3_HB). Remove the demo before uploading real files for the demo's dates.
 *
 * Seeding refuses when a table already holds rows that are not demo rows for the demo's dates: demo and real data never mix.
 * No phone numbers are generated. KPI daily rollups are NOT written (they would outlive the demo rows).
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { db } from "../src/db/mysql.js";
import { canonicalizeRow } from "../src/modules/bulk-upload/dalmia-import-helpers.js";
import {
  accountFileSpec, agentMisSpec, agentTimeSpec, dialerMisSpec, downtimeSpec, outcomeSpec, penEstimationSpec, rosterSpec,
} from "../src/modules/bulk-upload/sbi-card-bulk.service.js";
import { SBI_CARD_PROCESS_NAME, type SbiBatchSpec } from "../src/modules/bulk-upload/sbi-card-batch-runner.js";

export const DEMO_TAG = "DEMO_SEED";
export const DEMO_REF = "demo-seed";
const DAYS = 7;
const TABLES = [
  "sbi_card_account_file", "sbi_card_agent_time", "sbi_card_agent_mis", "sbi_card_dialer_mis",
  "sbi_card_downtime", "sbi_card_pen_estimation", "sbi_card_outcome", "sbi_card_roster",
] as const;

type Row = Record<string, unknown>;

/** Deterministic PRNG so the demo is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let rnd = prng(20261003);
const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)];
const between = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
function weighted<T extends string>(w: Record<T, number>): T {
  const total = Object.values<number>(w).reduce((a, b) => a + b, 0); let x = rnd() * total;
  for (const [k, v] of Object.entries<number>(w)) { x -= v; if (x < 0) return k as T; }
  return Object.keys(w)[0] as T;
}
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const ddmmyyyy = (s: string): string => `${s.slice(8, 10)}${s.slice(5, 7)}${s.slice(0, 4)}`;
const hms = (sec: number): string => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
const clock = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`;

export function demoDates(end: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - i); out.push(iso(d)); }
  return out;
}

const CLIENT_CONTACT = new Set(["PTP", "PAD", "OTP", "DS", "RTP", "CBL"]);
const DISP_W: Record<string, number> = {
  NAA: 30, NC: 14, WN: 4, VOML: 8, AU: 4, CBL: 6, PTP: 7, PAD: 2, OTP: 3, RTP: 4, LB: 2, WS: 1, WH: 1, TCBL: 2, DISP: 0.5, DS: 0.2,
};

interface Agent { dialerId: string; empId: string; name: string; team: "HIGHBAL" | "LOWBAL"; leader: string; skill: number }
function buildRoster(): Agent[] {
  const leaders = { HIGHBAL: ["Demo Leader A", "Demo Leader B"], LOWBAL: ["Demo Leader C", "Demo Leader D"] } as const;
  const out: Agent[] = [];
  for (let i = 1; i <= 40; i++) {
    const team = i <= 22 ? "HIGHBAL" : "LOWBAL";
    out.push({
      dialerId: String(9000 + i), empId: `DEMO-E${String(i).padStart(2, "0")}`, name: `Demo Agent ${String(i).padStart(2, "0")}`,
      team, leader: leaders[team][i % 2], skill: 0.75 + rnd() * 0.5,
    });
  }
  return out;
}

interface Acct { no: string; stage: number; due: number; limit: number; cibil: number; vintage: number; region: string; product: string; cls: string; cycle: string; tier: "HB" | "HB1" | "LOW"; program: string; nrr: string }
const REGIONS = ["NORTH", "SOUTH", "EAST", "WEST"];
function buildBook(n: number): Acct[] {
  return Array.from({ length: n }, (_, i) => {
    const stage = weighted({ "2": 28, "3": 52, "4": 20 });
    const hb = rnd() < 0.58;
    const due = hb ? between(26000, 140000) : between(3000, 24000);
    return {
      no: String(9900000001 + i), stage: Number(stage), due, limit: Math.round(due * (1.5 + rnd() * 3)), cibil: between(480, 790), vintage: between(3, 96),
      region: pick(REGIONS), product: pick(["SIGNATURE", "PLATINUM", "SELECT", "CLASSIC"]), cls: pick(["REGULAR", "REGULAR", "PRIME", "ELITE"]),
      cycle: String(pick([3, 8, 13, 18, 23, 28])), tier: hb ? (rnd() < 0.3 ? "HB1" : "HB") : "LOW", program: weighted({ FAT_S: 30, STAB: 30, PTP: 15, CTC: 10, BASE: 15 }),
      nrr: pick(["N", "R", "N"]),
    };
  });
}
const callTableOf = (a: Acct, date: string): string =>
  `MAS_DEM_CD${a.stage}_${a.program === "BASE" ? "" : `${a.program}_`}${a.tier === "LOW" ? "L" : a.tier}_${ddmmyyyy(date)}`;

export interface Generated { [table: string]: { spec: SbiBatchSpec; rows: Row[] } }

/** Pure: the whole demo data set as header-keyed rows, one list per target table. */
export function generate(dates: string[]): Generated {
  rnd = prng(20261003); // every call starts from the same seed, so the same dates always give the same rows
  const roster = buildRoster();
  const byDialer = new Map(roster.map((a) => [a.dialerId, a]));
  const book = buildBook(1800);
  const live = new Map<string, { stage: number; due: number }>(book.map((a) => [a.no, { stage: a.stage, due: a.due }]));
  const accountRows: Row[] = []; const agentMisRows: Row[] = []; const agentTimeRows: Row[] = []; const dialerRows: Row[] = [];
  const downtimeRows: Row[] = []; const penRows: Row[] = []; const outcomeRows: Row[] = [];

  const opening = book.filter((a) => a.stage === 3 && a.tier !== "LOW").length;
  const openingAmt = book.filter((a) => a.stage === 3 && a.tier !== "LOW").reduce((s, a) => s + a.due, 0);
  let resolved = 0; let normalised = 0; let rolledBack = 0;

  dates.forEach((date, dayIdx) => {
    const stat = new Map<string, { calls: number; contacts: number; ptp: number; pad: number; collected: number; talk: number }>();
    const camp = new Map<string, { accts: Set<string>; called: Set<string>; dials: number; answers: number; ptp: number; pad: number; otp: number; ds: number; rtp: number; cbl: number; contacts: number; value: number; agents: Set<string> }>();
    const tables = new Map<string, { accts: number; dials: number }>();
    const hbAgents = roster.filter((a) => a.team === "HIGHBAL"); const lbAgents = roster.filter((a) => a.team === "LOWBAL");

    for (const a of book) {
      const st = live.get(a.no);
      if (!st) continue;
      const callTable = callTableOf({ ...a, stage: st.stage }, date);
      const campaign = `DEMO CD${st.stage} ${a.tier === "LOW" ? "LOW" : a.tier}`;
      const c = camp.get(campaign) ?? { accts: new Set(), called: new Set(), dials: 0, answers: 0, ptp: 0, pad: 0, otp: 0, ds: 0, rtp: 0, cbl: 0, contacts: 0, value: 0, agents: new Set() };
      camp.set(campaign, c); c.accts.add(a.no);
      const t = tables.get(callTable) ?? { accts: 0, dials: 0 }; t.accts += 1; tables.set(callTable, t);
      const row: Row = {
        ACCOUNT_NO: a.no, "Report Date": date, BILLING_CYCLE: a.cycle, DELQ1: `CD${st.stage}`, CIBIL_SCORE: a.cibil, CREDIT_LIMIT: a.limit, CUR_BAL: st.due,
        CUR_BAL_PLUS_DPI: Math.round(st.due * 1.04), TOTAL_AMOUNT_DUE: Math.round(st.due * 1.06), TOTAL_CUR_DUE: Math.round(st.due * 0.31),
        VINTAGE: a.vintage, REGION: a.region, AGENCY_NAME: "DEMO AGENCY", CALL_TABLE_NAME: callTable, Flow: "NEW", CD: st.stage, NRR: a.nrr,
        NTC_FLAG: "N", NEW_TO_CARD_FLAG: a.vintage < 12 ? "Y" : "N", PRODUCT_CLASS_FLAG: a.product, ACCOUNTS_CLASS: a.cls, DONOTCALL: rnd() < 0.01 ? "Y" : "N",
      };
      const attempts = rnd() < 0.12 ? 0 : weighted({ "1": 16, "2": 26, "3": 26, "4": 18, "5": 9, "6": 5 }) as unknown as number;
      const n = Number(attempts);
      row.DIAL_CNT = n;
      let minute = between(8 * 60 + 5, 11 * 60);
      let done = false;
      for (let k = 1; k <= n && !done; k++) {
        const crossWindow = rnd() < 0.015;
        const when = crossWindow ? (rnd() < 0.5 ? between(7 * 60 + 20, 7 * 60 + 58) : between(19 * 60 + 2, 19 * 60 + 40)) : Math.min(minute, 18 * 60 + 50);
        minute += between(55, 170);
        const lowTeam = a.tier === "LOW" ? 0.92 : 0.12;
        const agent = rnd() < lowTeam ? pick(lbAgents) : pick(hbAgents);
        const unmapped = rnd() < 0.02;
        const agentId = unmapped ? "9501" : agent.dialerId;
        const code = weighted(Object.fromEntries(Object.entries(DISP_W).map(([d, w]) => [d, w * (CLIENT_CONTACT.has(d) ? (unmapped ? 1 : agent.skill) : 1) * (d === "PTP" && a.tier !== "LOW" ? 1.2 : 1)])) as Record<string, number>);
        row[`CALL${k}_DT`] = `${date} ${clock(when)}`; row[`DISP${k}_C`] = code; row[`AGENT${k}_ID`] = agentId;
        c.dials += 1; t.dials += 1; c.called.add(a.no); c.agents.add(agentId);
        const s = stat.get(agentId) ?? { calls: 0, contacts: 0, ptp: 0, pad: 0, collected: 0, talk: 0 }; stat.set(agentId, s);
        s.calls += 1;
        if (!["NAA", "NC", "WN", "VOML", "AU"].includes(code)) c.answers += 1;
        if (CLIENT_CONTACT.has(code)) { c.contacts += 1; s.contacts += 1; s.talk += between(170, 330); } else s.talk += between(6, 22);
        if (code === "PTP") { c.ptp += 1; s.ptp += 1; c.value += st.due * 0.4; }
        if (code === "PAD") { c.pad += 1; s.pad += 1; }
        if (code === "OTP") c.otp += 1; if (code === "DS") c.ds += 1; if (code === "RTP") c.rtp += 1; if (code === "CBL") c.cbl += 1;
        if (code === "PTP" || code === "PAD") { row.LAST_ACTION_CODE = code; row.LAST_PTP_DATE = date; }
        if (["PTP", "PAD", "RTP", "DS", "DISP", "OTP", "WS", "WH"].includes(code)) done = true; // exclude-after-first-pass
      }
      if (n > 0 && !row.LAST_ACTION_CODE) row.LAST_ACTION_CODE = String(row[`DISP${n}_C`] ?? "");
      accountRows.push(row);
      // Overnight movement for the next snapshot: pay-downs, roll-backs, exits, roll-forwards.
      const x = rnd();
      const promised = row.LAST_ACTION_CODE === "PTP" || row.LAST_ACTION_CODE === "PAD";
      if (dayIdx < dates.length - 1) {
        if (x < (promised ? 0.22 : 0.05)) { live.delete(a.no); resolved += 1; if (st.stage === 3) normalised += 0; }
        else if (x < (promised ? 0.34 : 0.1)) { st.stage = Math.max(1, st.stage - 1); rolledBack += 1; }
        else if (x < (promised ? 0.4 : 0.15)) st.stage = Math.min(5, st.stage + 1);
        else if (x < (promised ? 0.75 : 0.32)) st.due = Math.round(st.due * (0.82 + rnd() * 0.1));
      }
    }

    // A small MANUAL-flow extract (accounts worked by hand).
    for (const a of book.slice(0, 120)) {
      const st = live.get(a.no); if (!st) continue;
      accountRows.push({
        ACCOUNT_NO: a.no, "Report Date": date, Flow: "MANUAL", DELQ1: `CD${st.stage}`, CD: st.stage, CUR_BAL: st.due, TOTAL_AMOUNT_DUE: Math.round(st.due * 1.06),
        REGION: a.region, CALL_TABLE_NAME: callTableOf({ ...a, stage: st.stage }, date), AGENCY_NAME: "DEMO AGENCY", DIAL_CNT: 0,
      });
    }

    // Day-level tables derived from the day's attempts.
    for (const [campaign, c] of camp) {
      dialerRows.push({
        Date: date, Campaign: campaign, "Total Accounts": c.accts.size, "Accounts Scheduled": c.accts.size, "Accounts Called": c.called.size, Dials: c.dials,
        "Actual Dialer Dials": c.dials, Answers: c.answers, Connects: c.contacts, PTP: c.ptp, PAD: c.pad, OTP: c.otp, DS: c.ds, RTP: c.rtp, CBL: c.cbl,
        "TOTAL Contacts": c.contacts, "TOTAL Promises": c.ptp + c.pad, "Count Of Agents": c.agents.size, "PTP Value": Math.round(c.value), "Total PTP Value": Math.round(c.value),
        "Agent Hours": Math.round(c.agents.size * 7.4 * 10) / 10,
      });
    }
    for (const [table, t] of tables) {
      penRows.push({
        "CALL TABLES": table, "Report Date": date, Download: t.accts, "Dials Required": t.accts * 3, Dials: t.dials, Penetration: Math.round((t.dials / Math.max(1, t.accts)) * 100) / 100,
        "Target Penetration": 3, "Present Agents (Nos.)": 30, "Actual Rostered Count": 34,
      });
    }
    for (const ag of roster) {
      const s = stat.get(ag.dialerId) ?? { calls: 0, contacts: 0, ptp: 0, pad: 0, collected: 0, talk: 0 };
      if (rnd() < 0.07) continue; // absent
      const login = between(7 * 3600 + 1200, 8 * 3600 + 3000);
      const talk = Math.min(s.talk, Math.round(login * 0.28)); const dispo = Math.round(login * (0.06 + rnd() * 0.05));
      const pause = Math.round(login * (0.08 + rnd() * 0.1)); const dead = Math.round(login * (0.01 + rnd() * 0.03));
      const wait = Math.max(0, login - talk - dispo - pause - dead);
      const collected = (s.ptp + s.pad) * between(1800, 9000);
      const first = between(8 * 60, 9 * 60 + 25); const last = first + Math.round(login / 60) + between(70, 140);
      agentMisRows.push({
        "Employee ID": ag.empId, "DIALER ID": ag.dialerId, Name: ag.name, TEAM: ag.team, "TEAM LEADER": ag.leader, Date: date,
        "First Login Time": clock(first), "Target Time": "08:00:00", "Last Logout Time": clock(Math.min(last, 19 * 60)), "Leakage Of Day": hms(Math.max(0, first - 8 * 60) * 60),
        Calls: s.calls, Contacts: s.contacts, PTP: s.ptp, PAD: s.pad, "Total Promises": s.ptp + s.pad, "No Promise": Math.max(0, s.contacts - s.ptp - s.pad),
        "Amt collected": collected, "Amt collected PP": Math.round(collected * 0.7), "Amt collected PU": Math.round(collected * 0.3),
        TOS: Math.round((login / 3600) * 100) / 100, Talk: Math.round((talk / 3600) * 100) / 100, Wrap: Math.round((dispo / 3600) * 100) / 100, Idle: Math.round((wait / 3600) * 100) / 100,
      });
      agentTimeRows.push({
        ID: ag.empId, "Report Date": date, USER: ag.name, CALLS: s.calls, "TIME CLOCK": hms(login + between(300, 1500)), "LOGIN TIME": hms(login), WAIT: hms(wait), TALK: hms(talk),
        DISPO: hms(dispo), PAUSE: hms(pause), DEAD: hms(dead), CUSTOMER: hms(Math.round(talk * 0.8)), Login: clock(first), Logout: clock(Math.min(last, 19 * 60)),
        ACHT: s.calls > 0 ? Math.round((talk + dispo) / s.calls) : 0, DISMX: between(10, 80), LAGGED: between(0, 400),
        LB: hms(Math.round(pause * 0.45)), MB: hms(Math.round(pause * 0.2)), QB: hms(Math.round(pause * 0.1)), TB: hms(Math.round(pause * 0.2)), WB: hms(Math.round(pause * 0.05)),
        LOGIN: hms(between(120, 900)),
      });
    }
    if (dayIdx % 3 === 1) {
      const s = between(10 * 60, 14 * 60); const m = between(18, 55);
      downtimeRows.push({
        Date: date, "Start Time": clock(s), "Up Time": clock(s + m), "Downtime Minutes": m, "Total Impacted Users": between(8, 38), Responsibility: pick(["Client", "Vendor", "Agency"]),
        "Downtime Description/ Issue Reason": pick(["Dialer login slow", "Call-table load delay", "Network latency at site"]), Site: "DEMO SITE", Status: "Resolved", "RCA (If Any)": "Demo record", Remarks: "Demo data",
      });
    }
    const d = dayIdx + 1;
    outcomeRows.push({
      "Report Date": date, Segment: "CD3_HB", "Opening Accounts": opening, "Opening Amount": openingAmt,
      "Resolved Accounts": Math.round(opening * Math.min(0.36, 0.05 * d + 0.02)), "Normalised Accounts": Math.round(opening * Math.min(0.19, 0.027 * d)),
      "Rollback Accounts": Math.round(opening * Math.min(0.11, 0.015 * d)),
    });
  });
  void resolved; void normalised; void rolledBack; void byDialer;

  const rosterRows: Row[] = roster.map((a) => ({ "DIALER ID": a.dialerId, "Employee ID": a.empId, Name: a.name, GH: "Demo GH", TEAM: a.team, "TEAM LEADER": a.leader, MODE: "Dialer" }));
  return {
    sbi_card_roster: { spec: rosterSpec, rows: rosterRows },
    sbi_card_account_file: { spec: accountFileSpec, rows: accountRows },
    sbi_card_dialer_mis: { spec: dialerMisSpec, rows: dialerRows },
    sbi_card_agent_mis: { spec: agentMisSpec, rows: agentMisRows },
    sbi_card_agent_time: { spec: agentTimeSpec, rows: agentTimeRows },
    sbi_card_downtime: { spec: downtimeSpec, rows: downtimeRows },
    sbi_card_pen_estimation: { spec: penEstimationSpec, rows: penRows },
    sbi_card_outcome: { spec: outcomeSpec, rows: outcomeRows },
  };
}

/** Maps rows through the real importers' mapRow and swaps the audit tail for the demo tag. */
export function toInserts(g: Generated, processId: string): Record<string, { columns: string[]; suffix: string; values: unknown[][]; errors: string[] }> {
  const out: Record<string, { columns: string[]; suffix: string; values: unknown[][]; errors: string[] }> = {};
  for (const [table, { spec, rows }] of Object.entries(g)) {
    const values: unknown[][] = []; const errors: string[] = [];
    rows.forEach((raw, i) => {
      const res = spec.mapRow(canonicalizeRow(raw, spec.headers), i + 1, { processId, batchId: DEMO_REF, userId: "" });
      if ("error" in res) { errors.push(`${table} row ${i + 1}: ${res.error}`); return; }
      if ("skip" in res) return;
      const v = [...res.values]; v.splice(v.length - 3, 3, DEMO_TAG, DEMO_REF, null);
      values.push([randomUUID(), processId, ...v]);
    });
    out[table] = { columns: spec.columns, suffix: `ON DUPLICATE KEY UPDATE ${spec.updateColumns.map((c) => `${c} = VALUES(${c})`).join(", ")}`, values, errors };
  }
  return out;
}

/** The dashboard finds the process BY CODE (migration 1985 merged the duplicate onto the real process, which took the code SBI_CARD). */
async function processId(): Promise<string | null> {
  const [r] = await db.execute<any[]>(`SELECT id, process_name FROM process_master WHERE process_code = 'SBI_CARD' AND active_status = 1 LIMIT 1`);
  const [byName] = await db.execute<any[]>(`SELECT id FROM process_master WHERE process_name = ? AND active_status = 1 LIMIT 1`, [SBI_CARD_PROCESS_NAME]);
  console.log(`process by code SBI_CARD: ${r[0] ? `"${r[0].process_name}"` : "none"}; the uploaders look it up by name "${SBI_CARD_PROCESS_NAME}": ${byName[0] ? (byName[0].id === r[0]?.id ? "same process" : "a DIFFERENT process") : "NOT FOUND"}`);
  return r[0]?.id ?? null;
}

async function counts(pid: string, from: string, to: string): Promise<Record<string, { demo: number; other: number }>> {
  const out: Record<string, { demo: number; other: number }> = {};
  for (const t of TABLES) {
    const dateCol = t === "sbi_card_roster" ? null : "report_date";
    const where = dateCol ? `process_id = ? AND ${dateCol} BETWEEN ? AND ?` : `process_id = ?`;
    const args = dateCol ? [pid, from, to] : [pid];
    const [r] = await db.execute<any[]>(
      `SELECT SUM(data_source = ? AND source_reference = ?) AS demo, SUM(NOT (data_source = ? AND source_reference = ?)) AS other FROM ${t} WHERE ${where}`,
      [DEMO_TAG, DEMO_REF, DEMO_TAG, DEMO_REF, ...args]);
    out[t] = { demo: Number(r[0]?.demo ?? 0), other: Number(r[0]?.other ?? 0) };
  }
  return out;
}

async function main(): Promise<void> {
  const mode = (process.argv.find((a) => a.startsWith("--mode="))?.slice(7) ?? "dry-run");
  if (!["dry-run", "seed", "remove"].includes(mode)) throw new Error(`--mode must be dry-run, seed or remove (got '${mode}')`);
  const end = process.env.DEMO_END ? new Date(`${process.env.DEMO_END}T00:00:00Z`) : new Date();
  const dates = demoDates(end); const [from, to] = [dates[0], dates[dates.length - 1]];
  const pid = await processId();
  if (!pid) throw new Error("no active process with code SBI_CARD");
  const gen = generate(dates); const ins = toInserts(gen, pid);
  const bad = Object.values(ins).flatMap((i) => i.errors);
  console.log(`demo window ${from}..${to}; rows to write: ${Object.entries(ins).map(([t, i]) => `${t.replace("sbi_card_", "")}=${i.values.length}`).join(" ")}`);
  if (bad.length) { console.log(`${bad.length} generated rows were rejected by the importer mappers:`); bad.slice(0, 10).forEach((m) => console.log("  " + m)); throw new Error("generator and importer disagree"); }
  const before = await counts(pid, from, to);
  for (const [t, c] of Object.entries(before)) console.log(`  ${t}: demo rows ${c.demo}, other rows ${c.other}`);

  if (mode === "dry-run") { console.log("dry-run: nothing written."); return; }
  if (mode === "seed") {
    const foreign = Object.entries(before).filter(([t, c]) => c.other > 0 && t !== "sbi_card_roster");
    if (foreign.length) throw new Error(`refusing to seed: real (non-demo) rows exist in ${foreign.map(([t]) => t).join(", ")} for ${from}..${to}`);
    for (const [t, i] of Object.entries(ins)) {
      for (let k = 0; k < i.values.length; k += 200) {
        const part = i.values.slice(k, k + 200);
        await db.execute(`INSERT INTO ${t} (${i.columns.join(", ")}) VALUES ${part.map(() => `(${i.columns.map(() => "?").join(",")})`).join(",")} ${i.suffix}`, part.flat() as never[]);
      }
    }
    console.log("seeded.");
  } else {
    for (const t of TABLES) {
      const [r] = await db.execute<any>(`DELETE FROM ${t} WHERE process_id = ? AND data_source = ? AND source_reference = ?`, [pid, DEMO_TAG, DEMO_REF]);
      console.log(`  removed ${t}: ${r.affectedRows}`);
    }
  }
  const after = await counts(pid, from, to);
  for (const [t, c] of Object.entries(after)) console.log(`  after ${t}: demo rows ${c.demo}, other rows ${c.other}`);
}

if (process.argv[1] && /sbi-card-demo-seed/.test(process.argv[1])) {
  main().then(() => process.exit(0), (e) => { console.error("FAILED:", (e as Error).message); process.exit(1); });
}
