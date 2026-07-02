/**
 * Test Dialer KPI Metrics Calculation (Dialer DB only)
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

async function testDialerKpiMetrics() {
  console.log('='.repeat(80));
  console.log('DIALER KPI METRICS CALCULATION TEST');
  console.log('='.repeat(80));

  const conn = await mysql.createConnection(dialerConfig);

  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');

    // Test 1: Find agents with recent call data
    console.log('\n📊 Test 1: Finding Agents with Recent Call Data (Last 7 Days)');
    const [recentAgents] = await conn.execute(`
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
      LIMIT 10
    `);

    if (!recentAgents.length) {
      console.log('❌ No recent call data found');
      return;
    }

    console.table(recentAgents);
    const testAgent = recentAgents[0].employee_code;
    const testDate = new Date(recentAgents[0].CallDate).toISOString().split('T')[0];

    // Test 2: Calculate KPI metrics for top agent
    console.log(`\n📊 Test 2: Calculating KPI Metrics for ${testAgent} on ${testDate}`);

    // Inbound metrics
    const [inbound] = await conn.execute(`
      SELECT
        COUNT(*) as inbound_calls,
        SUM(CAST(COALESCE(CallDurationSecond, 0) AS UNSIGNED)) as total_duration,
        SUM(CAST(COALESCE(Talkduration, 0) AS UNSIGNED)) as total_talk,
        SUM(CAST(COALESCE(Acwduration, 0) AS UNSIGNED)) as total_acw,
        SUM(CAST(COALESCE(HoldTime, 0) AS UNSIGNED)) as total_hold,
        SUM(CAST(COALESCE(QueueDuration, 0) AS UNSIGNED)) as total_queue,
        SUM(CASE WHEN Disposition = 'SALE' OR Disposition = 'RESOLVED' THEN 1 ELSE 0 END) as fcr_count,
        SUM(CASE WHEN Disposition = 'CALLBACK' THEN 1 ELSE 0 END) as callbacks
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `, [testAgent, testDate]);

    // Outbound metrics
    const [outbound] = await conn.execute(`
      SELECT
        COUNT(*) as outbound_calls,
        SUM(CAST(COALESCE(CallDuration, 0) AS UNSIGNED)) as total_duration,
        SUM(CAST(COALESCE(talk_sec, 0) AS UNSIGNED)) as total_talk,
        SUM(CAST(COALESCE(DispoSec, 0) AS UNSIGNED)) as total_dispo,
        SUM(CAST(COALESCE(WaitSec, 0) AS UNSIGNED)) as total_wait
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
    const totalQueue = Number(inboundData.total_queue || 0);

    // Calculate KPI metrics
    const aht = totalCalls > 0 ? Math.round((totalTalk + totalHold + totalAcw) / totalCalls) : 0;
    const acw = totalCalls > 0 ? Math.round(totalAcw / totalCalls) : 0;
    const talkTime = totalCalls > 0 ? Math.round(totalTalk / totalCalls) : 0;
    const holdTime = totalCalls > 0 ? Math.round(totalHold / totalCalls) : 0;
    const queueTime = totalCalls > 0 ? Math.round(totalQueue / totalCalls) : 0;

    function formatTime(seconds) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    }

    console.log('\n✅ Calculated KPI Metrics:');
    console.table([{
      employee_code: testAgent,
      date: testDate,
      total_calls: totalCalls,
      inbound: Number(inboundData.inbound_calls || 0),
      outbound: Number(outboundData.outbound_calls || 0),
      aht: formatTime(aht),
      acw: formatTime(acw),
      talk_time: formatTime(talkTime),
      hold_time: formatTime(holdTime),
      queue_time: formatTime(queueTime),
      fcr_count: Number(inboundData.fcr_count || 0),
      callbacks: Number(inboundData.callbacks || 0),
    }]);

    // Test 3: Process-wise aggregation simulation
    console.log('\n📊 Test 3: Top 5 Agents by Call Volume (Simulated Process View)');
    const [processView] = await conn.execute(`
      SELECT
        AgentId as employee_code,
        AgentName,
        COUNT(*) as total_calls,
        ROUND(AVG(CAST(COALESCE(CallDurationSecond, 0) AS UNSIGNED))) as avg_duration,
        ROUND(AVG(CAST(COALESCE(Talkduration, 0) AS UNSIGNED))) as avg_talk,
        ROUND(AVG(CAST(COALESCE(Acwduration, 0) AS UNSIGNED))) as avg_acw,
        SUM(CASE WHEN Disposition = 'SALE' OR Disposition = 'RESOLVED' THEN 1 ELSE 0 END) as fcr_count
      FROM vw_inbound_cdr
      WHERE CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      GROUP BY AgentId, AgentName
      HAVING total_calls > 0
      ORDER BY total_calls DESC
      LIMIT 5
    `, [testDate]);

    if (processView.length > 0) {
      console.table(processView.map(row => ({
        ...row,
        avg_duration: formatTime(Number(row.avg_duration)),
        avg_talk: formatTime(Number(row.avg_talk)),
        avg_acw: formatTime(Number(row.avg_acw)),
      })));
    }

    // Test 4: KPI scoring simulation (assuming targets)
    console.log('\n📊 Test 4: KPI Scoring Simulation (Assumed Targets)');
    const ahtTarget = 300; // 5 minutes target
    const acwTarget = 60;  // 1 minute target

    // Lower is better for time metrics
    const ahtScore = aht > 0 ? Math.min(100, (ahtTarget / aht) * 100) : 0;
    const acwScore = acw > 0 ? Math.min(100, (acwTarget / acw) * 100) : 0;
    const overallScore = (ahtScore + acwScore) / 2;

    console.table([{
      metric: 'AHT',
      actual: formatTime(aht),
      target: formatTime(ahtTarget),
      score: Math.round(ahtScore * 10) / 10,
    }, {
      metric: 'ACW',
      actual: formatTime(acw),
      target: formatTime(acwTarget),
      score: Math.round(acwScore * 10) / 10,
    }, {
      metric: 'Overall',
      actual: '-',
      target: '-',
      score: Math.round(overallScore * 10) / 10,
    }]);

    console.log('\n' + '='.repeat(80));
    console.log('✅ DIALER KPI METRICS CALCULATION COMPLETE');
    console.log('');
    console.log('Metrics Ready for KPI Integration:');
    console.log(`  ✅ AHT (Average Handle Time): ${formatTime(aht)}`);
    console.log(`  ✅ ACW (After Call Work): ${formatTime(acw)}`);
    console.log(`  ✅ Talk Time: ${formatTime(talkTime)}`);
    console.log(`  ✅ Hold Time: ${formatTime(holdTime)}`);
    console.log(`  ✅ Total Calls: ${totalCalls}`);
    console.log('');
    console.log('API Endpoints:');
    console.log('  GET /api/dialer/kpi/employee/:employeeCode/:date');
    console.log('  GET /api/dialer/kpi/process/:processId/:date');
    console.log('  GET /api/dialer/kpi/leaderboard/:processId/:date');
    console.log('  POST /api/dialer/kpi/sync/employee { employeeCode, date }');
    console.log('  POST /api/dialer/kpi/sync/process { processId, date }');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    await conn.end();
  }
}

testDialerKpiMetrics().catch(console.error);
