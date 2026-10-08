/**
 * Test Dialer KPI Integration
 */

const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const dialerConfig = {
  host: requiredEnv('DIALER_DB_HOST'),
  port: Number(process.env.DIALER_DB_PORT || 3306),
  user: requiredEnv('DIALER_DB_USER'),
  password: requiredEnv('DIALER_DB_PASSWORD'),
  database: requiredEnv('DIALER_DB_NAME'),
};

const hrmsConfig = {
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
};

async function testDialerKpiIntegration() {
  console.log('='.repeat(80));
  console.log('DIALER KPI INTEGRATION TEST');
  console.log('='.repeat(80));

  const dialerConn = await mysql.createConnection(dialerConfig);
  const hrmsConn = await mysql.createConnection(hrmsConfig);

  try {
    await dialerConn.query('SET SESSION TRANSACTION READ ONLY');

    // Test 1: Find agent with recent call data
    console.log('\n📊 Test 1: Finding Agent with Recent Call Data');
    const [recentAgents] = await dialerConn.execute(`
      SELECT
        AgentId as employee_code,
        AgentName,
        CallDate,
        COUNT(*) as calls
      FROM vw_inbound_cdr
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      GROUP BY AgentId, AgentName, CallDate
      ORDER BY calls DESC
      LIMIT 5
    `);

    if (!recentAgents.length) {
      console.log('❌ No recent call data found');
      return;
    }

    console.table(recentAgents);
    const testAgent = recentAgents[0].employee_code;
    const testDate = new Date(recentAgents[0].CallDate).toISOString().split('T')[0];

    // Test 2: Calculate KPI metrics for agent
    console.log(`\n📊 Test 2: Calculating KPI Metrics for ${testAgent} on ${testDate}`);

    // Inbound metrics
    const [inbound] = await dialerConn.execute(`
      SELECT
        COUNT(*) as inbound_calls,
        SUM(CAST(COALESCE(CallDurationSecond, 0) AS UNSIGNED)) as total_duration,
        SUM(CAST(COALESCE(Talkduration, 0) AS UNSIGNED)) as total_talk,
        SUM(CAST(COALESCE(Acwduration, 0) AS UNSIGNED)) as total_acw,
        SUM(CAST(COALESCE(HoldTime, 0) AS UNSIGNED)) as total_hold,
        SUM(CASE WHEN Disposition = 'SALE' OR Disposition = 'RESOLVED' THEN 1 ELSE 0 END) as fcr_count
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `, [testAgent, testDate]);

    // Outbound metrics
    const [outbound] = await dialerConn.execute(`
      SELECT
        COUNT(*) as outbound_calls,
        SUM(CAST(COALESCE(talk_sec, 0) AS UNSIGNED)) as total_talk,
        SUM(CAST(COALESCE(DispoSec, 0) AS UNSIGNED)) as total_dispo
      FROM vw_outbound_cdr
      WHERE Agent = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `, [testAgent, testDate]);

    const inboundData = inbound[0] || {};
    const outboundData = outbound[0] || {};

    const totalCalls = Number(inboundData.inbound_calls || 0) + Number(outboundData.outbound_calls || 0);
    const totalTalk = Number(inboundData.total_talk || 0) + Number(outboundData.total_talk || 0);
    const totalAcw = Number(inboundData.total_acw || 0) + Number(outboundData.total_dispo || 0);
    const totalHold = Number(inboundData.total_hold || 0);

    // Calculate AHT (Average Handle Time)
    const aht = totalCalls > 0 ? Math.round((totalTalk + totalHold + totalAcw) / totalCalls) : 0;
    const acw = totalCalls > 0 ? Math.round(totalAcw / totalCalls) : 0;
    const talkTime = totalCalls > 0 ? Math.round(totalTalk / totalCalls) : 0;
    const holdTime = totalCalls > 0 ? Math.round(totalHold / totalCalls) : 0;

    console.log('\nCalculated KPI Metrics:');
    console.table([{
      employee_code: testAgent,
      date: testDate,
      total_calls: totalCalls,
      aht_seconds: aht,
      aht_minutes: (aht / 60).toFixed(2),
      acw_seconds: acw,
      talk_time: talkTime,
      hold_time: holdTime,
      fcr_count: Number(inboundData.fcr_count || 0),
    }]);

    // Test 3: Check if employee exists in HRMS
    console.log('\n📊 Test 3: Checking Employee in HRMS');
    const [hrmsEmp] = await hrmsConn.execute(
      `SELECT id, employee_code, full_name, process_id FROM employees WHERE employee_code = ? LIMIT 1`,
      [testAgent]
    );

    if (hrmsEmp.length > 0) {
      console.log('✅ Employee found in HRMS:');
      console.table(hrmsEmp);
    } else {
      console.log(`⚠️  Employee ${testAgent} not found in HRMS database`);
    }

    // Test 4: Check KPI metrics configuration
    console.log('\n📊 Test 4: Checking KPI Metric Configuration');
    const [kpiMetrics] = await hrmsConn.execute(`
      SELECT id, metric_code, metric_name, unit, direction
      FROM kpi_metric
      WHERE metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
      ORDER BY metric_code
    `);

    if (kpiMetrics.length > 0) {
      console.log('✅ Call center KPI metrics configured:');
      console.table(kpiMetrics);
    } else {
      console.log('⚠️  No call center KPI metrics configured in database');
      console.log('   You may need to create these metrics in kpi_metric table');
    }

    // Test 5: Check process configuration
    if (hrmsEmp.length > 0 && hrmsEmp[0].process_id) {
      console.log('\n📊 Test 5: Checking Process KPI Configuration');
      const [processConfig] = await hrmsConn.execute(`
        SELECT
          pc.process_id,
          pm.process_name,
          km.metric_code,
          pc.target_value
        FROM kpi_process_config pc
        JOIN process_master pm ON pm.id = pc.process_id
        JOIN kpi_metric km ON km.id = pc.metric_id
        WHERE pc.process_id = ?
          AND km.metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
        ORDER BY km.metric_code
      `, [hrmsEmp[0].process_id]);

      if (processConfig.length > 0) {
        console.log('✅ Process KPI targets configured:');
        console.table(processConfig);
      } else {
        console.log('⚠️  No KPI targets configured for this process');
        console.log('   Configure targets in kpi_process_config table');
      }
    }

    // Test 6: Check existing KPI scores
    if (hrmsEmp.length > 0) {
      console.log('\n📊 Test 6: Checking Existing KPI Scores');
      const [existingScores] = await hrmsConn.execute(`
        SELECT
          ks.period,
          km.metric_code,
          ks.actual_value,
          ks.source,
          ks.updated_at
        FROM kpi_score ks
        JOIN kpi_metric km ON km.id = ks.metric_id
        WHERE ks.employee_id = ?
          AND ks.period >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
          AND km.metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
        ORDER BY ks.period DESC, km.metric_code
        LIMIT 20
      `, [hrmsEmp[0].id]);

      if (existingScores.length > 0) {
        console.log('✅ Recent KPI scores:');
        console.table(existingScores);
      } else {
        console.log('⚠️  No recent KPI scores found for this employee');
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ DIALER KPI INTEGRATION TEST COMPLETE');
    console.log('');
    console.log('Summary:');
    console.log(`  - Dialer data: ${totalCalls} calls found`);
    console.log(`  - HRMS employee: ${hrmsEmp.length > 0 ? 'Found' : 'Not found'}`);
    console.log(`  - KPI metrics: ${kpiMetrics.length} configured`);
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Use POST /api/dialer/kpi/sync/employee to sync metrics to KPI scores');
    console.log('  2. Use GET /api/dialer/kpi/process/:processId/:date for process aggregation');
    console.log('  3. Use GET /api/dialer/kpi/leaderboard/:processId/:date for rankings');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    await dialerConn.end();
    await hrmsConn.end();
  }
}

testDialerKpiIntegration().catch(console.error);
