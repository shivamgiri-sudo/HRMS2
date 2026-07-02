const http = require('http');

async function test() {
  console.log('Testing real-time attendance on port 5056...\n');

  // Login
  const loginData = JSON.stringify({
    email: 'admin@mascallnet.com',
    password: 'Admin@123'
  });

  const token = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5056,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          console.log('✓ Login successful\n');
          resolve(json.accessToken);
        } else {
          reject(new Error(`Login failed: ${res.statusCode} - ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(loginData);
    req.end();
  });

  // Test today-live
  console.log('Testing /api/wfm/attendance/today-live...');
  await new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5056,
      path: '/api/wfm/attendance/today-live',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        const json = JSON.parse(data);
        console.log('Response:', JSON.stringify(json, null, 2));
        if (json.data?.source) {
          console.log(`\n✓✓ Source: ${json.data.source}`);
          if (json.data.source === 'ncosec_realtime') {
            console.log('✓✓✓ SUCCESS: Real-time NCOSEC working!');
          }
        }
        resolve();
      });
    });
    req.on('error', err => {
      console.log('Error:', err.message);
      resolve();
    });
    req.end();
  });
}

test().catch(err => console.error('Failed:', err.message));
