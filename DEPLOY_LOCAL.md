# Local Deployment Guide

## Quick Start (Docker)

### Prerequisites
- Docker + Docker Compose installed
- 4GB+ RAM available
- Ports 3306, 5055, 8080, 8081 available

### Deploy
```bash
cd /home/shuvam/Desktop/MyHRMS1

# Start all services (MySQL, backend, frontend, adminer)
docker compose -f docker-compose.local.yml up -d

# Verify services
docker compose -f docker-compose.local.yml ps

# Check logs
docker compose -f docker-compose.local.yml logs -f backend
docker compose -f docker-compose.local.yml logs -f mysql
```

### Access
- Frontend: http://localhost:8080
- Backend API: http://localhost:5055
- Database Admin: http://localhost:8081
- API Health: http://localhost:5055/api/health

### Stop
```bash
docker compose -f docker-compose.local.yml down
```

---

## Manual Deployment (Without Docker)

### Prerequisites
- MySQL 8.0+ running locally
- Node.js v18+ installed
- npm/yarn installed

### 1. Database Setup
```bash
# Configure database
export DB_HOST=localhost
export DB_PORT=3306
export DB_NAME=mas_hrms
export DB_USER=root
export DB_PASSWORD=your_password

# Create database
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS mas_hrms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Run migrations
cd /home/shuvam/Desktop/MyHRMS1
mysql -u root -p mas_hrms < backend/sql/000_run_all.sql

# Verify
mysql -u root -p -e "USE mas_hrms; SHOW TABLES LIKE 'gratuity%'; SELECT COUNT(*) FROM leave_credit_schedule;"
```

### 2. Backend Setup
```bash
cd /home/shuvam/Desktop/MyHRMS1/backend

# Install dependencies
npm install

# Create .env file
cat > .env << 'EOF'
DB_HOST=localhost
DB_PORT=3306
DB_NAME=mas_hrms
DB_USER=root
DB_PASSWORD=your_password
SERVER_PORT=5055
NODE_ENV=production
JWT_SECRET=your_jwt_secret_key_here
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
EOF

# Build
npm run build

# Start
npm start
# Or run dev mode: npm run dev
```

### 3. Frontend Setup
```bash
cd /home/shuvam/Desktop/MyHRMS1

# Install dependencies
npm install

# Create .env.local (if not exists)
cat > .env.local << 'EOF'
VITE_HRMS_API_URL=http://localhost:5055
VITE_API_URL=http://localhost:5055
VITE_ENABLE_DEMO_LOGIN=true
EOF

# Build
npm run build

# Serve (use any HTTP server)
# Option 1: Python
python -m http.server 8080 --directory dist

# Option 2: npx http-server
npx http-server dist -p 8080

# Option 3: Node.js with serve
npm install -g serve
serve -s dist -l 8080
```

### 4. Verify Deployment
```bash
# Backend health
curl http://localhost:5055/api/health

# Database connectivity
curl http://localhost:5055/api/employees/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Frontend loads
curl http://localhost:8080 | head -20
```

---

## Post-Deployment Verification

### Database
```sql
-- Check leave credit schedule
SELECT * FROM leave_credit_schedule ORDER BY month;

-- Check gratuity tables
SHOW TABLES LIKE 'gratuity%';

-- Check address fields
DESC employees LIKE '%address%';

-- Check nominee support
DESC employee_nominee LIKE '%nominee%';

-- Sample counts
SELECT 
  (SELECT COUNT(*) FROM employees) AS total_employees,
  (SELECT COUNT(*) FROM leave_credit_schedule) AS leave_schedules,
  (SELECT COUNT(*) FROM gratuity_calculation_audit) AS gratuity_audits,
  (SELECT COUNT(*) FROM employee_nominee) AS nominees;
```

### API Testing
```bash
# Login (demo account)
curl -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@mas.in","password":"demo"}'

# Create leave request
curl -X POST http://localhost:5055/api/leave/submit \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leaveTypeId":"cl-id",
    "fromDate":"2026-06-25",
    "toDate":"2026-06-26",
    "reason":"Personal"
  }'

# Get employee profile
curl http://localhost:5055/api/employees/me \
  -H "Authorization: Bearer TOKEN"
```

### Frontend Testing
1. Navigate to http://localhost:8080
2. Login with demo credentials
3. Test leave submission (should show 6 validation rules)
4. Test employee profile save (should persist all 25 columns)
5. Verify candidate→employee conversion preserves nominee data

---

## Troubleshooting

### MySQL Connection Failed
```bash
# Verify MySQL running
docker ps | grep mysql
# or
mysql -u root -p -e "SHOW DATABASES;"

# Check port
netstat -tuln | grep 3306
```

### Backend won't start
```bash
# Check logs
cd /home/shuvam/Desktop/MyHRMS1/backend
npm run dev 2>&1 | head -50

# Verify migrations ran
mysql -u root -p -e "USE mas_hrms; SHOW TABLES LIMIT 10;"
```

### Frontend blank page
```bash
# Check browser console
# Verify API URL in .env.local
# Check backend health: curl http://localhost:5055/api/health
```

---

## Commit Reference
- `5ca7521` — Leave monthly credit redesign
- `98da220` — Bug fixes (endpoints, field mapping, cross-type deduction)
- `d6e27f4` — Schema field cleanup
- `a9da668` — Working hours strategy
- `3349211` — Migration 211 + attendance field names
- `1b6040e` — profile.service.ts cleanup
- `d1012ed` — All 7 cascading issues (offer INSERT, nominee migration, gratuity distribution)

---

## Notes
- All 7 issues fixed (offer INSERT, nominee migration, gratuity distribution, address naming, GROUP BY)
- Leave credit schedule seeded with 12-month alternating CL/ML
- Nominee data auto-migrated on hire
- All migrations additive + backward-compatible
