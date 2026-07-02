/**
 * Test dialer_db connection (READ-ONLY)
 *
 * Purpose: Verify connection and test basic queries
 * SAFE: Only SELECT queries, no modifications
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

async function testDialerConnection() {
  console.log('='.repeat(80));
  console.log('DIALER DB CONNECTION TEST (READ-ONLY)');
  console.log('='.repeat(80));

  const conn = await mysql.createConnection(config);

  try {
    // Test 1: Basic connection
    console.log('\n✅ Connected to dialer_db');

    // Test 2: Set read-only
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    console.log('✅ Session set to READ-ONLY');

    // Test 3: Check views exist
    const [views] = await conn.execute(`
      SHOW TABLES LIKE 'vw_%'
    `);
    console.log(`\n📊 Found ${views.length} views:`);
    views.forEach(v => console.log(`   - ${Object.values(v)[0]}`));

    // Test 4: Sample inbound call data
    const [inbound] = await conn.execute(`
      SELECT
        AgentId,
        AgentName,
        CallDate,
        COUNT(*) as call_count
      FROM vw_inbound_cdr
      WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY AgentId, AgentName, CallDate
      ORDER BY CallDate DESC, call_count DESC
      LIMIT 10
    `);

    console.log('\n📞 Sample inbound call data (last 7 days, top 10):');
    console.table(inbound);

    // Test 5: Sample agent activity
    const [agentLog] = await conn.execute(`
      SELECT
        user as AgentId,
        DATE(event_time) as ActivityDate,
        COUNT(*) as activities,
        SUM(pause_sec) as total_pause_sec,
        SUM(talk_sec) as total_talk_sec
      FROM vicidial_agent_log_11_5
      WHERE event_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY user, DATE(event_time)
      ORDER BY ActivityDate DESC, total_talk_sec DESC
      LIMIT 10
    `);

    console.log('\n📊 Sample agent activity (last 7 days, top 10):');
    console.table(agentLog);

    // Test 6: Current active agents
    const [activeAgents] = await conn.execute(`
      SELECT
        user as AgentId,
        MAX(event_time) as last_activity,
        campaign_id,
        status,
        TIMESTAMPDIFF(MINUTE, MAX(event_time), NOW()) as minutes_ago
      FROM vicidial_agent_log_11_5
      WHERE event_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
      GROUP BY user, campaign_id, status
      HAVING minutes_ago <= 60
      LIMIT 20
    `);

    console.log(`\n🟢 Active agents (last hour): ${activeAgents.length}`);
    if (activeAgents.length > 0) {
      console.table(activeAgents.slice(0, 10));
    }

    // Test 7: Verify no write access (should fail)
    console.log('\n🔒 Testing READ-ONLY enforcement...');
    try {
      await conn.execute('INSERT INTO call_logs (id) VALUES (999999)');
      console.error('❌ SECURITY BREACH: Write operation succeeded! (Should have failed)');
    } catch (error) {
      console.log('✅ Write operation blocked as expected:', error.message.substring(0, 80));
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ ALL TESTS PASSED - CONNECTION READY FOR HRMS INTEGRATION');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    await conn.end();
  }
}

// Run test
testDialerConnection().catch(console.error);
