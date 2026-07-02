# Local Deployment Guide — HRMS (MySQL-Only)

This guide explains how to deploy the HRMS application locally for development and testing with **MySQL only** (no Supabase, no cloud dependencies).

---

## Prerequisites

- **Node.js** 18+ and npm/yarn
- **MySQL** 8.0+ (local install or Docker)
- **Docker & Docker Compose** (optional, for containerized deployment)

---

## Quick Start (Docker Compose — Recommended)

### 1. Clone and Setup

```bash
cd /home/shuvam/HRMS1-admin-e2e
```

### 2. Configure Environment

```bash
# Frontend
cp .env.local.example .env.local

# Backend
cp backend/.env.local.example backend/.env
```

### 3. Start Services

```bash
# Build and start all services (MySQL + Backend + Frontend)
docker-compose -f docker-compose.mysql.yml up --build

# Or run in background
docker-compose -f docker-compose.mysql.yml up -d --build
```

### 4. Access the Application

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Backend API | http://localhost:5055 |
| MySQL | localhost:3306 |

### 5. Stop Services

```bash
# Stop and remove containers
docker-compose -f docker-compose.mysql.yml down

# Stop and remove containers + delete MySQL data
docker-compose -f docker-compose.mysql.yml down -v
```

---

## Manual Setup (Without Docker)

### 1. Setup MySQL

```bash
# Start MySQL (if not running)
sudo systemctl start mysql  # Linux
brew services start mysql   # macOS

# Create database
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS mas_hrms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Create user (optional — can use root for local dev)
mysql -u root -p -e "CREATE USER IF NOT EXISTS 'hrms_user'@'localhost' IDENTIFIED BY 'hrms_pass';"
mysql -u root -p -e "GRANT ALL PRIVILEGES ON mas_hrms.* TO 'hrms_user'@'localhost';"
mysql -u root -p -e "FLUSH PRIVILEGES;"
```

### 2. Configure Backend

```bash
cd backend

# Copy environment file
cp .env.local.example .env

# Edit .env to set your MySQL credentials if different from defaults
# DB_HOST=localhost
# DB_USER=root
# DB_PASSWORD=your_password

# Install dependencies
npm install

# Run database migrations
npm run db:migrate
# Or: npx knex migrate:latest

# (Optional) Seed demo data
npm run db:seed
```

### 3. Start Backend

```bash
# Development mode (with auto-reload)
npm run dev

# Or production mode
npm run build
npm start
```

Backend will be available at `http://localhost:5055`

### 4. Configure and Start Frontend

```bash
cd ..  # Back to project root

# Copy environment file
cp .env.local.example .env.local

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend will be available at `http://localhost:8080`

---

## Default Login Credentials

After seeding demo data (`SEED_DEMO_DATA=true`), use these credentials:

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@mas.com | Super@123 |
| HR Admin | hradmin@mas.com | Hr@123 |
| Employee | employee@mas.com | Employee@123 |

> **Note:** Demo credentials only work when `PORTAL_DEMO_BYPASS=true` or `INTERNAL_DEMO_BYPASS=true` is set in backend `.env`.

---

## Environment Variables Reference

### Frontend (.env.local)

| Variable | Value | Description |
|----------|-------|-------------|
| `VITE_HRMS_API_URL` | `http://localhost:5055` | Backend API base URL |
| `VITE_HRMS_*` | `backend` | All feature flags set to use backend APIs |
| `VITE_ENABLE_DEMO_LOGIN` | `true` | Enable demo login buttons |

### Backend (backend/.env)

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `development` | Development mode |
| `PORT` | `5055` | Backend server port |
| `DB_HOST` | `localhost` or `mysql` | MySQL host (use `mysql` for Docker) |
| `DB_USER` | `root` | MySQL username |
| `DB_PASSWORD` | `root` | MySQL password |
| `DB_NAME` | `mas_hrms` | Database name |
| `ENABLE_SCHEDULERS` | `false` | Disable background workers |
| `SEED_DEMO_DATA` | `true` | Seed demo data on first run |

---

## Troubleshooting

### MySQL Connection Errors

**Error:** `ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:3306`

**Solution:**
```bash
# Check if MySQL is running
sudo systemctl status mysql

# Start MySQL
sudo systemctl start mysql

# Check port
netstat -tlnp | grep 3306
```

### Database Migration Errors

**Error:** `Table 'mas_hrms.knex_migrations' doesn't exist`

**Solution:**
```bash
# Create database manually first
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS mas_hrms;"

# Then run migrations
cd backend
npx knex migrate:latest
```

### Port Already in Use

**Error:** `Port 5055 is already in use`

**Solution:**
```bash
# Find and kill process using port 5055
lsof -ti:5055 | xargs kill -9

# Or change the port in backend/.env
PORT=5056
```

### CORS Errors in Browser

**Error:** `CORS policy: No 'Access-Control-Allow-Origin' header`

**Solution:**
- Ensure `FRONTEND_URL` in backend `.env` matches your frontend URL
- Default is `http://localhost:8080`

### Docker: Container Exits Immediately

**Solution:**
```bash
# View logs
docker-compose -f docker-compose.mysql.yml logs -f

# Check MySQL health
docker-compose -f docker-compose.mysql.yml ps

# Rebuild from scratch
docker-compose -f docker-compose.mysql.yml down -v
docker-compose -f docker-compose.mysql.yml up --build
```

### Node Modules Issues

**Solution:**
```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install

# For backend
cd backend
rm -rf node_modules package-lock.json
npm install
```

---

## File Structure

```
HRMS1-admin-e2e/
├── .env.local              # Frontend environment (created from .env.local.example)
├── .env.local.example      # Frontend environment template
├── docker-compose.mysql.yml # Docker Compose for MySQL + App stack
├── LOCAL_DEPLOYMENT_GUIDE.md # This file
├── backend/
│   ├── .env                # Backend environment (created from .env.local.example)
│   ├── .env.local.example  # Backend environment template
│   └── ...
└── ...
```

---

## Next Steps

1. **Verify Installation:** Login with demo credentials at http://localhost:8080
2. **Check API Health:** Visit http://localhost:5055/health (if endpoint exists)
3. **Review Logs:** Use `docker-compose logs -f` or `npm run dev` console output
4. **Customize Config:** Edit `.env` files for your specific requirements

---

## Production Notes

⚠️ **Never use these local configurations in production:**

- Change all JWT secrets and encryption keys
- Use strong, unique passwords
- Disable demo bypass flags
- Enable schedulers if needed
- Set up proper SMTP credentials
- Use SSL/TLS for database connections
- Review and harden all security settings
