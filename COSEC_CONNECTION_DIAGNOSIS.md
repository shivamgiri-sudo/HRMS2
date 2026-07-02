# COSEC Connection Diagnosis Report

**Date:** June 15, 2026  
**Server:** 14.97.30.234

---

## 🔍 Network Test Results

### ✅ **Server is Reachable**
```bash
PING 14.97.30.234
✓ Response time: 6-8 ms
✓ 0% packet loss
✓ Server is online
```

### ✅ **Port 80 (HTTP) - OPEN**
```bash
Port 80: ✓ OPEN
Service: Microsoft-IIS/8.5
Status: Running (Default IIS page)
```

### ❌ **Port 1433 (SQL Server) - BLOCKED**
```bash
Port 1433: ✗ BLOCKED/FILTERED
Timeout: 30 seconds
Status: Cannot connect to SQL Server
```

---

## 🎯 Root Cause

**SQL Server port 1433 is blocked by firewall.**

The server is accessible (ping works, HTTP works), but SQL Server port is not exposed externally.

---

## 💡 Solutions

### **Option 1: Contact IT to Open Port 1433** (Recommended)

**Ask IT team to:**
1. Open firewall rule for port 1433
2. Allow traffic from HRMS server IP: `122.184.128.90`
3. Or allow from your current IP: `192.168.1.12`

**Firewall Rule Needed:**
```
Source: 122.184.128.90 (or your office subnet)
Destination: 14.97.30.234
Port: 1433 (TCP)
Action: ALLOW
```

---

### **Option 2: Use SSH Tunnel** (Temporary Workaround)

If you have SSH access to a machine that CAN reach the SQL Server:

```bash
# Create SSH tunnel
ssh -L 1433:14.97.30.234:1433 user@jump-server

# Then update .env to use localhost
NCOSEC_DB_HOST=localhost
NCOSEC_DB_PORT=1433
```

---

### **Option 3: Check if SQL Server Uses Different Port**

Some SQL Server instances run on non-standard ports.

**Try common SQL Server ports:**
```bash
# Test other common ports
for port in 1433 1434 14330 14331 49152; do
  echo "Testing port $port..."
  timeout 2 nc -zv 14.97.30.234 $port 2>&1
done
```

Run this to scan:
```bash
cd /home/shuvam/hrms-audit/backend
cat > test-ports.sh << 'EOF'
#!/bin/bash
echo "Scanning SQL Server ports on 14.97.30.234..."
for port in 1433 1434 14330 14331 49152 49153 49154; do
  timeout 2 nc -zv 14.97.30.234 $port 2>&1 | grep -q "succeeded" && echo "✓ Port $port is OPEN" || echo "✗ Port $port is closed"
done
EOF
chmod +x test-ports.sh
./test-ports.sh
```

---

### **Option 4: VPN Connection**

The server might require VPN access.

**Check if you're on VPN:**
```bash
# List VPN interfaces
ip link show | grep -E "tun|ppp|vpn"

# Check VPN status
nmcli connection show --active | grep vpn
```

**If not on VPN:**
1. Connect to company VPN
2. Retry connection test

---

### **Option 5: Web-based SQL Server API**

If COSEC provides a REST API over HTTP/HTTPS:

**Check for API endpoints:**
```bash
# Try common API paths
curl -v http://14.97.30.234/api 2>&1 | grep -i "200\|404\|api"
curl -v http://14.97.30.234/cosec 2>&1 | grep -i "200\|404"
curl -v http://14.97.30.234/WebAPI 2>&1 | grep -i "200\|404"
```

**If API exists, we can:**
- Query attendance data via HTTP
- Skip direct SQL Server connection
- Modify integration to use REST API

---

### **Option 6: SQL Server Browser Service**

SQL Server might be using dynamic ports.

**Query SQL Server Browser (port 1434 UDP):**
```bash
# Check if SQL Browser is responding
timeout 2 nc -u 14.97.30.234 1434 2>&1
```

**If Browser is available:**
- SQL Server might be on a named instance
- Try connection string: `14.97.30.234\INSTANCENAME`

---

## 📊 Current Network Status

| Service | Port | Status | Notes |
|---------|------|--------|-------|
| ICMP Ping | - | ✅ OPEN | 6-8ms latency |
| HTTP (IIS) | 80 | ✅ OPEN | Default IIS page |
| HTTPS | 443 | ❓ Unknown | Not tested |
| SQL Server | 1433 | ❌ BLOCKED | Timeout after 30s |
| SQL Browser | 1434 | ❓ Unknown | Not tested |

---

## 🚀 Recommended Actions

### **Immediate (Do Now):**

1. **Scan for alternative ports:**
   ```bash
   cd /home/shuvam/hrms-audit/backend
   nmap -p 1433,1434,14330-14335,49152-49160 14.97.30.234
   ```

2. **Check if COSEC has REST API:**
   ```bash
   curl -I http://14.97.30.234/api/attendance
   curl -I http://14.97.30.234/cosec/api
   ```

3. **Contact COSEC Administrator:**
   - Ask: "What port is SQL Server running on?"
   - Ask: "Is there a REST API for attendance data?"
   - Ask: "Do I need VPN to access SQL Server?"

---

### **Short Term (Next 24 Hours):**

1. **Work with IT Team:**
   - Request firewall rule: Allow 122.184.128.90 → 14.97.30.234:1433
   - Or whitelist your office subnet
   - Get VPN credentials if required

2. **Try from Different Network:**
   - Test from office network directly
   - Test from server that's already inside the network

3. **Check COSEC Documentation:**
   - Look for API documentation
   - Check if COSEC has web services

---

### **Long Term (This Week):**

1. **Set up VPN-based automation:**
   - Configure auto-connect VPN before sync
   - Schedule sync during office hours when VPN is active

2. **Or: Move migration to internal server:**
   - Run migration from a server inside the network
   - That server can already access SQL Server

3. **Or: Request API access:**
   - Ask COSEC vendor for REST API
   - More secure than exposing SQL Server port

---

## 🧪 Test Commands to Run

```bash
cd /home/shuvam/hrms-audit/backend

# 1. Full port scan
nmap -p 1433,1434,1435,14330-14335,49152-49160 14.97.30.234

# 2. Check for COSEC web API
for path in /api /cosec /WebAPI /attendance /punch; do
  echo "Testing: http://14.97.30.234$path"
  curl -I http://14.97.30.234$path 2>&1 | grep "HTTP"
done

# 3. Check HTTPS
curl -k -I https://14.97.30.234 2>&1 | head -5

# 4. Try SQL Server Browser
echo -n "" | nc -u 14.97.30.234 1434 -w 2

# 5. Check if on VPN
ip addr | grep -E "tun|ppp|vpn"
```

---

## 📞 Contact Information Needed

**Get from IT/DBA:**

1. ✅ Server IP: 14.97.30.234 (confirmed)
2. ❓ SQL Server Port: ____ (default 1433 blocked, need actual port)
3. ❓ VPN Required: Yes / No
4. ❓ VPN Config: ____ (if required)
5. ❓ Firewall Whitelist Status: ____ (pending)
6. ❓ SQL Server Instance Name: ____ (if not default)
7. ❓ REST API Available: Yes / No
8. ❓ REST API Base URL: ____ (if available)

---

## 🔐 Alternative: COSEC REST API Integration

If direct SQL Server access is not possible, we can integrate via REST API.

**Benefits:**
- ✅ More secure (no SQL port exposed)
- ✅ Works through firewall
- ✅ Standard HTTP/HTTPS
- ✅ Easier to maintain

**Implementation:**
```typescript
// New adapter: backend/src/modules/wfm/cosec-api-adapter.ts
async function fetchAttendanceViaAPI(date: string) {
  const response = await axios.get(
    `http://14.97.30.234/api/attendance`,
    {
      params: { date },
      auth: {
        username: 'shivamg',
        password: process.env.NCOSEC_DB_PASSWORD
      }
    }
  );
  return response.data;
}
```

---

## ✅ Next Steps

1. **Run port scan** to find actual SQL Server port
2. **Contact IT** to open port 1433 or get VPN access
3. **Check for REST API** as alternative
4. **Test from office network** if possible
5. **Update configuration** once connectivity is resolved

---

## 📋 Summary

**Status:** 🟡 **Partially Accessible**

- ✅ Server is online and reachable
- ✅ HTTP (port 80) works
- ❌ SQL Server (port 1433) is blocked
- ⚠️ Need IT intervention or alternative access method

**Most Likely Solution:** IT needs to open firewall for port 1433

**Estimated Time to Fix:** 1-2 hours (once IT is contacted)

---

**Created:** June 15, 2026  
**Last Test:** Just now  
**Next Action:** Contact IT team to open port 1433
