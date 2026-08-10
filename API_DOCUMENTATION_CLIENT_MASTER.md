## Client Master API Documentation - Phase 2

Complete API reference for client management and enhanced portal user operations.

**Base URL**: `http://localhost:3001/api`

**Authentication**: All endpoints require `Authorization: Bearer <token>` header

**Roles**: Most endpoints require `admin` or `hr` role

---

## Client Management Endpoints

### 1. List Clients
```
GET /clients
```

**Authorization**: `admin`, `hr`

**Query Parameters**:
- `active_only` (boolean) - Filter active clients only
- `subscription_status` (string) - Filter by: ACTIVE, SUSPENDED, TRIAL, EXPIRED
- `search` (string) - Search in name, code, email

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "client_code": "ABC_CORP",
      "client_name": "ABC Corporation",
      "legal_entity_name": "ABC Corp Private Limited",
      "industry": "Technology",
      "primary_contact_name": "John Doe",
      "primary_contact_email": "john@abc.com",
      "primary_contact_phone": "+91-9876543210",
      "city": "Mumbai",
      "country": "India",
      "subscription_status": "ACTIVE",
      "billing_cycle": "MONTHLY",
      "active_status": true,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Example**:
```bash
curl -X GET http://localhost:3001/api/clients?active_only=true&search=ABC \
  -H "Authorization: Bearer <token>"
```

---

### 2. Create Client
```
POST /clients
```

**Authorization**: `admin`, `hr`

**Request Body**:
```json
{
  "client_code": "ABC_CORP",
  "client_name": "ABC Corporation",
  "legal_entity_name": "ABC Corp Private Limited",
  "industry": "Technology",
  "primary_contact_name": "John Doe",
  "primary_contact_email": "john@abc.com",
  "primary_contact_phone": "+91-9876543210",
  "escalation_contact_name": "Jane Smith",
  "escalation_contact_email": "jane@abc.com",
  "address_line1": "123 Business Park",
  "city": "Mumbai",
  "state": "Maharashtra",
  "country": "India",
  "postal_code": "400001",
  "website": "https://abc.com",
  "contract_start_date": "2024-01-01",
  "contract_end_date": "2025-12-31",
  "billing_cycle": "MONTHLY",
  "webhook_url": "https://abc.com/webhook"
}
```

**Required Fields**: `client_code`, `client_name`

**Response**:
```json
{
  "success": true,
  "data": { ...client object },
  "message": "Client created successfully"
}
```

---

### 3. Get Client Details
```
GET /clients/:id
```

**Authorization**: `admin`, `hr`

**Response**:
```json
{
  "success": true,
  "data": { ...client object }
}
```

---

### 4. Update Client
```
PUT /clients/:id
```

**Authorization**: `admin`, `hr`

**Request Body**: Partial client object (any fields to update)

**Response**:
```json
{
  "success": true,
  "message": "Client updated successfully"
}
```

---

### 5. Toggle Client Status
```
PATCH /clients/:id/status
```

**Authorization**: `admin`

**Request Body**:
```json
{
  "active_status": false
}
```

**Response**:
```json
{
  "success": true,
  "message": "Client deactivated successfully"
}
```

---

### 6. Update Subscription Status
```
PATCH /clients/:id/subscription
```

**Authorization**: `admin`

**Request Body**:
```json
{
  "subscription_status": "SUSPENDED"
}
```

**Valid Values**: `ACTIVE`, `SUSPENDED`, `TRIAL`, `EXPIRED`

---

### 7. Get Client Statistics
```
GET /clients-stats
```

**Authorization**: `admin`, `hr`

**Response**:
```json
{
  "success": true,
  "data": {
    "total_clients": 50,
    "active_clients": 45,
    "trial_clients": 5,
    "total_processes": 120,
    "total_portal_users": 200,
    "active_portal_users": 180
  }
}
```

---

### 8. Get Client Usage Summary
```
GET /clients-usage?days=30
```

**Authorization**: `admin`, `hr`

**Query Parameters**:
- `days` (number) - Number of days to analyze (default: 30)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "client_id": "uuid",
      "client_name": "ABC Corporation",
      "active_users": 15,
      "total_logins": 450,
      "last_30_days_logins": 120,
      "api_calls": 850,
      "report_views": 300,
      "last_activity": "2024-01-20T15:30:00Z"
    }
  ]
}
```

---

## Enhanced Portal User Management

### 9. List Portal Users
```
GET /portal-users
```

**Authorization**: `admin`, `hr`

**Query Parameters**:
- `client_id` (string) - Filter by client
- `active_only` (boolean) - Active users only
- `access_level` (string) - Filter by: READ_ONLY, FULL_ACCESS, ADMIN
- `search` (string) - Search in name, email, designation

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "email": "user@client.com",
      "full_name": "John Doe",
      "phone": "+91-9876543210",
      "designation": "Manager",
      "department": "Operations",
      "client_id": "client-uuid",
      "process_ids": ["process-1", "process-2"],
      "access_level": "FULL_ACCESS",
      "access_start_date": "2024-01-01",
      "access_end_date": "2024-12-31",
      "last_login_at": "2024-01-20T10:30:00Z",
      "last_login_ip": "192.168.1.1",
      "login_count": 45,
      "is_active": true,
      "created_at": "2024-01-01T08:00:00Z"
    }
  ]
}
```

---

### 10. Get Portal User Details
```
GET /portal-users/:id
```

**Authorization**: `admin`, `hr`

---

### 11. Update Portal User
```
PUT /portal-users/:id
```

**Authorization**: `admin`, `hr`

**Request Body**:
```json
{
  "full_name": "John Updated",
  "phone": "+91-9876543210",
  "designation": "Senior Manager",
  "department": "Operations",
  "access_level": "ADMIN",
  "access_start_date": "2024-01-01",
  "access_end_date": "2024-12-31",
  "process_ids": ["process-1", "process-2", "process-3"]
}
```

**Response**:
```json
{
  "success": true,
  "message": "Portal user updated successfully"
}
```

---

### 12. Deactivate Portal User
```
POST /portal-users/:id/deactivate
```

**Authorization**: `admin`, `hr`

**Request Body**:
```json
{
  "reason": "Contract ended"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Portal user deactivated successfully"
}
```

---

### 13. Reactivate Portal User
```
POST /portal-users/:id/reactivate
```

**Authorization**: `admin`, `hr`

---

### 14. Get User Activity Log
```
GET /portal-users/:id/activity?limit=100&action_type=LOGIN
```

**Authorization**: `admin`, `hr`

**Query Parameters**:
- `limit` (number) - Max records (default: 100)
- `action_type` (string) - Filter by: LOGIN, LOGOUT, VIEW_REPORT, DOWNLOAD, API_CALL

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "user-uuid",
      "action_type": "LOGIN",
      "resource_type": "PORTAL",
      "resource_id": null,
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "request_method": "POST",
      "request_path": "/api/portal/login",
      "response_status": 200,
      "duration_ms": 150,
      "metadata": {},
      "created_at": "2024-01-20T10:30:00Z"
    }
  ]
}
```

---

### 15. Get Recent Logins
```
GET /portal-users/:id/logins?limit=20
```

**Authorization**: `admin`, `hr`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "login_time": "2024-01-20T10:30:00Z",
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0..."
    }
  ]
}
```

---

### 16. Log User Activity (Manual)
```
POST /portal-users/:id/log-activity
```

**Authorization**: `admin`

**Request Body**:
```json
{
  "action_type": "VIEW_REPORT",
  "resource_type": "REPORT",
  "resource_id": "report-001",
  "metadata": {
    "report_name": "Monthly Summary",
    "filters": { "month": "January" }
  }
}
```

---

## Permission Management

### 17. Get User Permissions
```
GET /portal-users/:id/permissions
```

**Authorization**: `admin`, `hr`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "user-uuid",
      "permission_type": "VIEW_REPORTS",
      "resource_scope": "PROCESS_SPECIFIC",
      "resource_ids": ["process-1", "process-2"],
      "granted_by": "admin-uuid",
      "granted_at": "2024-01-15T10:00:00Z",
      "expires_at": null,
      "active_status": true
    }
  ]
}
```

---

### 18. Grant Permission
```
POST /portal-users/:id/permissions
```

**Authorization**: `admin`

**Request Body**:
```json
{
  "permission_type": "VIEW_REPORTS",
  "resource_scope": "PROCESS_SPECIFIC",
  "resource_ids": ["process-1", "process-2"],
  "expires_at": "2024-12-31T23:59:59Z"
}
```

**Permission Types**:
- `VIEW_REPORTS`
- `DOWNLOAD_DATA`
- `VIEW_EMPLOYEES`
- `VIEW_ATTENDANCE`
- `VIEW_PAYROLL`
- `EXPORT_REPORTS`

**Resource Scopes**:
- `ALL` - Full access
- `PROCESS_SPECIFIC` - Limited to specific processes
- `BRANCH_SPECIFIC` - Limited to specific branches

---

### 19. Revoke Permission
```
DELETE /portal-users/:id/permissions/:permissionType
```

**Authorization**: `admin`

**Example**:
```bash
curl -X DELETE http://localhost:3001/api/portal-users/<user-id>/permissions/VIEW_REPORTS \
  -H "Authorization: Bearer <token>"
```

---

## Analytics

### 20. Get User Activity Summary
```
GET /analytics/user-activity?client_id=<id>&days=30
```

**Authorization**: `admin`, `hr`

**Query Parameters**:
- `client_id` (string) - Filter by client (optional)
- `days` (number) - Analysis period (default: 30)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "user_id": "uuid",
      "email": "user@client.com",
      "full_name": "John Doe",
      "total_actions": 250,
      "logins": 30,
      "api_calls": 100,
      "report_views": 80,
      "downloads": 40,
      "last_activity": "2024-01-20T15:30:00Z",
      "avg_session_duration_minutes": 45
    }
  ]
}
```

---

## Bulk Operations

### 21. List Bulk Jobs
```
GET /bulk/jobs?limit=50
```

**Authorization**: `admin`, `hr`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "job_type": "IMPORT_USERS",
      "entity_type": "PORTAL_USERS",
      "status": "COMPLETED",
      "total_records": 100,
      "processed_records": 100,
      "success_count": 95,
      "error_count": 5,
      "error_log": [...],
      "created_by": "admin-uuid",
      "created_at": "2024-01-20T10:00:00Z",
      "completed_at": "2024-01-20T10:05:00Z"
    }
  ]
}
```

---

### 22. Create Bulk Job
```
POST /bulk/jobs
```

**Authorization**: `admin`, `hr`

**Request Body**:
```json
{
  "job_type": "IMPORT_USERS",
  "entity_type": "PORTAL_USERS",
  "total_records": 100,
  "file_url": "/uploads/bulk/users.csv"
}
```

**Job Types**:
- `IMPORT_USERS`
- `IMPORT_PROCESSES`
- `BULK_DEACTIVATE`
- `BULK_ASSIGN`

---

### 23. Update Job Progress
```
PATCH /bulk/jobs/:id/progress
```

**Authorization**: `admin`, `hr`

**Request Body**:
```json
{
  "processed": 50,
  "success": 45,
  "errors": 5,
  "error_log": [
    { "row": 10, "error": "Invalid email format" },
    { "row": 23, "error": "Duplicate client_code" }
  ]
}
```

---

## Error Responses

**400 Bad Request**:
```json
{
  "success": false,
  "message": "client_code and client_name are required"
}
```

**401 Unauthorized**:
```json
{
  "success": false,
  "message": "Authentication required"
}
```

**403 Forbidden**:
```json
{
  "success": false,
  "message": "Insufficient permissions"
}
```

**404 Not Found**:
```json
{
  "success": false,
  "message": "Client not found"
}
```

**500 Internal Server Error**:
```json
{
  "success": false,
  "message": "An error occurred while processing your request"
}
```

---

## Testing with cURL

**1. List Clients**:
```bash
curl -X GET http://localhost:3001/api/clients \
  -H "Authorization: Bearer <token>"
```

**2. Create Client**:
```bash
curl -X POST http://localhost:3001/api/clients \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "client_code": "TEST_001",
    "client_name": "Test Corporation",
    "primary_contact_email": "test@corp.com",
    "billing_cycle": "MONTHLY"
  }'
```

**3. Update Portal User**:
```bash
curl -X PUT http://localhost:3001/api/portal-users/<user-id> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Updated Name",
    "access_level": "FULL_ACCESS"
  }'
```

**4. Grant Permission**:
```bash
curl -X POST http://localhost:3001/api/portal-users/<user-id>/permissions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "permission_type": "VIEW_REPORTS",
    "resource_scope": "ALL"
  }'
```

---

## Rate Limiting

- Standard endpoints: 100 requests/minute
- Bulk operations: 10 requests/minute
- Analytics endpoints: 30 requests/minute

---

## Pagination (Future)

Currently all list endpoints return full results. Pagination will be added in future:
```
GET /clients?page=1&limit=50
```

---

## Webhooks (Future)

Clients can configure webhook URLs to receive real-time notifications:
- User login/logout
- Permission changes
- Activity thresholds exceeded
