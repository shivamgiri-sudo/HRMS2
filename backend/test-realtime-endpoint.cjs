const http = require('http');

async function testEndpoint() {
  console.log('Testing real-time attendance endpoint...\n');

  // First, login to get JWT token
  console.log('1. Logging in...');

  const loginData = JSON.stringify({
    email: 'admin@mascallnet.com',
    password: 'Admin@123'
  });

  const loginOptions = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': loginData.length
    }
  };

  const token = await new Promise((resolve, reject) => {
    const req = http.request(loginOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          console.log('   ✓ Login successful');
          resolve(json.accessToken);
        } else {
          console.log(`   ✗ Login failed: ${res.statusCode}`);
          reject(new Error(`Login failed: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.write(loginData);
    req.end();
  });

  // Test today-live endpoint
  console.log('\n2. Testing /api/wfm/attendance/today-live...');

  const todayOptions = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/wfm/attendance/today-live',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  await new Promise((resolve, reject) => {
    const req = http.request(todayOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`   Status: ${res.statusCode}`);
        try {
          const json = JSON.parse(data);
          console.log('   Response:', JSON.stringify(json, null, 2));

          if (json.data && json.data.source) {
            console.log(`\n   ✓ Source: ${json.data.source}`);
            if (json.data.source === 'ncosec_realtime') {
              console.log('   ✓✓ SUCCESS: Real-time NCOSEC data working!');
            } else if (json.data.source === 'biometric_synced') {
              console.log('   ⚠ Using fallback synced data (NCOSEC may be unavailable)');
            }
          } else if (json.data === null) {
            console.log('   ℹ No attendance data for today');
          }
          resolve();
        } catch (e) {
          console.log('   Raw response:', data);
          resolve();
        }
      });
    });
    req.on('error', (err) => {
      console.log(`   ✗ Request failed: ${err.message}`);
      reject(err);
    });
    req.end();
  });

  // Test calendar-live endpoint (last 7 days)
  console.log('\n3. Testing /api/wfm/attendance/calendar-live...');

  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);

  const formatDate = (d) => d.toISOString().split('T')[0];
  const fromDate = formatDate(sevenDaysAgo);
  const toDate = formatDate(today);

  const calendarOptions = {
    hostname: 'localhost',
    port: 3000,
    path: `/api/wfm/attendance/calendar-live?fromDate=${fromDate}&toDate=${toDate}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  await new Promise((resolve, reject) => {
    const req = http.request(calendarOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`   Status: ${res.statusCode}`);
        try {
          const json = JSON.parse(data);
          console.log(`   Response: ${json.count || 0} days of data`);

          if (json.data && json.data.length > 0) {
            console.log(`   Sample: ${json.data[0].punch_date} - ${json.data[0].source}`);
            console.log(`   ✓ Calendar endpoint working!`);
          } else {
            console.log('   ℹ No data in range');
          }
          resolve();
        } catch (e) {
          console.log('   Raw response:', data);
          resolve();
        }
      });
    });
    req.on('error', (err) => {
      console.log(`   ✗ Request failed: ${err.message}`);
      reject(err);
    });
    req.end();
  });

  console.log('\n=== Test Complete ===\n');
}

// Wait for backend to start
setTimeout(() => {
  testEndpoint().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
  });
}, 8000);

console.log('Waiting 8s for backend to start...');
