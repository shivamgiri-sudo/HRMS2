import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), ".env") });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface QueryResult {
  report_type: string;
  [key: string]: unknown;
}

async function executeSalesFunnelReport(): Promise<void> {
  let connection: mysql.Connection | null = null;

  try {
    // Create connection to db_external (using same credentials as main DB)
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: "db_external",
      multipleStatements: true,
    });

    console.log("✓ Connected to db_external database\n");

    // Query 1: Overall Sales Funnel by Process
    console.log("=" + "=".repeat(99));
    console.log("1. OVERALL SALES FUNNEL BY PROCESS (Last 90 Days)");
    console.log("=" + "=".repeat(99));

    const [funnelRows] = await connection.query(`
      SELECT
        COALESCE(ProcessName, 'Unknown') as process,
        COUNT(*) as total_calls,
        COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as offers,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales,
        ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as conversion_rate_pct
      FROM db_external.CallDetails
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY ProcessName
      ORDER BY total_calls DESC
    `);

    console.log(
      "PROCESS | TOTAL_CALLS | OFFERS | SALES | CONVERSION_RATE (%)"
    );
    console.log("-".repeat(99));
    for (const row of funnelRows as QueryResult[]) {
      console.log(
        `${String(row.process).padEnd(30)} | ${String(row.total_calls).padEnd(11)} | ${String(row.offers).padEnd(6)} | ${String(row.sales).padEnd(5)} | ${row.conversion_rate_pct}%`
      );
    }
    console.log();

    // Query 2: Sales Conversion Trend Over 90 Days
    console.log("=" + "=".repeat(99));
    console.log("2. SALES CONVERSION TREND (Last 90 Days - Daily)");
    console.log("=" + "=".repeat(99));

    const [trendRows] = await connection.query(`
      SELECT
        DATE(CallDate) as date,
        COUNT(*) as daily_calls,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as daily_sales,
        ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as daily_conversion_rate
      FROM db_external.CallDetails
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY DATE(CallDate)
      ORDER BY date DESC
      LIMIT 30
    `);

    console.log("DATE       | DAILY_CALLS | DAILY_SALES | CONVERSION_RATE (%)");
    console.log("-".repeat(99));
    for (const row of trendRows as QueryResult[]) {
      console.log(
        `${String(row.date).padEnd(10)} | ${String(row.daily_calls).padEnd(11)} | ${String(row.daily_sales).padEnd(11)} | ${row.daily_conversion_rate}%`
      );
    }
    console.log();

    // Query 3: Offer Acceptance Rate by Process
    console.log("=" + "=".repeat(99));
    console.log("3. OFFER ACCEPTANCE RATE BY PROCESS (Last 90 Days)");
    console.log("=" + "=".repeat(99));

    const [offerRows] = await connection.query(`
      SELECT
        COALESCE(ProcessName, 'Unknown') as process,
        COUNT(*) as total_calls,
        COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as offers_made,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as offers_accepted,
        ROUND(100 * COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as offer_rate,
        ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END), 0), 2) as acceptance_rate
      FROM db_external.CallDetails
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY ProcessName
      ORDER BY offers_made DESC
    `);

    console.log(
      "PROCESS | TOTAL_CALLS | OFFERS_MADE | ACCEPTED | OFFER_RATE (%) | ACCEPTANCE_RATE (%)"
    );
    console.log("-".repeat(99));
    for (const row of offerRows as QueryResult[]) {
      console.log(
        `${String(row.process).padEnd(30)} | ${String(row.total_calls).padEnd(11)} | ${String(row.offers_made).padEnd(11)} | ${String(row.offers_accepted).padEnd(8)} | ${String(row.offer_rate).padEnd(14)} | ${row.acceptance_rate}%`
      );
    }
    console.log();

    // Query 4: Time from First Call to Sale
    console.log("=" + "=".repeat(99));
    console.log("4. TIME FROM FIRST CALL TO SALE - TOP AGENTS (Last 90 Days)");
    console.log("=" + "=".repeat(99));

    const [durationRows] = await connection.query(`
      SELECT
        COALESCE(ProcessName, 'Unknown') as process,
        COALESCE(AgentName, 'Unknown') as agent,
        MIN(CallDate) as first_call_date,
        MAX(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN CallDate END) as sale_date,
        DATEDIFF(MAX(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN CallDate END), MIN(CallDate)) as days_to_sale,
        COUNT(*) as total_calls_before_sale,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales_count
      FROM db_external.CallDetails
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND (SaleDone = 'Yes' OR SaleDone = '1')
      GROUP BY ProcessName, AgentName
      HAVING sale_date IS NOT NULL
      ORDER BY days_to_sale ASC, sales_count DESC
      LIMIT 20
    `);

    console.log(
      "PROCESS | AGENT | FIRST_CALL | SALE_DATE | DAYS_TO_SALE | TOTAL_CALLS | SALES_COUNT"
    );
    console.log("-".repeat(99));
    for (const row of durationRows as QueryResult[]) {
      console.log(
        `${String(row.process).padEnd(20)} | ${String(row.agent).padEnd(15)} | ${String(row.first_call_date).padEnd(10)} | ${String(row.sale_date).padEnd(10)} | ${String(row.days_to_sale).padEnd(12)} | ${String(row.total_calls_before_sale).padEnd(11)} | ${row.sales_count}`
      );
    }
    console.log();

    // Query 5: Summary Statistics
    console.log("=" + "=".repeat(99));
    console.log("5. SUMMARY STATISTICS (Last 90 Days)");
    console.log("=" + "=".repeat(99));

    const [summaryRows] = await connection.query(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(DISTINCT COALESCE(ProcessName, 'Unknown')) as unique_processes,
        COUNT(DISTINCT COALESCE(AgentName, 'Unknown')) as unique_agents,
        COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as total_offers,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as total_sales,
        ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as overall_conversion_rate,
        ROUND(100 * COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as overall_offer_rate,
        MIN(CallDate) as data_start_date,
        MAX(CallDate) as data_end_date
      FROM db_external.CallDetails
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    `);

    const summary = summaryRows[0] as QueryResult;
    console.log(`Total Calls:              ${summary.total_calls}`);
    console.log(`Unique Processes:         ${summary.unique_processes}`);
    console.log(`Unique Agents:            ${summary.unique_agents}`);
    console.log(`Total Offers Made:        ${summary.total_offers}`);
    console.log(`Total Sales:              ${summary.total_sales}`);
    console.log(`Overall Conversion Rate:  ${summary.overall_conversion_rate}%`);
    console.log(`Overall Offer Rate:       ${summary.overall_offer_rate}%`);
    console.log(`Data Period:              ${summary.data_start_date} to ${summary.data_end_date}`);
    console.log();

    console.log("=" + "=".repeat(99));
    console.log("Report completed successfully!");
    console.log("=" + "=".repeat(99));

    await connection.end();
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error executing sales funnel report:");
      console.error(error.message);
      if ("code" in error && error.code === "ER_ACCESS_DENIED_ERROR") {
        console.error("Database connection denied. Check credentials and database availability.");
      }
    } else {
      console.error("Unknown error:", error);
    }
    process.exit(1);
  }
}

// Run the report
executeSalesFunnelReport();
