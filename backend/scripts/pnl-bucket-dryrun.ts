/**
 * Dry run of the Agent / DSC / BMC split, per period and branch, READ-ONLY (HRMS SELECTs only).
 * Compares the rules active for the period with the same rules minus the candidate set
 * (designation EXECUTIVE / SENIOR EXECUTIVE, department OPERATIONS / CUSTOMER SERVICE / TELESALES,
 * seeded 2026-09-04 09:44:44), using the exact bucketing bpo-pnl.service.ts uses for closed months.
 *
 *   npx tsx scripts/pnl-bucket-dryrun.ts YYYY-MM [YYYY-MM ...]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { bucketingInternals as b } from "../src/modules/process-pnl/bpo-pnl.service.js";

const CANDIDATES = [
  ["designation", "EXECUTIVE"], ["designation", "SENIOR EXECUTIVE"],
  ["department", "OPERATIONS"], ["department", "CUSTOMER SERVICE"], ["department", "TELESALES"],
];
const isCandidate = (r: any) => CANDIDATES.some(([t, k]) => r.scope_type === t && String(r.scope_key).trim().toUpperCase() === k);
const r0 = (v: number) => Math.round(v);

(async () => {
  const periods = process.argv.slice(2);
  if (!periods.length) throw new Error("pass periods");
  const [br] = await db.query<RowDataPacket[]>("SELECT id, branch_name FROM branch_master");
  const branchName = new Map(br.map((x) => [String(x.id), String(x.branch_name)]));
  for (const period of periods) {
    const people: any[] = await b.getPayrollPeople(period);
    const rules: any[] = await b.getClassificationRules(period);
    const without = rules.filter((r) => !isCandidate(r));
    console.log("DRY_META " + JSON.stringify({ period, people: people.length, rules: rules.length, candidateRulesActive: rules.length - without.length }));
    const sum = (rs: any[]) => {
      const out = new Map<string, { agent: number; dsc: number; bmc: number; nAgent: number; nDsc: number; nBmc: number }>();
      const hits = new Map<string, { n: number; cost: number }>();
      for (const p of people) {
        const cost = Number(p.loaded_cost ?? 0);
        const rule = b.matchClassification(p, rs);
        const bucket = rule?.pnl_bucket ?? (p.process_id ? (b.isSupportRole(p) ? "dsc_people" : "agent_salary") : "bmc_people");
        const key = branchName.get(String(p.branch_id)) ?? "Unassigned";
        const c = out.get(key) ?? { agent: 0, dsc: 0, bmc: 0, nAgent: 0, nDsc: 0, nBmc: 0 };
        if (bucket === "agent_salary") { c.agent += cost; c.nAgent++; } else if (bucket === "dsc_people") { c.dsc += cost; c.nDsc++; } else { c.bmc += cost; c.nBmc++; }
        out.set(key, c);
        if (rule) { const k = `${rule.scope_type}:${rule.scope_key}->${rule.pnl_bucket}`; const h = hits.get(k) ?? { n: 0, cost: 0 }; h.n++; h.cost += cost; hits.set(k, h); }
      }
      return { out, hits };
    };
    const cur = sum(rules), cand = sum(without);
    for (const [name, c] of [...cur.out.entries()].sort()) {
      const d = cand.out.get(name)!;
      console.log("DRY_ROW " + JSON.stringify({
        period, branch: name,
        current: { agent: r0(c.agent), dsc: r0(c.dsc), bmc: r0(c.bmc), nAgent: c.nAgent, nDsc: c.nDsc },
        withoutCandidates: { agent: r0(d.agent), dsc: r0(d.dsc), bmc: r0(d.bmc), nAgent: d.nAgent, nDsc: d.nDsc },
        totalCurrent: r0(c.agent + c.dsc + c.bmc), totalWithout: r0(d.agent + d.dsc + d.bmc),
      }));
    }
    for (const [k, h] of [...cur.hits.entries()].sort((a, c) => c[1].cost - a[1].cost).slice(0, 25)) console.log("DRY_RULEHIT " + JSON.stringify({ period, rule: k, people: h.n, cost: r0(h.cost) }));
    // Who is DSC once the candidates are gone: department x designation, to eyeball for agents left in DSC.
    const mix = new Map<string, { n: number; cost: number }>();
    for (const p of people) {
      const rule = b.matchClassification(p, without);
      const bucket = rule?.pnl_bucket ?? (p.process_id ? (b.isSupportRole(p) ? "dsc_people" : "agent_salary") : "bmc_people");
      if (bucket !== "dsc_people") continue;
      const k = `${p.department_name ?? "-"} | ${p.designation_name ?? "-"}`; const m = mix.get(k) ?? { n: 0, cost: 0 }; m.n++; m.cost += Number(p.loaded_cost ?? 0); mix.set(k, m);
    }
    for (const [k, m] of [...mix.entries()].sort((a, c) => c[1].cost - a[1].cost).slice(0, 12)) console.log("DRY_DSCMIX " + JSON.stringify({ period, who: k, people: m.n, cost: r0(m.cost) }));
  }
  await new Promise((resolve) => process.stdout.write("DRY_DONE\n", resolve));
  process.exit(0);
})();
