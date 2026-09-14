import "dotenv/config";
import mysql from "mysql2/promise";

function sq(v) { return (v ?? "").replace(/^["']|["']$/g, ""); }

async function main() {
  const hrms = await mysql.createConnection({
    host: "192.168.10.6", user: sq(process.env.DB_USER),
    password: sq(process.env.DB_PASSWORD), database: sq(process.env.DB_NAME),
  });

  const [[noHeaderAtAll]] = await hrms.query(`
    SELECT COUNT(*) n, COALESCE(SUM(g.amount_with_tax),0) total
    FROM grn_request g
    WHERE g.accounting_period >= '2026-04' AND g.accounting_period <= '2027-03'
      AND g.bill_source_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)
      AND NOT EXISTS (SELECT 1 FROM finance_budget_header h WHERE h.branch_id = g.branch_id AND h.financial_year = g.financial_year)`);
  console.log("In-scope GRNs whose branch has NO FY2026-27 budget header at all:", noHeaderAtAll);

  const [[ccOnlyMatchFixed]] = await hrms.query(`
    SELECT COUNT(*) n, COALESCE(SUM(g.amount_with_tax),0) total
    FROM grn_request g
    WHERE g.accounting_period >= '2026-04' AND g.accounting_period <= '2027-03'
      AND g.bill_source_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)
      AND EXISTS (
        SELECT 1 FROM finance_budget_line l
        JOIN finance_budget_header h ON h.id = l.budget_id
        WHERE l.cost_centre_id = g.cost_centre_id AND h.branch_id = g.branch_id AND h.financial_year = g.financial_year
      )`);
  console.log("In-scope GRNs whose own cost centre has at least one budget line (any head) this FY:", ccOnlyMatchFixed);

  const [byBranch] = await hrms.query(`
    SELECT b.branch_name, COUNT(*) n, COALESCE(SUM(g.amount_with_tax),0) total
    FROM grn_request g
    JOIN branch_master b ON b.id = g.branch_id
    WHERE g.accounting_period >= '2026-04' AND g.accounting_period <= '2027-03'
      AND g.bill_source_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)
      AND NOT EXISTS (SELECT 1 FROM finance_budget_header h WHERE h.branch_id = g.branch_id AND h.financial_year = g.financial_year)
    GROUP BY b.branch_name
    ORDER BY total DESC LIMIT 15`);
  console.log("Branches with real FY spend but NO FY2026-27 budget at all:");
  console.log(JSON.stringify(byBranch, null, 2));

  await hrms.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
