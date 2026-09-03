#!/usr/bin/env node
/**
 * Staffless cost centres — the attribution worklist.
 *
 * WHAT THIS IS FOR. pnl-cost-leakage.service.ts reports that active cost centres with no staff
 * carry real GRN spend which reaches no process P&L line: measured 2026-09-03, 39 centres holding
 * Rs 61.37 lakh for FY2026-27. The reason is structural — a cost centre's process is inferred from
 * the employees posted to it (cost_centre_master.process_id is NULL on every live row), so a centre
 * with nobody on it resolves to no process and its cost lands only in branch and company totals.
 * Every process Operating Profit % is flattered by exactly that amount.
 *
 * Detecting it was the easy half. Fixing it means deciding which process owns each centre's spend,
 * and that is a finance judgement. This script exists so that judgement is made against evidence
 * rather than from a blank page: it proposes a process only where the data supports one, names the
 * evidence, and says plainly when there is none.
 *
 * EVIDENCE TIERS, strongest first:
 *
 *   HISTORY  Someone actually worked in this cost centre under a process. Taken from employees ever
 *            posted there (any status), by modal process. This is the strongest signal available
 *            because it reflects real staffing, not naming.
 *
 *   NAME     The centre's own client_name matches a process_master.process_name exactly. Weaker:
 *            it says the centre is labelled for that client, not that the spend served it. Exact
 *            match only — no fuzzy matching, because a wrong attribution moves real money onto the
 *            wrong P&L and is harder to notice than a blank.
 *
 *   NONE     Neither applies. Reported with whatever client/process label the centre carries, as a
 *            hint for the person deciding. Deliberately NOT guessed.
 *
 * WHAT IT DELIBERATELY DOES NOT USE. grn_cost_allocation carries a process_id column, but measured
 * live it is NULL on all 343 allocation rows belonging to these centres — so it looks like evidence
 * and is not. Checked rather than assumed.
 *
 * READ-ONLY. This script writes nothing, to the database or anywhere else. It prints a table and,
 * with --csv, the same rows for a spreadsheet.
 *
 * Usage:
 *   node scripts/staffless-cost-centre-worklist.mjs [--period YYYY-MM] [--csv]
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const args = process.argv.slice(2);
const csvMode = args.includes("--csv");
const periodArg = (() => {
  const i = args.indexOf("--period");
  return i >= 0 ? args[i + 1] : null;
})();

/** Indian financial year (April-March) containing the period, matching pnl-cost-leakage.service.ts. */
function financeYearBounds(period) {
  const [y, m] = period.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return { label: `FY${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`, from: `${startYear}-04` };
}

function istToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const period = periodArg ?? istToday().slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(period)) {
  console.error("period must be YYYY-MM");
  process.exit(1);
}
const fy = financeYearBounds(period);

const money = (n) => "Rs " + Math.round(Number(n || 0)).toLocaleString("en-IN");

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

/*
 * Spend is bounded at the reporting period, not the end of the financial year: a GRN dated to a
 * future accounting month has deliberately not been budgeted yet and is not a gap. Same rule the
 * leakage report applies, so the two figures reconcile.
 */
const [rows] = await conn.execute(
  `SELECT ccm.id,
          ccm.cost_centre_code,
          ccm.cost_centre_name,
          ccm.client_name,
          ccm.process_name_bill,
          bm.branch_name,
          COUNT(g.id)                                              AS grn_count,
          SUM(COALESCE(g.pnl_cost_amount, g.amount_with_tax))      AS amount,
          (SELECT e2.process_id FROM employees e2
            WHERE e2.cost_centre_id = ccm.id AND e2.process_id IS NOT NULL
            GROUP BY e2.process_id ORDER BY COUNT(*) DESC LIMIT 1) AS history_process_id,
          (SELECT COUNT(*) FROM employees e3
            WHERE e3.cost_centre_id = ccm.id AND e3.process_id IS NOT NULL) AS history_staff,
          (SELECT pm.id FROM process_master pm
            WHERE UPPER(TRIM(pm.process_name)) = UPPER(TRIM(ccm.client_name)) LIMIT 1) AS name_process_id
     FROM cost_centre_master ccm
     JOIN grn_request g
       ON g.cost_centre_id = ccm.id
      AND g.status NOT IN ('draft', 'rejected', 'cancelled')
      AND g.accounting_period BETWEEN ? AND ?
     LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
    WHERE ccm.active_status = 1
      AND NOT EXISTS (SELECT 1 FROM employees e
                       WHERE e.cost_centre_id = ccm.id AND e.active_status = 1)
    GROUP BY ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, ccm.client_name,
             ccm.process_name_bill, bm.branch_name
    ORDER BY amount DESC`,
  [fy.from, period],
);

// Resolve the proposed process ids to names in one pass rather than per row.
const ids = [...new Set(rows.flatMap((r) => [r.history_process_id, r.name_process_id]).filter(Boolean))];
const nameById = new Map();
if (ids.length) {
  const [pRows] = await conn.execute(
    `SELECT id, process_name FROM process_master WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  for (const p of pRows) nameById.set(String(p.id), String(p.process_name));
}

const worklist = rows.map((r) => {
  let tier = "NONE", processId = null, evidence = "";
  if (r.history_process_id) {
    tier = "HISTORY";
    processId = String(r.history_process_id);
    evidence = `${r.history_staff} employee(s) posted here under this process`;
  } else if (r.name_process_id) {
    tier = "NAME";
    processId = String(r.name_process_id);
    evidence = `cost centre client_name "${r.client_name}" matches this process exactly`;
  } else {
    evidence = r.client_name || r.process_name_bill
      ? `no match; centre is labelled "${r.client_name || r.process_name_bill}"`
      : "no history, no client label — needs a decision from scratch";
  }
  return {
    code: r.cost_centre_code, name: r.cost_centre_name, branch: r.branch_name || "-",
    grns: Number(r.grn_count), amount: Number(r.amount || 0),
    tier, proposedProcess: processId ? (nameById.get(processId) ?? processId) : "", processId, evidence,
  };
});

if (csvMode) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  console.log(["cost_centre_code","cost_centre_name","branch","grn_count","amount_inr","evidence_tier","proposed_process","proposed_process_id","evidence"].join(","));
  for (const w of worklist) {
    console.log([w.code, w.name, w.branch, w.grns, Math.round(w.amount), w.tier, w.proposedProcess, w.processId || "", w.evidence].map(esc).join(","));
  }
} else {
  const total = worklist.reduce((s, w) => s + w.amount, 0);
  const byTier = (t) => worklist.filter((w) => w.tier === t);
  console.log(`\nSTAFFLESS COST CENTRE WORKLIST — ${fy.label}, ${fy.from} to ${period}`);
  console.log(`${worklist.length} cost centres carrying ${money(total)} that reaches no process P&L line.\n`);
  for (const t of ["HISTORY", "NAME", "NONE"]) {
    const set = byTier(t);
    if (!set.length) continue;
    const sub = set.reduce((s, w) => s + w.amount, 0);
    const header = { HISTORY: "PROPOSED from staffing history — strongest evidence",
                     NAME: "PROPOSED from the centre's own client label — weaker, confirm before applying",
                     NONE: "NEEDS A DECISION — no evidence to propose from" }[t];
    console.log(`── ${header}`);
    console.log(`   ${set.length} centres, ${money(sub)}\n`);
    for (const w of set) {
      console.log(`   ${w.code}  (${w.branch})`);
      console.log(`     ${money(w.amount)} over ${w.grns} GRN(s)`);
      if (w.proposedProcess) console.log(`     -> propose: ${w.proposedProcess}`);
      console.log(`     evidence: ${w.evidence}\n`);
    }
  }
  /*
   * How many decisions this actually is.
   *
   * The per-centre list reads as 39 investigations, which is why a finding like this usually goes
   * unworked. It is not: the undecidable tail clusters almost entirely inside one branch of small
   * per-client cost centres, so a single ruling covers all of them. Grouping the tail by branch is
   * what turns the list into something a person can finish in one sitting.
   */
  const tail = byTier("NONE");
  if (tail.length) {
    const byBranch = new Map();
    for (const w of tail) {
      const e = byBranch.get(w.branch) ?? { n: 0, amount: 0 };
      e.n += 1; e.amount += w.amount;
      byBranch.set(w.branch, e);
    }
    console.log("-- THE TAIL, GROUPED - one ruling per branch may settle many centres at once");
    for (const [branch, e] of [...byBranch.entries()].sort((a, b) => b[1].amount - a[1].amount)) {
      console.log("   " + branch.padEnd(24) + String(e.n).padStart(3) + " centres   " + money(e.amount));
    }
    console.log("");
    const tailBranches = byBranch.size;
    console.log("This is " + (byTier("HISTORY").length + byTier("NAME").length + tailBranches)
      + " decision(s), not " + worklist.length + ": "
      + byTier("HISTORY").length + " evidenced by staffing, "
      + byTier("NAME").length + " by client label, and a tail spanning "
      + tailBranches + " branch(es).");
    console.log("");
  }

  console.log("Nothing here has been changed. Attribution is a finance decision;");
  console.log("this lists the spend and the evidence so it can be made once, per centre.\n");
}

await conn.end();
