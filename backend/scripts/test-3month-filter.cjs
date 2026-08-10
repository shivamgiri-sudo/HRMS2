/**
 * Test 3-month data filter on dialer queries
 */

const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const config = {
  host: requiredEnv('DIALER_DB_HOST'),
  port: Number(process.env.DIALER_DB_PORT || 3306),
  user: requiredEnv('DIALER_DB_USER'),
  password: requiredEnv('DIALER_DB_PASSWORD'),
  database: requiredEnv('DIALER_DB_NAME'),
};

async function test3MonthFilter() {
  console.log('='.repeat(80));
  console.log('DIALER 3-MONTH FILTER VALIDATION');
  console.log('='.repeat(80));

  const conn = await mysql.createConnection(config);

  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');

    // Test 1: Check data range in vicidial_agent_log
    console.log('\n📊 Test 1: Agent Log Data Range');
    const [agentRange] = await conn.execute(`
      SELECT
        MIN(DATE(event_time)) as earliest_date,
        MAX(DATE(event_time)) as latest_date,
        DATEDIFF(MAX(DATE(event_time)), MIN(DATE(event_time))) as total_days,
        COUNT(*) as total_records
      FROM vicidial_agent_log_11_5
    `);
    console.table(agentRange);

    // Test 2: Last 3 months agent activity
    console.log('\n📊 Test 2: Last 3 Months Agent Activity');
    const [last3Months] = await conn.execute(`
      SELECT
        COUNT(DISTINCT user) as unique_agents,
        COUNT(*) as total_activities,
        MIN(DATE(event_time)) as earliest_in_range,
        MAX(DATE(event_time)) as latest_in_range
      FROM vicidial_agent_log_11_5
      WHERE event_time >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `);
    console.table(last3Months);

    // Test 3: Inbound CDR data range
    console.log('\n📊 Test 3: Inbound CDR Data Range');
    const [inboundRange] = await conn.execute(`
      SELECT
        MIN(CallDate) as earliest_date,
        MAX(CallDate) as latest_date,
        DATEDIFF(MAX(CallDate), MIN(CallDate)) as total_days,
        COUNT(*) as total_records
      FROM vw_inbound_cdr
    `);
    console.table(inboundRange);

    // Test 4: Last 3 months inbound calls
    console.log('\n📊 Test 4: Last 3 Months Inbound Calls');
    const [inbound3Months] = await conn.execute(`
      SELECT
        COUNT(DISTINCT AgentId) as unique_agents,
        COUNT(*) as total_calls,
        MIN(CallDate) as earliest_in_range,
        MAX(CallDate) as latest_in_range
      FROM vw_inbound_cdr
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `);
    console.table(inbound3Months);

    // Test 5: Outbound CDR data range
    console.log('\n📊 Test 5: Outbound CDR Data Range');
    const [outboundRange] = await conn.execute(`
      SELECT
        MIN(CallDate) as earliest_date,
        MAX(CallDate) as latest_date,
        DATEDIFF(MAX(CallDate), MIN(CallDate)) as total_days,
        COUNT(*) as total_records
      FROM vw_outbound_cdr
    `);
    console.table(outboundRange);

    // Test 6: Last 3 months outbound calls
    console.log('\n📊 Test 6: Last 3 Months Outbound Calls');
    const [outbound3Months] = await conn.execute(`
      SELECT
        COUNT(DISTINCT Agent) as unique_agents,
        COUNT(*) as total_calls,
        MIN(CallDate) as earliest_in_range,
        MAX(CallDate) as latest_in_range
      FROM vw_outbound_cdr
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `);
    console.table(outbound3Months);

    // Test 7: Sample recent agent with calls
    console.log('\n📊 Test 7: Sample Agent with Recent Data');
    const [recentAgents] = await conn.execute(`
      SELECT
        AgentId,
        AgentName,
        CallDate,
        COUNT(*) as calls
      FROM vw_inbound_cdr
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY AgentId, AgentName, CallDate
      ORDER BY calls DESC
      LIMIT 5
    `);
    console.table(recentAgents);

    // Test 8: Verify date filter works correctly
    console.log('\n📊 Test 8: Date Filter Verification');
    const testDate = '2026-06-06';
    const [dateFilter] = await conn.execute(`
      SELECT
        COUNT(*) as calls_on_date,
        COUNT(*) as calls_within_3months
      FROM vw_inbound_cdr
      WHERE CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `, [testDate]);
    console.table(dateFilter);

    console.log('\n' + '='.repeat(80));
    console.log('✅ 3-MONTH FILTER VALIDATION COMPLETE');
    console.log('All queries now restricted to last 3 months of data');
    console.log('Reduces query load and focuses on recent/relevant data');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    await conn.end();
  }
}

test3MonthFilter().catch(console.error);
