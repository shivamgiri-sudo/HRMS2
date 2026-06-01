# Communication Module - Remaining Tasks

## Backend (1 task)

### Task 14: Cleanup Cron
- **File**: `cleanup.cron.ts`
- **Purpose**: Daily cron (2 AM) to delete old dispatch logs per retention policy
- **Logic**: 
  - Delete logs where `is_critical = 0` AND `retention_category = 'routine'` AND `sent_at < NOW() - INTERVAL 30 DAY`
  - Delete logs where `is_critical = 0` AND `retention_category = 'standard'` AND `sent_at < NOW() - INTERVAL 90 DAY`
  - Keep all `is_critical = 1` logs forever
- **Integration**: Register in cron scheduler (e.g., node-cron or similar)

## Frontend (4 tasks)

### Task 15: Template Manager UI
- **File**: `src/pages/NativeTemplateManager.tsx`
- **Features**: Template CRUD, rich text editor with Handlebars variable picker
- **API**: GET/POST/PATCH /api/communication/templates

### Task 16: Dispatch Center UI
- **Files**: 
  - `src/pages/NativeDispatchCenter.tsx` (send messages)
  - `src/pages/NativeDispatchHistory.tsx` (logs + retry)
- **Features**: Send form, bulk filters, dispatch logs table, retry button, stats dashboard
- **API**: POST /api/communication/dispatch/{send,bulk}, GET /api/communication/dispatch/{logs,stats}

### Task 17: Preferences UI
- **File**: `src/pages/NativeNotificationPreferences.tsx`
- **Features**: Per-category channel selection (email/SMS/WhatsApp), enable/disable toggle
- **API**: GET/PUT /api/communication/preferences/:employeeId

### Task 18: Navigation Integration
- **Files**: 
  - `src/App.tsx` (add routes)
  - `src/components/layout/DashboardLayout.tsx` (nav items)
- **Routes**: 
  - `/communication/templates` (HR only)
  - `/communication/dispatch` (HR only)
  - `/communication/history` (Employee read-only for own logs)
  - `/communication/preferences` (Employee)

## Integration

### Register routes in `backend/src/app.ts`:
```typescript
import { communicationRoutes } from './modules/communication/communication.routes.js';
app.use('/api/communication', communicationRoutes);
```

### Add RBAC permissions in `backend/src/modules/access/role.catalog.ts`:
```typescript
communication_templates_read: ['hr', 'admin'],
communication_templates_write: ['hr', 'admin'],
communication_dispatch: ['hr', 'admin'],
communication_logs_read: ['hr', 'admin', 'manager', 'employee'], // employees see own only
communication_preferences_write: ['employee', 'hr', 'admin']
```

## Deployment

1. Run SQL migration: `backend/sql/040_communication.sql`
2. Install Twilio SDK (already done): `npm install twilio handlebars`
3. Set env vars:
   ```
   SMTP_HOST=
   SMTP_PORT=
   SMTP_USER=
   SMTP_PASS=
   SMTP_FROM=
   TWILIO_ACCOUNT_SID=
   TWILIO_AUTH_TOKEN=
   TWILIO_MESSAGING_SERVICE_SID=
   TWILIO_WHATSAPP_NUMBER=
   EMAIL_PROVIDER=nodemailer|local-email-tool
   SMS_PROVIDER=twilio|local-sms-tool
   WHATSAPP_PROVIDER=twilio|local-whatsapp-tool
   ```
4. Deploy backend to Railway
5. Deploy frontend to Vercel
6. Test: Create template → Send test message → Check dispatch logs

## Status

- ✅ Tasks 1-18 complete (ALL DONE)
  - Tasks 1-13: Database, types, providers, services, controller, routes
  - Task 14: Cleanup cron (added by remote)
  - Tasks 15-16: TemplateManager, DispatchCenter, DispatchHistory UI (added by remote)
  - Task 17: NotificationPreferences UI (completed)
  - Task 18: Navigation integration (completed)

Communication module fully implemented. Backend API + frontend UI complete.
