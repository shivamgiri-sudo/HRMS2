# BGV API Monitoring & Verification Guide

## 🎯 How to Verify Real BGV APIs Are Working

### Problem
You need to verify that:
1. Real BGV API calls are being made (not mock)
2. External providers (Luckpay, InfinitiAI, etc.) are responding
3. Verifications are based on actual external data, not format checks

---

## ✅ Solution: BGV API Monitor Dashboard

### Access
**URL**: `/ats/bgv-api-monitor`  
**Roles**: Super Admin, HR Admin, HR

### Features

#### 1. **Provider Status Card**
Shows currently active BGV provider configuration:
- **Provider Key**: `befisc_luckpay`, `infinity_ai`, or `mock`
- **Environment**: `production` or `sandbox`
- **Base URL**: API endpoint being used
- **Status**: Enabled/Disabled
- **Last Token Success**: When auth last succeeded
- **Last API Failure**: Most recent error (if any)
- **Available Services**: Which BGV checks the provider supports (DigiLocker, PAN, Bank, UAN, Penny Drop)

#### 2. **Mock Warning Banner** ⚠️
**BIG RED ALERT** if mock provider is active:
> ⚠️ WARNING: Mock BGV Provider Active  
> Real BGV API calls are NOT being made. All verifications are passing format checks only.

This banner shows:
- When `BGV_PROVIDER=mock` in `.env`
- When any mock API calls detected in last 24 hours

#### 3. **Real-Time Statistics**
- **Calls Today**: Total API calls made today
- **Success Rate**: % of successful calls (should be >90%)
- **Avg Response Time**: Milliseconds per API call
- **Mock Calls Count**: Number of mock calls (should be 0 in production)

#### 4. **API Call Logs Table**
Every single BGV API call logged with:
- **Timestamp**: When the call was made
- **Candidate**: Name and code
- **Check Type**: `PAN_VERIFY`, `BANK_VERIFY`, `DIGILOCKER_INIT`, etc.
- **Provider**: Which provider was used (`befisc_luckpay`, `mock`, etc.)
- **Status**: Success ✓ or Failure ✗ with HTTP status code
- **Duration**: Response time in ms
- **View Response**: Button to see full API response payload

#### 5. **Test Connection Button**
Manually test if BGV provider is reachable:
- Checks auth token validity
- Verifies API base URL is accessible
- Shows detailed error if connection fails

---

## 🔍 How to Verify BGV is Working Correctly

### Step 1: Check Provider Configuration
1. Go to `/ats/bgv-api-monitor`
2. Look at **Provider Status Card**
3. Verify:
   - Provider Key = `befisc_luckpay` (NOT `mock`)
   - Environment = `production` (or `sandbox` for testing)
   - Status = Enabled
   - Last Token Success = recent timestamp

### Step 2: Check for Mock Warning
- **If you see the RED banner** → Mock is active, APIs NOT working
- **If NO red banner** → Good, real provider is configured

### Step 3: Verify Real API Calls
Look at **Statistics Cards**:
- **Mock Calls Count** should be **0**
- **Success Rate** should be **>85%**
- **Calls Today** should match expected verification volume

### Step 4: Inspect Individual API Calls
In the **API Call Logs Table**:
1. Find a recent verification (e.g., PAN or Bank)
2. Check **Provider** column = `befisc_luckpay` (not `mock`)
3. Check **Status** = ✓ Success with HTTP 200
4. Click **View Response** button
5. Verify response payload contains real data from provider:

**Real Luckpay Response Example:**
```json
{
  "status": "SUCCESS",
  "data": {
    "pan": "ABC**1234F",
    "name_match": "97%",
    "referenceId": "LP-20260708-ABC123",
    "verified_at": "2026-07-08T14:30:00Z"
  }
}
```

**Mock Response Example (BAD):**
```json
{
  "status": "verified",
  "mock": true,
  "message": "Format valid"
}
```

### Step 5: Cross-Check with BGV Report
1. Go to `/ats/bgv-report`
2. Select a candidate
3. Check **Verification Results** section
4. Each check should show:
   - Provider: `befisc_luckpay` (not `mock`)
   - Reference ID: external provider's transaction ID
   - Verified At: timestamp

---

## 🚨 Red Flags (APIs NOT Working)

| Problem | Cause | Fix |
|---------|-------|-----|
| **Provider Key = `mock`** | Mock adapter is active | Configure real provider in Super Admin → Settings → BGV Config |
| **Mock Calls Count > 0** | Some verifications used mock | Check `.env` file: `BGV_PROVIDER` should NOT be `mock` |
| **Success Rate < 50%** | API credentials invalid or service down | Check provider API keys, verify network connectivity |
| **Last Token Success = Never** | Auth token not working | Verify `LUCKPAY_BASIC_TOKEN` and `LUCKPAY_CLIENT_ID` in `.env` |
| **Response payload has `"mock": true`** | Mock data being returned | Real API not configured, check org_settings table |
| **No logs in table** | No API calls being made | Check if BGV is actually being triggered (consent, onboarding flow) |

---

## 🛠️ How to Fix Mock Provider Issue

### Option 1: Database Configuration (Recommended)
1. Go to **Super Admin → Settings → BGV Configuration**
2. Set:
   - BGV Provider: `befisc_luckpay`
   - Luckpay API URL: `https://api.luckpay.in` (or sandbox URL)
   - Luckpay Basic Token: (from Luckpay dashboard)
   - Luckpay Client ID: (from Luckpay dashboard)
3. Click Save
4. Go back to API Monitor → click **Test Connection**
5. Verify: Last Token Success updates to current time

### Option 2: Environment Variables
1. Edit `backend/.env`:
   ```env
   BGV_PROVIDER=befisc_luckpay
   LUCKPAY_BASE_URL=https://api.luckpay.in
   LUCKPAY_BASIC_TOKEN=your_token_here
   LUCKPAY_CLIENT_ID=your_client_id_here
   LUCKPAY_PROVIDER_ENABLED=true
   ```
2. Restart backend: `pm2 restart hrms2-backend`
3. Verify in API Monitor

---

## 📊 Database Tables Reference

### `candidate_bgv_api_request_log`
Every API call logged here:
- `id`: Unique log ID
- `candidate_id`: Which candidate
- `provider_key`: `befisc_luckpay`, `mock`, `infinity_ai`
- `endpoint_key`: `PAN_VERIFY`, `BANK_VERIFY`, etc.
- `request_ref`: Provider's transaction ID
- `response_status_code`: HTTP status (200, 400, 500)
- `response_payload`: Full JSON response
- `duration_ms`: How long it took
- `success_flag`: 1 = success, 0 = failure
- `created_at`: Timestamp

**Query to check if real APIs are running:**
```sql
SELECT 
  provider_key,
  COUNT(*) as total_calls,
  SUM(success_flag) as successful,
  AVG(duration_ms) as avg_duration
FROM candidate_bgv_api_request_log
WHERE DATE(created_at) = CURDATE()
GROUP BY provider_key;
```

**Expected output (good):**
```
provider_key      | total_calls | successful | avg_duration
befisc_luckpay    | 45          | 42         | 1850
```

**Bad output (mock active):**
```
provider_key | total_calls | successful | avg_duration
mock         | 45          | 45         | 50
```

---

## 🎯 Quick Checklist

Before claiming "BGV is working":

- [ ] Provider Status shows `befisc_luckpay` (not `mock`)
- [ ] No red warning banner visible
- [ ] Mock Calls Count = 0
- [ ] Success Rate > 85%
- [ ] API Call Logs show recent entries with provider = `befisc_luckpay`
- [ ] Clicked "View Response" on a log entry → sees real provider data (not mock)
- [ ] BGV Report shows Provider: `befisc_luckpay` and external Reference IDs
- [ ] Test Connection button returns success

---

## 🔐 Security Notes

- API Monitor is **admin/hr only** (role-gated)
- Response payloads may contain sensitive data → only show to authorized users
- PAN/Aadhaar/Bank data is **masked** in responses (security by design)
- Full raw responses visible only through "View Response" button (audit trail)

---

## 📝 Navigation

Add menu item to HRMS sidebar under **ATS → BGV API Monitor**:
- Icon: Activity or Database icon
- Route: `/ats/bgv-api-monitor`
- Label: "BGV API Monitor"
- Roles: Super Admin, HR Admin, HR

---

## 🆘 Troubleshooting

### "Provider status unavailable"
- Backend route not deployed or crashing
- Check backend logs: `pm2 logs hrms2-backend`

### "No API logs found"
- No BGV verifications have been run yet
- Trigger a test: candidate onboarding → complete profile → trigger BGV checks

### "Connection test failed"
- API credentials invalid
- Network issue (firewall blocking Luckpay API)
- Provider service down (check Luckpay status page)

### Mock calls still showing after fixing config
- Old logs from before fix (normal)
- Check **Calls Today** stat — if 0, wait for next verification to run
- Force a new verification: go to candidate → BGV Report → click verify PAN/Bank

---

**Built with:** React + TypeScript + shadcn/ui + Express + MySQL  
**Version:** 1.0  
**Last Updated:** 2026-07-08
