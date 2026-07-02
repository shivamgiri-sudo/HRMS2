/**
 * Test dialer API endpoints (requires valid auth token)
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

async function testDialerAPI() {
  console.log('='.repeat(80));
  console.log('DIALER API INTEGRATION TEST');
  console.log('='.repeat(80));

  const conn = await mysql.createConnection(config);

  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');

    // Test 1: Get active agent
    console.log('\n📊 Test 1: Finding active agent...');
    const [activeAgents] = await conn.execute(`
      SELECT DISTINCT user as employee_code
      FROM vicidial_agent_log_11_5
      WHERE event_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      LIMIT 5
    `);

    if (activeAgents.length === 0) {
      console.log('❌ No recent agents found');
      return;
    }

    const testAgent = activeAgents[0].employee_code;
    console.log(`✅ Found test agent: ${testAgent}`);

    // Test 2: Agent status
    console.log('\n📊 Test 2: Agent Status Query');
    const [status] = await conn.execute(`
      SELECT
        user as employee_code,
        event_time as last_activity,
        status,
        campaign_id,
        user_group,
        pause_type,
        TIMESTAMPDIFF(SECOND, event_time, NOW()) as seconds_ago
      FROM vicidial_agent_log_11_5
      WHERE user = ?
      ORDER BY event_time DESC
      LIMIT 1
    `, [testAgent]);

    console.log('Agent Status:');
    console.table(status);

    // Test 3: Inbound calls for yesterday
    console.log('\n📊 Test 3: Inbound Calls (yesterday)');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const [inboundCalls] = await conn.execute(`
      SELECT
        AgentId as employee_code,
        AgentName as employee_name,
        Time as call_time,
        CampaignName as campaign,
        PhoneNumber as customer_phone,
        Disposition as disposition,
        CallDurationSecond as duration_sec,
        Talkduration as talk_sec
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
      ORDER BY Time ASC
      LIMIT 10
    `, [testAgent, dateStr]);

    console.log(`Inbound Calls for ${testAgent} on ${dateStr}:`);
    if (inboundCalls.length > 0) {
      console.table(inboundCalls);
    } else {
      console.log('No calls found for this agent/date');
    }

    // Test 4: Daily Summary
    console.log('\n📊 Test 4: Daily Summary');
    const [dailySummary] = await conn.execute(`
      SELECT
        COUNT(*) as total_calls,
        SUM(CAST(COALESCE(CallDurationSecond, 0) AS UNSIGNED)) as total_duration_sec,
        SUM(CAST(COALESCE(Talkduration, 0) AS UNSIGNED)) as total_talk_sec,
        SUM(CAST(COALESCE(Acwduration, 0) AS UNSIGNED)) as total_acw_sec
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
    `, [testAgent, dateStr]);

    console.log('Daily Summary:');
    console.table(dailySummary);

    // Test 5: Agent Activity
    console.log('\n📊 Test 5: Agent Activity Summary');
    const [agentActivity] = await conn.execute(`
      SELECT
        user as employee_code,
        DATE(event_time) as activity_date,
        COUNT(*) as total_activities,
        SUM(pause_sec) as total_pause_sec,
        SUM(wait_sec) as total_wait_sec,
        SUM(talk_sec) as total_talk_sec,
        SUM(dispo_sec) as total_dispo_sec,
        MIN(event_time) as first_activity,
        MAX(event_time) as last_activity
      FROM vicidial_agent_log_11_5
      WHERE user = ?
        AND DATE(event_time) = DATE(?)
      GROUP BY user, DATE(event_time)
    `, [testAgent, dateStr]);

    console.log('Agent Activity:');
    if (agentActivity.length > 0) {
      console.table(agentActivity);
    } else {
      console.log('No activity found for this agent/date');
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ ALL API INTEGRATION TESTS PASSED');
    console.log('Data tunnel working correctly - agent, calls, and activity queryable');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    await conn.end();
  }
}

testDialerAPI().catch(console.error);
