/**
 * Cost-centre activity reconciliation — READ-ONLY diagnostic.
 *
 * HRMS2 treats every cost_centre_master row with active_status = 1 as live, and
 * computeLineAllocations() splits branch-common budget lines across ALL of them. Stale rows
 * therefore absorb real budget and distort every downstream P&L / consolidation / GRN-coverage
 * figure. This script reconciles HRMS against the authoritative upstream signals so the stale
 * rows can be identified before any correction is proposed.
 *
 * ACTIVITY RULE (agreed with the business): a cost centre is ACTIVE if it has salary records in
 * the target month. Salary paid is unambiguous and, unlike invoicing, correctly captures INTERNAL
 * cost centres (Back Office, IT, Finance) that never raise a client invoice. Invoicing is still
 * reported so "billing but no staff" cases surface rather than being silently dropped.
 *
 * PROCESS IDENTITY: client, falling back to process_name. process_name is blank for ~40% of
 * active cost centres, so keying on it alone loses them.
 *
 * SAFETY: issues SELECT statements only, against both databases. It writes nothing anywhere.
 * db_bill is an upstream read-only source per the project charter. Credentials come from the
 * environment and are never logged.
 *
 * Usage:
 *   BILL_HOST=... BILL_USER=... BILL_PASS=... BILL_DB=db_bill \
 *   npx tsx src/scripts/reconcile-cost-centre-activity.ts [--month=2026-06] [--csv=out.csv]
 */
import fs from "fs";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

type Verdict = "ACTIVE" | "BILLING_ONLY" | "DORMANT";

interface Row {
  branch: string;
  costCentreCode: string;
  hrmsActive: number;
  hrmsCloseDate: string | null;
  hrmsHeadcount: number;
  salaryHeadcount: number;
  lastInvoice: string | null;
  billingFlag: number | null;
  process: string;
  verdict: Verdict;
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

/** Default to the most recent fully-processed salary month rather than the current one, which
 *  is typically mid-cycle and would under-report activity. */
function defaultMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const month = arg("month", defaultMonth());
  const csvPath = arg("csv", "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`--month must be YYYY-MM (got "${month}")`);

  for (const k of ["BILL_HOST", "BILL_USER", "BILL_PASS", "BILL_DB"]) {
    if (!process.env[k]) throw new Error(`Missing env ${k} — db_bill connection details are required`);
  }

  const bill = await mysql.createConnection({
    host: process.env.BILL_HOST,
    user: process.env.BILL_USER,
    password: process.env.BILL_PASS,
    database: process.env.BILL_DB,
    connectTimeout: 30_000,
  });
  const hrms = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectTimeout: 30_000,
    // Match the app pool (backend/src/db/mysql.ts). Without this, DATE columns come back as JS
    // Date objects and naive string-slicing silently drops the year ("Tue Dec 31").
    dateStrings: true,
  });

  try {
    // ── upstream: salary (activity), invoicing (secondary), master (process identity) ────────
    const [salaryRows] = await bill.query<any[]>(
      `SELECT CostCenter AS cc, COUNT(*) AS headcount
         FROM salary_data
        WHERE DATE_FORMAT(SalDate, '%Y-%m') = ?
        GROUP BY CostCenter`,
      [month]
    );
    const salary = new Map<string, number>(
      salaryRows.map((r) => [String(r.cc ?? "").trim(), Number(r.headcount)])
    );

    const [masterRows] = await bill.query<any[]>(
      `SELECT m.cost_center AS cc, m.branch, m.Billing,
              COALESCE(NULLIF(TRIM(m.client), ''), NULLIF(TRIM(m.process_name), ''), '(unmapped)') AS process,
              (SELECT MAX(i.createdate) FROM inv_particulars i WHERE i.cost_center_id = m.id) AS last_invoice
         FROM cost_master m`
    );
    const master = new Map<string, any>(
      masterRows.map((r) => [String(r.cc ?? "").trim(), r])
    );

    // ── HRMS: what the app currently believes is live ────────────────────────────────────────
    // LEFT JOIN on branch_master deliberately: an inner join silently drops cost centres whose
    // branch_id is missing or dangling, which is exactly the kind of orphan a reconciliation
    // report exists to surface. They appear under "(no branch)".
    const [hrmsRows] = await hrms.query<any[]>(
      `SELECT COALESCE(b.branch_name, '(no branch)') AS branch_name,
              cc.cost_centre_code, cc.active_status, cc.close_date,
              COUNT(e.id) AS hrms_headcount
         FROM cost_centre_master cc
         LEFT JOIN branch_master b ON b.id = cc.branch_id
         LEFT JOIN employees e ON e.cost_centre_id = cc.id AND e.active_status = 1
        GROUP BY b.branch_name, cc.cost_centre_code, cc.active_status, cc.close_date`
    );

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);

    const rows: Row[] = hrmsRows.map((r) => {
      const code = String(r.cost_centre_code ?? "").trim();
      const m = master.get(code);
      const salaryHeadcount = salary.get(code) ?? 0;
      const lastInvoice = m?.last_invoice ? new Date(m.last_invoice) : null;
      const billedRecently = Boolean(lastInvoice && lastInvoice >= cutoff);

      const verdict: Verdict = salaryHeadcount > 0 ? "ACTIVE" : billedRecently ? "BILLING_ONLY" : "DORMANT";

      return {
        branch: String(r.branch_name ?? "(none)"),
        costCentreCode: code,
        hrmsActive: Number(r.active_status ?? 0),
        hrmsCloseDate: r.close_date ? String(r.close_date).slice(0, 10) : null,
        hrmsHeadcount: Number(r.hrms_headcount ?? 0),
        salaryHeadcount,
        lastInvoice: lastInvoice ? lastInvoice.toISOString().slice(0, 10) : null,
        billingFlag: m ? Number(m.Billing) : null,
        process: m?.process ?? "(not in billing master)",
        verdict,
      };
    });

    report(rows, month);
    if (csvPath) {
      const header = "branch,cost_centre_code,verdict,hrms_active,hrms_close_date,hrms_headcount,salary_headcount,last_invoice,billing_flag,process";
      const body = rows.map((r) =>
        [r.branch, r.costCentreCode, r.verdict, r.hrmsActive, r.hrmsCloseDate ?? "", r.hrmsHeadcount,
         r.salaryHeadcount, r.lastInvoice ?? "", r.billingFlag ?? "", `"${r.process.replace(/"/g, "''")}"`].join(",")
      );
      fs.writeFileSync(csvPath, [header, ...body].join("\n"), "utf8");
      console.log(`\nCSV written: ${csvPath}`);
    }
  } finally {
    await bill.end();
    await hrms.end();
  }
}

function report(rows: Row[], month: string) {
  const active = rows.filter((r) => r.verdict === "ACTIVE");
  const billingOnly = rows.filter((r) => r.verdict === "BILLING_ONLY");
  const dormant = rows.filter((r) => r.verdict === "DORMANT");

  console.log("=".repeat(78));
  console.log(`COST-CENTRE ACTIVITY RECONCILIATION — salary month ${month}`);
  console.log("READ-ONLY. No data was modified in mas_hrms or db_bill.");
  console.log("=".repeat(78));

  console.log(`\nHRMS cost centres flagged active_status=1 : ${rows.filter((r) => r.hrmsActive === 1).length}`);
  console.log(`  ACTIVE       (salary in ${month})          : ${active.length}`);
  console.log(`  BILLING_ONLY (invoiced <12m, no salary)  : ${billingOnly.length}`);
  console.log(`  DORMANT      (neither)                   : ${dormant.length}`);

  // ── branch rollup ─────────────────────────────────────────────────────────────────────────
  const byBranch = new Map<string, { active: number; billing: number; dormant: number; staff: number }>();
  for (const r of rows) {
    const b = byBranch.get(r.branch) ?? { active: 0, billing: 0, dormant: 0, staff: 0 };
    if (r.verdict === "ACTIVE") b.active++;
    else if (r.verdict === "BILLING_ONLY") b.billing++;
    else b.dormant++;
    b.staff += r.salaryHeadcount;
    byBranch.set(r.branch, b);
  }
  console.log("\n" + "-".repeat(78));
  console.log("BRANCHES");
  console.log("-".repeat(78));
  console.log("branch".padEnd(32) + "active  billing  dormant  staff   verdict");
  [...byBranch.entries()]
    .sort((a, b) => b[1].staff - a[1].staff || b[1].active - a[1].active)
    .forEach(([name, v]) => {
      console.log(
        name.slice(0, 30).padEnd(32) +
        String(v.active).padEnd(8) + String(v.billing).padEnd(9) +
        String(v.dormant).padEnd(9) + String(v.staff).padEnd(8) +
        (v.active > 0 ? "ACTIVE" : v.billing > 0 ? "BILLING ONLY" : "INACTIVE")
      );
    });

  // ── process rollup (client, falling back to process_name) ─────────────────────────────────
  const byProcess = new Map<string, { ccs: number; staff: number }>();
  for (const r of active) {
    const p = byProcess.get(r.process) ?? { ccs: 0, staff: 0 };
    p.ccs++; p.staff += r.salaryHeadcount;
    byProcess.set(r.process, p);
  }
  console.log("\n" + "-".repeat(78));
  console.log(`ACTIVE PROCESSES — ${byProcess.size} distinct (identity: client -> process_name)`);
  console.log("-".repeat(78));
  console.log("process / client".padEnd(48) + "CCs   staff");
  [...byProcess.entries()].sort((a, b) => b[1].staff - a[1].staff).forEach(([p, v]) =>
    console.log(p.replace(/\s+/g, " ").slice(0, 46).padEnd(48) + String(v.ccs).padEnd(6) + v.staff)
  );

  // ── the correction candidates ─────────────────────────────────────────────────────────────
  const candidates = rows.filter((r) => r.hrmsActive === 1 && r.verdict === "DORMANT");
  console.log("\n" + "-".repeat(78));
  console.log(`CORRECTION CANDIDATES — active in HRMS but DORMANT upstream: ${candidates.length}`);
  console.log("-".repeat(78));
  console.log("branch".padEnd(26) + "cost_centre".padEnd(26) + "hrmsHC  last_invoice");
  candidates
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.costCentreCode.localeCompare(b.costCentreCode))
    .forEach((r) => console.log(
      r.branch.slice(0, 24).padEnd(26) + r.costCentreCode.slice(0, 24).padEnd(26) +
      String(r.hrmsHeadcount).padEnd(8) + (r.lastInvoice ?? "never")
    ));

  if (billingOnly.length) {
    console.log("\n" + "-".repeat(78));
    console.log("NEEDS A BUSINESS RULING — recently invoiced but no salary (client work, no staff):");
    console.log("-".repeat(78));
    billingOnly.forEach((r) =>
      console.log("  " + r.branch.padEnd(24) + r.costCentreCode.padEnd(26) + "last invoice " + r.lastInvoice)
    );
  }

  // ── anomalies worth a human decision ──────────────────────────────────────────────────────
  console.log("\n" + "-".repeat(78));
  console.log("DATA-QUALITY ANOMALIES");
  console.log("-".repeat(78));

  const nameKey = new Map<string, string[]>();
  for (const b of byBranch.keys()) {
    const k = b.trim().toLowerCase();
    nameKey.set(k, [...(nameKey.get(k) ?? []), b]);
  }
  [...nameKey.values()].filter((v) => v.length > 1)
    .forEach((v) => console.log(`  duplicate branch records: ${v.join("  vs  ")}`));

  [...byBranch.keys()].filter((b) => /test|demo|smoke/i.test(b))
    .forEach((b) => console.log(`  test/demo branch present in real data: ${b}`));

  const notInBilling = rows.filter((r) => r.hrmsActive === 1 && r.process === "(not in billing master)");
  if (notInBilling.length) console.log(`  active in HRMS but absent from billing master: ${notInBilling.length}`);

  const staffedNotMapped = active.filter((r) => r.hrmsHeadcount === 0);
  if (staffedNotMapped.length) {
    console.log(`  paid staff upstream but 0 employees mapped in HRMS: ${staffedNotMapped.length}`);
    staffedNotMapped.slice(0, 8).forEach((r) =>
      console.log(`     ${r.branch.padEnd(24)}${r.costCentreCode.padEnd(24)}salary HC=${r.salaryHeadcount}`));
  }

  console.log("\nNothing was changed. Review the candidates above before any correction is applied.");
}

main().catch((e) => {
  console.error("reconciliation failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
