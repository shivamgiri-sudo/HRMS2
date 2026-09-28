/**
 * One-off live verification for the new Housing Owner + Housing Premium
 * dashboards: builds real XLSX buffers using the EXACT example rows from
 * the user's own real prompt documents (Housing Owner.txt / # HOUSING
 * PREMIUM.txt), uploads them through the actual service functions, then
 * calls the actual KPI computation functions and checks the results are
 * sane (not mocked), then cleans up every row this test created.
 *
 * Run with: npx tsx scripts/test-housing-dashboards.ts
 */
import "dotenv/config";
import * as XLSX from "xlsx";
import { db } from "../src/db/mysql.js";
import * as ho from "../src/modules/housing-dashboards/housing-owner-dashboard.service.js";
import * as hp from "../src/modules/housing-dashboards/housing-premium-dashboard.service.js";

function bufferFrom(header: string[], rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function cleanup() {
  await db.execute(`DELETE FROM housing_owner_dashboard_sale_raw WHERE opp_id LIKE 'TEST%'`);
  await db.execute(`DELETE FROM housing_owner_dashboard_cdr_raw WHERE uid LIKE 'TEST%'`);
  await db.execute(`DELETE FROM housing_premium_dashboard_sale_raw WHERE order_id LIKE 'TEST%'`);
  await db.execute(`DELETE FROM housing_premium_dashboard_cdr_raw WHERE caller LIKE 'TEST%'`);
}

async function testHousingOwner() {
  console.log("\n=== HOUSING OWNER ===");
  // Real example row from Housing Owner.txt, tagged for cleanup
  const saleBuf = bufferFrom(
    ["Date", "Agent ID", "Agent Name", "Value", "Count", "Payment Mode", "Package Name", "Package Type", "Opp ID", "Discount %", "TL Name", "Week"],
    [["01-Sep-26", "109221296", "Himanshu Kumar MCN", 3245, 1, "Payment Link", "RENT", "ASSISTED", "TEST_11904708", 49.99, "Vintage", "Week-1"]],
  );
  const saleResult = await ho.uploadSaleRaw(saleBuf, "test-user");
  console.log("[HO] sale upload result:", JSON.stringify(saleResult, null, 2));

  const cdrBuf = bufferFrom(
    ["UID", "Date", "Agent", "Email ID", "Total Calls", "Calls Handled", "Connected", "Not Connected", "TL Name", "Average Talk time", "AM"],
    [["TEST_46266", "01-Sep-26", "Himanshu Kumar MCN", "kumarvikashyap@gmail.com", 443, 123, 300, 143, "Vintage", "00:08:04", "Aneesha"]],
  );
  const cdrResult = await ho.uploadCdrRaw(cdrBuf, "test-user");
  console.log("[HO] cdr upload result:", JSON.stringify(cdrResult, null, 2));

  const overview = await ho.getOverview({});
  console.log("[HO] overview:", JSON.stringify(overview, null, 2));
  const agents = await ho.getAgentPerformance({});
  console.log("[HO] agent performance:", JSON.stringify(agents, null, 2));

  const ok = overview.sales.totalSalesValue >= 3245 && overview.calling.totalCalls >= 443 &&
    overview.conversion !== null && agents.some((a) => (a as any).agent === "Himanshu Kumar MCN");
  console.log("[HO] PASS:", ok);
  return ok;
}

async function testHousingPremium() {
  console.log("\n=== HOUSING PREMIUM ===");
  const saleBuf = bufferFrom(
    ["Order_ID", "coupon_code", "Amount", "Created_At", "Partner_Name", "Agent_Name", "TL_Name", "Time", "Assign_TL", "Order_Value", "Target", "Slots", "Count", "Date", "Week", "Hour"],
    [["TEST_903516000000", "hp60hritik1", 1274, "1-9-2026 0:00", "Mas Callnet", "Hritik Gautam", "Arbaz Khan", "08:18:11", "Sameer", 1274, 2444, "8", 1, "1-Sep-26", "Week-1", 8]],
  );
  const saleResult = await hp.uploadSaleRaw(saleBuf, "test-user");
  console.log("[HP] sale upload result:", JSON.stringify(saleResult, null, 2));

  const cdrBuf = bufferFrom(
    ["CALLER", "MEMBER", "End Time", "DURATION", "STATUS", "Routing Numbers", "Routing Status", "Talk Duration", "Ringing Duration", "Time", "Date", "TL Name"],
    [["TEST_8967972399", "Hritik Gautam", "03-09-2026 19:39", 17, "Answered", "8451163698", "ANSWER", 3, 14, "19", "03-09-2026", "Arbaz"]],
  );
  const cdrResult = await hp.uploadCdrRaw(cdrBuf, "test-user");
  console.log("[HP] cdr upload result:", JSON.stringify(cdrResult, null, 2));

  const overview = await hp.getOverview({});
  console.log("[HP] overview:", JSON.stringify(overview, null, 2));
  const agents = await hp.getAgentPerformance({});
  console.log("[HP] agent performance:", JSON.stringify(agents, null, 2));
  const target = await hp.getTargetAchievement({});
  console.log("[HP] target achievement:", JSON.stringify(target, null, 2));
  const hourly = await hp.getHourlyAnalysis({});
  console.log("[HP] hourly:", JSON.stringify(hourly, null, 2));

  const ok = overview.sales.totalSalesValue >= 1274 && overview.calling.totalCalls >= 1 &&
    overview.calling.answered >= 1 && agents.some((a) => (a as any).agent === "Hritik Gautam");
  console.log("[HP] PASS:", ok);
  return ok;
}

async function main() {
  await cleanup();
  const hoOk = await testHousingOwner();
  const hpOk = await testHousingPremium();
  await cleanup();
  console.log("\n=== FINAL:", hoOk && hpOk ? "PASS" : "FAIL", "===");
  process.exit(hoOk && hpOk ? 0 : 1);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
