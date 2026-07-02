# Client Master Enhancement - Implementation Plan

## Completed (Database + Backend Services)

### 1. Database Schema ✅
**File**: `backend/sql/101_client_master_enhancement.sql`

- **clients** table - Full client entity with contact, address, subscription
- **Enhanced portal_users** - Activity tracking, access levels, date restrictions
- **portal_user_activity_log** - Complete audit trail
- **portal_user_sessions** - Session management
- **portal_user_permissions** - Granular permission matrix
- **client_usage_stats** - Daily aggregated analytics
- **process_performance_metrics** - Process KPIs
- **bulk_operation_jobs** - Bulk import/export tracking
- **client_audit_log** - Comprehensive audit

### 2. Backend Services ✅
**Files Created**:
- `backend/src/modules/portal/client.service.ts` - Client CRUD + analytics
- `backend/src/modules/portal/enhanced-portal-user.service.ts` - User management + activity

**Key Functions**:
- listClients(), createClient(), updateClient()
- getClientStats(), getClientUsageSummary()
- updatePortalUser(), deactivatePortalUser(), reactivatePortalUser()
- logPortalUserActivity(), getPortalUserActivity()
- grantPermission(), revokePermission(), getUserPermissions()
- getUserActivitySummary()

## Remaining Work

### 3. Backend Routes (TODO)
**File**: `backend/src/modules/portal/client.routes.ts`

```typescript
// Client Management
GET    /api/clients                  - List all clients
POST   /api/clients                  - Create client
GET    /api/clients/:id              - Get client details
PUT    /api/clients/:id              - Update client
PATCH  /api/clients/:id/status       - Toggle active status
GET    /api/clients/stats            - Client statistics
GET    /api/clients/usage-summary    - Usage analytics

// Enhanced Portal User Management
GET    /api/portal-users             - List users (with filters)
GET    /api/portal-users/:id         - Get user details
PUT    /api/portal-users/:id         - Update user
POST   /api/portal-users/:id/deactivate - Deactivate user
POST   /api/portal-users/:id/reactivate - Reactivate user
GET    /api/portal-users/:id/activity   - User activity log
GET    /api/portal-users/:id/logins     - Recent logins
GET    /api/portal-users/:id/permissions - User permissions
POST   /api/portal-users/:id/permissions - Grant permission
DELETE /api/portal-users/:id/permissions/:type - Revoke permission

// Analytics
GET    /api/analytics/user-activity  - User activity summary
GET    /api/analytics/client-usage   - Client usage trends

// Bulk Operations
POST   /api/bulk/import-users        - Bulk user import (CSV)
POST   /api/bulk/import-processes    - Bulk process import
GET    /api/bulk/jobs                - List bulk jobs
GET    /api/bulk/jobs/:id            - Get job status
```

### 4. Frontend - Enhanced Client Master Page (TODO)
**File**: `src/pages/EnhancedClientMaster.tsx`

**Features**:
- **Tab 1: Clients** (NEW)
  - Full client cards with logo, contact, subscription status
  - Add/Edit client modal with all fields
  - Client stats dashboard
  - Subscription status management
  - Usage analytics per client

- **Tab 2: Portal Users** (ENHANCED)
  - Current features PLUS:
  - Edit user button + modal
  - Deactivate/Reactivate buttons
  - Access level badges (READ_ONLY, FULL_ACCESS, ADMIN)
  - Date-based access indicators
  - Last login timestamp
  - Login count badge
  - Activity log viewer (modal)
  - Permissions management (modal)

- **Tab 3: Processes** (ENHANCED)
  - Current features PLUS:
  - Process owner details
  - SLA configuration (response/resolution hours)
  - Escalation contacts
  - Process type badges
  - Billing rate
  - Performance metrics link

- **Tab 4: Analytics** (NEW)
  - Client usage trends (30/60/90 days)
  - Active users chart
  - Login frequency heatmap
  - API usage graph
  - Report views by client
  - Process performance dashboard
  - Top users by activity
  - Export analytics (CSV/PDF)

- **Tab 5: Bulk Operations** (NEW)
  - CSV upload for users/processes
  - Template download buttons
  - Job queue table
  - Progress indicators
  - Error log viewer
  - Success/failure summary

### 5. CSV Import/Export (TODO)
**Files**:
- `backend/src/modules/portal/csv-import.service.ts`
- `backend/src/modules/portal/csv-export.service.ts`

**Templates**:
- Portal Users CSV: email, full_name, client_code, access_level, process_ids, access_start_date, access_end_date
- Processes CSV: process_name, client_code, process_type, sla_response_hours, process_owner_email
- Clients CSV: client_code, client_name, primary_contact_email, contract_start_date, billing_cycle

### 6. Activity Tracking Middleware (TODO)
**File**: `backend/src/middleware/portalActivityLogger.ts`

Auto-log all portal API requests:
- Capture request method, path, IP, user agent
- Measure response time
- Log to portal_user_activity_log
- Update last_login_at on each request

### 7. Session Management (TODO)
**File**: `backend/src/modules/portal/session.service.ts`

- Create session on login
- Validate session on each request
- Track concurrent sessions
- Auto-expire inactive sessions
- Force logout from all devices

### 8. Permission Checking Middleware (TODO)
**File**: `backend/src/middleware/portalPermissionCheck.ts`

Check user permissions before allowing resource access:
- VIEW_REPORTS, DOWNLOAD_DATA, VIEW_EMPLOYEES, etc.
- Scope checking (ALL, PROCESS_SPECIFIC, BRANCH_SPECIFIC)
- Date-based access expiry

## Migration Path

1. **Run SQL Migration**:
   ```bash
   mysql -u root -p mas_hrms < backend/sql/101_client_master_enhancement.sql
   ```

2. **Migrate Existing Data**:
   - Create client records from existing process.client_id
   - Update processes.client_uuid to link to new clients table
   - Backfill portal_users with default access_level = 'READ_ONLY'

3. **Deploy Backend Routes**:
   - Add routes to app.ts
   - Test all endpoints

4. **Deploy Frontend**:
   - Replace NativeClientMaster.tsx with EnhancedClientMaster.tsx
   - Update routing in App.tsx

5. **Enable Activity Tracking**:
   - Add middleware to portal routes
   - Start logging all requests

## Feature Flags (Optional)

For gradual rollout, add feature flags:
- `ENABLE_CLIENT_MASTER_V2`
- `ENABLE_USER_ACTIVITY_TRACKING`
- `ENABLE_BULK_OPERATIONS`
- `ENABLE_ANALYTICS_DASHBOARD`

## Testing Checklist

- [ ] Create client with all fields
- [ ] Update client details
- [ ] Toggle client status
- [ ] Create portal user with date-based access
- [ ] Edit portal user
- [ ] Deactivate/reactivate user
- [ ] View user activity log
- [ ] Grant/revoke permissions
- [ ] Import users via CSV
- [ ] View analytics dashboard
- [ ] Export usage report
- [ ] Test SLA configuration on processes
- [ ] Verify audit trail

## Performance Considerations

- **Pagination**: All list endpoints should support pagination
- **Indexing**: Ensure indexes on created_at, client_id, user_id
- **Archiving**: Archive activity logs older than 90 days
- **Caching**: Cache client list, user permissions (Redis)
- **Batch Processing**: Bulk operations run async with job queue

## Security

- **Admin Only**: All client management routes require admin role
- **Audit Everything**: Log all create/update/delete operations
- **Data Privacy**: Mask sensitive fields in activity logs
- **Rate Limiting**: Apply to bulk import endpoints
- **File Upload**: Validate CSV format, size limits

## Next Steps

1. Commit current work (SQL + services)
2. Build backend routes
3. Build enhanced frontend UI
4. Implement CSV import/export
5. Add activity tracking middleware
6. Deploy to staging for testing
