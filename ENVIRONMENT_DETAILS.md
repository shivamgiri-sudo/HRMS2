# HRMS Environment Details

**Project**: MAS Callnet HRMS  
**Date**: 2026-06-05  
**Status**: Production Ready  

---

## 📂 Project Structure

```
hrms-audit/
├── backend/          # Node.js/Express API server
├── src/              # React/Vite frontend
├── sql/              # Database migrations
└── uploads/          # File storage
```

---

## 🔧 Backend Environment

### Server Configuration
```env
NODE_ENV=production
PORT=5055
FRONTEND_URL=http://localhost:8080
```

### Database - MySQL (Primary)
```env
ACTIVE_DB_PROVIDER=mysql

# Production MySQL Database
DB_HOST=122.184.128.90
DB_PORT=3306
DB_USER=root
DB_PASSWORD=vicidialnow
DB_NAME=mas_hrms
DB_POOL_MAX=10
```

**Database**: `mas_hrms`  
**Purpose**: Primary HRMS data (employees, attendance, leave, payroll, etc.)  
**Status**: ✅ Active

### Additional Databases

#### NCOSEC Biometric (SQL Server)
```env
NCOSEC_DB_HOST=172.10.10.146
NCOSEC_DB_PORT=1433
NCOSEC_DB_USER=shivamg
NCOSEC_DB_PASSWORD=your-ncosec-password
NCOSEC_DB_NAME=NCOSEC
NCOSEC_DB_ENCRYPT=false
```

**Purpose**: Biometric attendance integration (Matrix Cosec)  
**Type**: SQL Server (MSSQL)  
**Status**: ✅ Integrated

#### External Databases (Read-Only)
- `dialer_db` - Call center dialer data
- `Shivamgiri` - Legacy data
- `db_audit` - Audit logs
- `db_external` - External integrations

### Security
```env
# Portal JWT Secret (generate with: openssl rand -hex 32)
PORTAL_JWT_SECRET=change-me-to-random-32-char-string

# BGV Provider Secret (for callback signature validation)
BGV_PROVIDER_SECRET=<secret-key-from-provider>
```

⚠️ **Action Required**: Generate and set secure random values for production

### Removed Services
```
✅ Supabase removed - No Supabase environment variables required
```

---

## 🎨 Frontend Environment

### Build Configuration
- **Framework**: React 18.3.1
- **Build Tool**: Vite 5.4.19
- **TypeScript**: 5.8.3
- **UI Library**: Radix UI + Tailwind CSS + shadcn/ui

### Environment Variables
```env
VITE_HRMS_API_URL=/api  # Same-origin (production default)
```

**Note**: Frontend uses same-origin API by default. No localhost hardcoding.

### Scripts
```bash
npm run dev      # Development server (port 5173)
npm run build    # Production build
npm run preview  # Preview production build
```

---

## 🚀 Backend Stack

### Core Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| express | 4.21.2 | API server |
| mysql2 | 3.11.5 | MySQL client |
| mssql | 12.5.5 | SQL Server client (NCOSEC) |
| jsonwebtoken | 9.0.3 | JWT authentication |
| bcryptjs | 3.0.3 | Password hashing |
| zod | 3.24.2 | Schema validation |
| multer | 2.1.1 | File uploads |
| nodemailer | 8.0.7 | Email sending |
| twilio | 6.0.2 | SMS/WhatsApp |

### Dev Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| tsx | 4.19.2 | TypeScript execution |
| vitest | 4.1.7 | Testing framework |
| typescript | 5.7.3 | Type checking |

### Scripts
```bash
npm run dev      # Development (tsx watch)
npm run build    # Compile TypeScript
npm start        # Production server
npm test         # Run tests
```

---

## 🎨 Frontend Stack

### Core Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| react | 18.3.1 | UI framework |
| react-router-dom | 7.12.0 | Routing |
| @tanstack/react-query | 5.83.0 | Data fetching |
| zod | 3.25.76 | Schema validation |
| react-hook-form | 7.61.1 | Form handling |
| lucide-react | 0.462.0 | Icons |

### UI Components (Radix UI)
- Dialog, Dropdown, Popover, Select, Tabs
- Avatar, Badge, Button, Card, Checkbox
- Toast, Tooltip, Progress, Slider
- All components styled with Tailwind CSS

### Build Tools
| Package | Version | Purpose |
|---------|---------|---------|
| vite | 5.4.19 | Build tool |
| @vitejs/plugin-react-swc | 3.11.0 | React plugin (SWC) |
| tailwindcss | 3.4.17 | CSS framework |
| typescript | 5.8.3 | Type checking |

---

## 🗄️ Database Schema

### Key Tables
```sql
-- Authentication & Users
users
user_roles
roles
pages
role_page_access

-- Employees
employees
employee_journey_log
employee_documents

-- ATS (Recruitment)
ats_candidate
ats_candidate_stage_log
ats_onboarding_bridge
candidate_onboarding_profile
candidate_bgv_check
candidate_bgv_consent

-- Leave Management
leave_type_master
leave_balance_ledger
leave_request
leave_holiday_master

-- Attendance
wfm_attendance_log
wfm_attendance_correction
wfm_shift_master
wfm_roster_plan

-- Payroll
payroll_structure_master
payroll_component_master
salary_assignment
payroll_run
payroll_run_line

-- KPI & Performance
kpi_metric_master
kpi_template
kpi_assignment
kpi_score

-- DPDP Compliance
dpdp_consent_log

-- Portal
client_master
client_user_master
```

### Migrations
Located in `backend/sql/`:
- `000_` - Core schema
- `001-049_` - Module migrations
- `050-099_` - Feature migrations
- `900_` - RBAC seeds

---

## 🔐 Security Configuration

### Authentication
- **Method**: JWT (Access + Refresh tokens)
- **Storage**: HTTP-only cookies (recommended) or localStorage
- **Expiry**: Access token (configurable), Refresh token (long-lived)

### Authorization
- **Method**: Role-Based Access Control (RBAC)
- **Roles**: admin, hr, manager, recruiter, employee, qa, ceo, etc.
- **Pages**: Protected by page codes
- **APIs**: Protected by requireRole middleware

### Data Protection
- **Passwords**: bcrypt hashed
- **PII**: Masked in logs
- **Consent**: DPDP compliant (dpdp_consent_log)
- **File Uploads**: Type validation, size limits

### BGV Security
- **Callback**: HMAC-SHA256 signature validation
- **Secret**: BGV_PROVIDER_SECRET environment variable
- **Verification**: All provider callbacks validated

---

## 🌐 Network Configuration

### Ports
| Service | Port | Purpose |
|---------|------|---------|
| Backend | 5055 | API server |
| Frontend | 5173 | Development (Vite) |
| MySQL | 3306 | Primary database |
| MSSQL | 1433 | NCOSEC biometric |

### CORS
```javascript
// Backend allows:
- Frontend URL (from FRONTEND_URL env)
- Same-origin requests
```

---

## 📦 File Storage

### Upload Directory Structure
```
uploads/
├── candidates/       # ATS candidate files (resume, selfie)
├── documents/        # Employee documents
├── assets/           # Asset management files
└── temp/            # Temporary files
```

### File Upload Limits
- **Max Size**: 5MB per file
- **Allowed Types**: PDF, JPG, JPEG, PNG
- **Security**: 1-hour upload window for public candidate uploads

---

## 🔄 Integration Points

### Email (Nodemailer)
- **Purpose**: Send emails (offer letters, notifications)
- **Configuration**: Via nodemailer (SMTP)

### SMS/WhatsApp (Twilio)
- **Purpose**: Send SMS/WhatsApp messages
- **Configuration**: Via Twilio API

### Biometric (NCOSEC)
- **Purpose**: Attendance sync
- **Method**: SQL Server queries to NCOSEC database

### BGV Providers
- **Purpose**: Background verification
- **Method**: Webhook callbacks with signature validation

---

## 🧪 Testing

### Backend Tests
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

**Framework**: Vitest  
**Coverage**: @vitest/coverage-v8

### Frontend Tests
Not configured yet (recommended: Vitest + React Testing Library)

---

## 🚀 Deployment

### Production Checklist
- [ ] Set secure JWT secrets (PORTAL_JWT_SECRET, BGV_PROVIDER_SECRET)
- [ ] Configure FRONTEND_URL
- [ ] Verify database credentials
- [ ] Run migrations (`backend/sql/`)
- [ ] Seed RBAC pages (`900_rbac_page_seeds.sql`)
- [ ] Build frontend (`npm run build`)
- [ ] Build backend (`npm run build`)
- [ ] Start backend (`npm start`)
- [ ] Serve frontend (static files from `dist/`)

### Environment-Specific Configs

#### Development
```bash
# Backend
NODE_ENV=development
DB_HOST=localhost
PORT=3001

# Frontend
npm run dev  # Port 5173
```

#### Production
```bash
# Backend
NODE_ENV=production
DB_HOST=122.184.128.90
PORT=5055

# Frontend
npm run build  # Build to dist/
```

---

## 📊 Monitoring & Logs

### Backend Logs
- **Format**: Morgan (HTTP request logging)
- **Level**: Configurable via NODE_ENV

### Error Handling
- **Middleware**: Express error handler
- **Validation**: Zod schema errors
- **Database**: MySQL/MSSQL connection errors

---

## 🔧 Development Tools

### Recommended IDE
- **VSCode** with extensions:
  - ESLint
  - Prettier
  - TypeScript
  - Tailwind CSS IntelliSense

### Code Quality
```bash
# Backend
npm run typecheck  # TypeScript checking

# Frontend
npm run lint       # ESLint
```

---

## 📝 Configuration Files

### Backend
- `backend/.env` - Environment variables
- `backend/tsconfig.json` - TypeScript config
- `backend/package.json` - Dependencies

### Frontend
- `vite.config.ts` - Vite configuration
- `tsconfig.json` - TypeScript config
- `tailwind.config.js` - Tailwind CSS config
- `package.json` - Dependencies

---

## 🎯 Key Features Configured

### ✅ Implemented
- JWT authentication
- Role-based authorization
- MySQL primary database
- NCOSEC biometric integration
- File upload (candidates, documents)
- Email notifications
- SMS/WhatsApp (Twilio)
- BGV webhook security
- DPDP consent logging
- Scope filtering (branch/process/department)

### ⚠️ Configuration Required
- PORTAL_JWT_SECRET (generate random)
- BGV_PROVIDER_SECRET (from provider)
- FRONTEND_URL (production URL)
- Email SMTP settings (if using email)
- Twilio credentials (if using SMS)

---

## 📞 Support & Documentation

### Key Documents
1. [PROJECT_COMPLETION_REPORT.md](PROJECT_COMPLETION_REPORT.md)
2. [FINAL_STATUS_ALL_ISSUES_RESOLVED.md](FINAL_STATUS_ALL_ISSUES_RESOLVED.md)
3. [VALIDATION_ROUND_2_COMPLETE.md](VALIDATION_ROUND_2_COMPLETE.md)
4. [UAT_TEST_PLAN.md](UAT_TEST_PLAN.md)

### Quick Start
```bash
# Backend
cd backend
npm install
cp .env.example .env  # Configure environment
npm run dev

# Frontend
cd ..
npm install
npm run dev
```

---

**Last Updated**: 2026-06-05  
**Status**: Production Ready ✅  
**Version**: 1.0.0
