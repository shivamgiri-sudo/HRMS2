import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface QueryResult {
  [key: string]: unknown;
}

interface ConversionFunnelRow {
  process: string;
  stage: string;
  count: number;
  conversion_pct: number;
  bottleneck: string;
}

async function executeConversionFunnelReport(): Promise<void> {
  let connection: mysql.Connection | null = null;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: "mas_hrms",
      multipleStatements: true,
    });

    console.log("✓ Connected to mas_hrms database\n");

    // Query 1: Overall conversion funnel by process
    console.log("=" + "=".repeat(140));
    console.log(
      "1. CONVERSION FUNNEL BY PROCESS (PROCESS | STAGE | COUNT | CONVERSION_PCT | BOTTLENECK)"
    );
    console.log("=" + "=".repeat(140));

    const [funnelRows] = await connection.query(`
      SELECT
        cfe.process_type as process,
        fsc.stage_name as stage,
        fsc.stage_sequence,
        COUNT(DISTINCT cfe.id) as count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as conversion_pct,
        CASE
          WHEN COUNT(DISTINCT cfe.id) = 0 THEN 'No Data'
          WHEN COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0) < 0.3 THEN 'CRITICAL'
          WHEN COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0) < 0.5 THEN 'WARNING'
          ELSE 'HEALTHY'
        END as bottleneck
      FROM conversion_funnel_event cfe
      LEFT JOIN funnel_stage_config fsc ON fsc.process_type = cfe.process_type AND fsc.stage_name = cfe.funnel_stage
      WHERE cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY cfe.process_type, fsc.stage_sequence, fsc.stage_name
      ORDER BY cfe.process_type, fsc.stage_sequence
    `);

    console.log(
      "PROCESS".padEnd(15) +
        "| STAGE".padEnd(30) +
        "| COUNT".padEnd(10) +
        "| CONVERSION_PCT".padEnd(18) +
        "| BOTTLENECK"
    );
    console.log("-".repeat(140));

    const funnelByProcess: {
      [key: string]: ConversionFunnelRow[];
    } = {};
    for (const row of funnelRows as QueryResult[]) {
      const process = String(row.process);
      if (!funnelByProcess[process]) {
        funnelByProcess[process] = [];
      }
      funnelByProcess[process].push({
        process,
        stage: String(row.stage),
        count: Number(row.count),
        conversion_pct: Number(row.conversion_pct),
        bottleneck: String(row.bottleneck),
      });

      console.log(
        String(row.process).padEnd(15) +
          "| " +
          String(row.stage).padEnd(28) +
          "| " +
          String(row.count).padEnd(8) +
          "| " +
          String(row.conversion_pct).padEnd(16) +
          "% | " +
          row.bottleneck
      );
    }
    console.log();

    // Query 2: Detailed funnel summary by process type
    console.log("=" + "=".repeat(140));
    console.log("2. FUNNEL SUMMARY BY PROCESS TYPE");
    console.log("=" + "=".repeat(140));

    const [summaryRows] = await connection.query(`
      SELECT
        cfe.process_type,
        COUNT(DISTINCT cfe.id) as total_entries,
        COUNT(DISTINCT CASE WHEN cfe.status = 'completed' THEN cfe.id END) as completed,
        COUNT(DISTINCT CASE WHEN cfe.status = 'abandoned' THEN cfe.id END) as abandoned,
        COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) as conversions,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as overall_conversion_rate,
        COALESCE(SUM(
          CASE cfe.process_type
            WHEN 'inbound' THEN ifd.sale_amount
            WHEN 'outbound' THEN ofd.sale_amount
            WHEN 'chat' THEN cfd.sale_amount
            WHEN 'email' THEN efd.sale_amount
            ELSE 0
          END
        ), 0) as total_sale_value,
        ROUND(AVG(
          CASE cfe.process_type
            WHEN 'inbound' THEN ifd.sale_amount
            WHEN 'outbound' THEN ofd.sale_amount
            WHEN 'chat' THEN cfd.sale_amount
            WHEN 'email' THEN efd.sale_amount
            ELSE 0
          END
        ), 2) as avg_sale_value
      FROM conversion_funnel_event cfe
      LEFT JOIN inbound_funnel_detail ifd ON ifd.conversion_funnel_event_id = cfe.id
      LEFT JOIN outbound_funnel_detail ofd ON ofd.conversion_funnel_event_id = cfe.id
      LEFT JOIN chat_funnel_detail cfd ON cfd.conversion_funnel_event_id = cfe.id
      LEFT JOIN email_funnel_detail efd ON efd.conversion_funnel_event_id = cfe.id
      WHERE cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY cfe.process_type
      ORDER BY conversions DESC
    `);

    console.log(
      "PROCESS".padEnd(15) +
        "| ENTRIES".padEnd(10) +
        "| COMPLETED".padEnd(12) +
        "| ABANDONED".padEnd(12) +
        "| CONVERSIONS".padEnd(14) +
        "| CONV_RATE(%)".padEnd(15) +
        "| TOTAL_SALE_VALUE".padEnd(20) +
        "| AVG_SALE_VALUE"
    );
    console.log("-".repeat(140));

    let totalEntries = 0;
    let totalConversions = 0;
    let totalSaleValue = 0;

    for (const row of summaryRows as QueryResult[]) {
      const entries = Number(row.total_entries);
      const convs = Number(row.conversions);
      const saleVal = Number(row.total_sale_value);

      totalEntries += entries;
      totalConversions += convs;
      totalSaleValue += saleVal;

      console.log(
        String(row.process_type).padEnd(15) +
          "| " +
          String(row.total_entries).padEnd(8) +
          "| " +
          String(row.completed).padEnd(10) +
          "| " +
          String(row.abandoned).padEnd(10) +
          "| " +
          String(row.conversions).padEnd(12) +
          "| " +
          String(row.overall_conversion_rate).padEnd(13) +
          "% | " +
          String(saleVal.toFixed(2)).padEnd(18) +
          "| " +
          row.avg_sale_value
      );
    }
    console.log();

    // Query 3: Inbound funnel detailed analysis
    console.log("=" + "=".repeat(140));
    console.log("3. INBOUND PROCESS FUNNEL (Call Connect → Concern → Offer → Sale)");
    console.log("=" + "=".repeat(140));

    const [inboundRows] = await connection.query(`
      SELECT
        'Inbound' as process,
        'Call Connect' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'call_connect' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'call_connect' THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'inbound' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Inbound' as process,
        'Concern Identified' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'concern_identified' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'concern_identified' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'inbound' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'inbound' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Inbound' as process,
        'Offer Prepared' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'offer_prepared' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'offer_prepared' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'inbound' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'inbound' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Inbound' as process,
        'Sale Completed' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'sale_completed' AND cfe.conversion_flag = 1 THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'sale_completed' AND cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'inbound' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'inbound' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    `);

    console.log(
      "PROCESS".padEnd(15) +
        "| STAGE".padEnd(20) +
        "| COUNT".padEnd(10) +
        "| % OF TOTAL"
    );
    console.log("-".repeat(140));

    for (const row of inboundRows as QueryResult[]) {
      console.log(
        String(row.process).padEnd(15) +
          "| " +
          String(row.stage).padEnd(18) +
          "| " +
          String(row.stage_count).padEnd(8) +
          "| " +
          String(row.entry_pct).padEnd(8) +
          "%"
      );
    }
    console.log();

    // Query 4: Outbound funnel detailed analysis
    console.log("=" + "=".repeat(140));
    console.log("4. OUTBOUND PROCESS FUNNEL (Dial → Connect → Talk 30s → Sale)");
    console.log("=" + "=".repeat(140));

    const [outboundRows] = await connection.query(`
      SELECT
        'Outbound' as process,
        'Dial Initiated' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'dial_initiated' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'dial_initiated' THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'outbound' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Outbound' as process,
        'Call Connected' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'call_connected' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'call_connected' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'outbound' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'outbound' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Outbound' as process,
        'Talk 30s+' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'talk_30s' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'talk_30s' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'outbound' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'outbound' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Outbound' as process,
        'Sale Completed' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'sale_completed' AND cfe.conversion_flag = 1 THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'sale_completed' AND cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'outbound' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'outbound' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    `);

    console.log(
      "PROCESS".padEnd(15) +
        "| STAGE".padEnd(20) +
        "| COUNT".padEnd(10) +
        "| % OF TOTAL"
    );
    console.log("-".repeat(140));

    for (const row of outboundRows as QueryResult[]) {
      console.log(
        String(row.process).padEnd(15) +
          "| " +
          String(row.stage).padEnd(18) +
          "| " +
          String(row.stage_count).padEnd(8) +
          "| " +
          String(row.entry_pct).padEnd(8) +
          "%"
      );
    }
    console.log();

    // Query 5: Chat funnel detailed analysis
    console.log("=" + "=".repeat(140));
    console.log("5. CHAT PROCESS FUNNEL (Initiated → Resolved → Upsell → Sale)");
    console.log("=" + "=".repeat(140));

    const [chatRows] = await connection.query(`
      SELECT
        'Chat' as process,
        'Initiated' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'chat_initiated' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'chat_initiated' THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'chat' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Chat' as process,
        'Resolved' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'issue_resolved' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'issue_resolved' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'chat' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'chat' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Chat' as process,
        'Upsell Offered' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'upsell_offered' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'upsell_offered' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'chat' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'chat' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Chat' as process,
        'Sale Completed' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'sale_completed' AND cfe.conversion_flag = 1 THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'sale_completed' AND cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'chat' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'chat' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    `);

    console.log(
      "PROCESS".padEnd(15) +
        "| STAGE".padEnd(20) +
        "| COUNT".padEnd(10) +
        "| % OF TOTAL"
    );
    console.log("-".repeat(140));

    for (const row of chatRows as QueryResult[]) {
      console.log(
        String(row.process).padEnd(15) +
          "| " +
          String(row.stage).padEnd(18) +
          "| " +
          String(row.stage_count).padEnd(8) +
          "| " +
          String(row.entry_pct).padEnd(8) +
          "%"
      );
    }
    console.log();

    // Query 6: Email funnel detailed analysis
    console.log("=" + "=".repeat(140));
    console.log("6. EMAIL PROCESS FUNNEL (Received → Responded → Resolved → Upsell → Sale)");
    console.log("=" + "=".repeat(140));

    const [emailRows] = await connection.query(`
      SELECT
        'Email' as process,
        'Received' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'email_received' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'email_received' THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'email' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Email' as process,
        'Responded' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'first_response' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'first_response' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'email' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'email' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Email' as process,
        'Resolved' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'issue_resolved' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'issue_resolved' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'email' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'email' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Email' as process,
        'Upsell Offered' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'upsell_offered' THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'upsell_offered' THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'email' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'email' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        'Email' as process,
        'Sale Completed' as stage,
        COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'sale_completed' AND cfe.conversion_flag = 1 THEN cfe.id END) as stage_count,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.funnel_stage = 'sale_completed' AND cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF((SELECT COUNT(DISTINCT id) FROM conversion_funnel_event WHERE process_type = 'email' AND stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0), 2) as entry_pct
      FROM conversion_funnel_event cfe
      WHERE cfe.process_type = 'email' AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    `);

    console.log(
      "PROCESS".padEnd(15) +
        "| STAGE".padEnd(20) +
        "| COUNT".padEnd(10) +
        "| % OF TOTAL"
    );
    console.log("-".repeat(140));

    for (const row of emailRows as QueryResult[]) {
      console.log(
        String(row.process).padEnd(15) +
          "| " +
          String(row.stage).padEnd(18) +
          "| " +
          String(row.stage_count).padEnd(8) +
          "| " +
          String(row.entry_pct).padEnd(8) +
          "%"
      );
    }
    console.log();

    // Query 7: Bottleneck Analysis - Identify worst drop-off stages
    console.log("=" + "=".repeat(140));
    console.log("7. BOTTLENECK ANALYSIS - WORST DROP-OFF STAGES BY PROCESS");
    console.log("=" + "=".repeat(140));

    const [bottleneckRows] = await connection.query(`
      WITH stage_progression AS (
        SELECT
          cfe.process_type,
          fsc.stage_sequence,
          fsc.stage_name,
          COUNT(DISTINCT cfe.id) as stage_entries
        FROM conversion_funnel_event cfe
        LEFT JOIN funnel_stage_config fsc ON fsc.process_type = cfe.process_type AND fsc.stage_name = cfe.funnel_stage
        WHERE cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY cfe.process_type, fsc.stage_sequence, fsc.stage_name
      ),
      drop_off_calc AS (
        SELECT
          sp1.process_type,
          sp1.stage_sequence,
          sp1.stage_name,
          sp1.stage_entries,
          LAG(sp1.stage_entries) OVER (PARTITION BY sp1.process_type ORDER BY sp1.stage_sequence) as prev_stage_entries,
          ROUND(100.0 * (1 - sp1.stage_entries / NULLIF(LAG(sp1.stage_entries) OVER (PARTITION BY sp1.process_type ORDER BY sp1.stage_sequence), 0)), 2) as drop_off_pct
        FROM stage_progression sp1
      )
      SELECT
        process_type,
        stage_name,
        stage_entries,
        prev_stage_entries,
        drop_off_pct
      FROM drop_off_calc
      WHERE drop_off_pct IS NOT NULL
      ORDER BY process_type, drop_off_pct DESC
    `);

    console.log(
      "PROCESS".padEnd(15) +
        "| STAGE".padEnd(25) +
        "| ENTRIES".padEnd(10) +
        "| FROM_PREV".padEnd(12) +
        "| DROP_OFF_%"
    );
    console.log("-".repeat(140));

    for (const row of bottleneckRows as QueryResult[]) {
      console.log(
        String(row.process_type).padEnd(15) +
          "| " +
          String(row.stage_name).padEnd(23) +
          "| " +
          String(row.stage_entries).padEnd(8) +
          "| " +
          String(row.prev_stage_entries).padEnd(10) +
          "| " +
          String(row.drop_off_pct).padEnd(8) +
          "%"
      );
    }
    console.log();

    // Query 8: Performance Summary
    console.log("=" + "=".repeat(140));
    console.log("8. OVERALL PERFORMANCE SUMMARY (Last 30 Days)");
    console.log("=" + "=".repeat(140));

    const [perfSummary] = await connection.query(`
      SELECT
        COUNT(DISTINCT cfe.id) as total_funnel_entries,
        COUNT(DISTINCT cfe.process_type) as unique_processes,
        COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) as total_conversions,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) / NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as overall_conversion_rate,
        ROUND(AVG(cfe.stage_duration_secs), 0) as avg_stage_duration_secs,
        MIN(cfe.stage_entered_at) as data_start_date,
        MAX(cfe.stage_entered_at) as data_end_date
      FROM conversion_funnel_event cfe
      WHERE cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    `);

    const perf = perfSummary[0] as QueryResult;
    console.log(`Total Funnel Entries:        ${perf.total_funnel_entries}`);
    console.log(`Unique Processes:            ${perf.unique_processes}`);
    console.log(`Total Conversions:           ${perf.total_conversions}`);
    console.log(`Overall Conversion Rate:     ${perf.overall_conversion_rate}%`);
    console.log(
      `Average Stage Duration:      ${perf.avg_stage_duration_secs} seconds`
    );
    console.log(`Data Period:                 ${perf.data_start_date} to ${perf.data_end_date}`);
    console.log();

    console.log("=" + "=".repeat(140));
    console.log("Conversion Funnel Report completed successfully!");
    console.log("=" + "=".repeat(140));

    await connection.end();
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error executing conversion funnel report:");
      console.error(error.message);
      if ("code" in error && error.code === "ER_ACCESS_DENIED_ERROR") {
        console.error(
          "Database connection denied. Check credentials and database availability."
        );
      }
    } else {
      console.error("Unknown error:", error);
    }
    process.exit(1);
  }
}

executeConversionFunnelReport();
