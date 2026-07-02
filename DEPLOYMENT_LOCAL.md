# Local Deployment Guide — MAS HRMS

This guide covers deploying HRMS on a local server with MySQL.

## Prerequisites

- Node.js 20+
- MySQL 8.0+
- Git

## Step 1: Database Setup

1. Create the MySQL database:
   ```sql
   CREATE DATABASE mas_hrms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'hrms_user'@'localhost' IDENTIFIED BY 'your_strong_password';
   GRANT ALL PRIVILEGES ON mas_hrms.* TO 'hrms_user'@'localhost';
   FLUSH PRIVILEGES;
   ```

2. The schema and tables are created **automatically** when the backend starts (migration runner).  
   Do NOT manually run the SQL files — let the backend handle it.

## Step 2: Backend Setup

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in these required values:

| Variable | Value |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_USER` | `hrms_user` |
| `DB_PASSWORD` | your MySQL password |
| `DB_NAME` | `mas_hrms` |
| `JWT_SECRET` | run: `openssl rand -hex 32` |
| `PORTAL_JWT_SECRET` | run: `openssl rand -hex 32` |
| `PAYROLL_BANK_KEY` | any 16+ char random string |
| `FRONTEND_URL` | `http://localhost:5173` (frontend URL) |
| `SMTP_HOST` | your SMTP host (e.g. `smtp.gmail.com`) |
| `SMTP_USER` | your email |
| `SMTP_PASS` | your SMTP app password |
| `SMTP_FROM` | your email |

Then install and start:

```bash
npm install
npm run build
npm start
```

The backend will start on port **5055** by default. You should see:
```
MCN HRMS backend running on http://localhost:5055
```

Verify: http://localhost:5055/api/health

## Step 3: Frontend Setup

```bash
# In the project root
cp .env.example .env.local
```

Edit `.env.local`:
```
VITE_HRMS_API_URL=http://localhost:5055
```

Install and build:
```bash
npm install
npm run build
```

Serve the built frontend (using any static file server):
```bash
# Using npx serve:
npx serve dist -p 5173

# Or using Python:
cd dist && python3 -m http.server 5173
```

Or for development mode:
```bash
npm run dev
```

Access the app at: http://localhost:5173

## Step 4: First Login

Default admin credentials (created by migration):
- **Email:** admin@mascallnet.com  
- **Password:** Admin@123456

**Change the password immediately after first login.**

## Default User Roles

| Email | Role | Password |
|---|---|---|
| admin@mascallnet.com | admin | Admin@123456 |
| hr@mascallnet.com | hr | Hr@123456 |
| manager@mascallnet.com | manager | Manager@123456 |
| employee@mascallnet.com | employee | Employee@123456 |

## Common Issues

**Backend fails to start:**
- Check MySQL is running: `systemctl status mysql`
- Check credentials in `.env`
- Check port 5055 is not in use

**Frontend can't reach backend (CORS error):**
- Verify `FRONTEND_URL=http://localhost:5173` in backend `.env`
- Verify `VITE_HRMS_API_URL=http://localhost:5055` in frontend `.env.local`

**Login fails:**
- Check JWT_SECRET is set and is at least 32 characters
- Check the backend health endpoint: http://localhost:5055/api/health

## Production Hardening Checklist

- [ ] Change all default passwords
- [ ] Generate strong JWT_SECRET and PORTAL_JWT_SECRET (32+ chars)
- [ ] Set NODE_ENV=production in backend .env
- [ ] Configure SMTP for email notifications
- [ ] Set up SSL/TLS (nginx reverse proxy recommended)
- [ ] Configure regular MySQL backups
- [ ] Remove INTERNAL_DEMO_BYPASS=true (must be false/unset in production)
