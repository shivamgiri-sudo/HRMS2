# HRMS Email Invite and Forgot Password Setup

This guide explains how to enable existing employees to reset their HRMS password and login using Employee Code or official email.

## 1. Add backend environment variables

Add these variables in the backend runtime environment. Do not commit actual app passwords to GitHub.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=shivam.giri@teammas.in
SMTP_PASS=<google-app-password-with-or-without-spaces>
SMTP_FROM=shivam.giri@teammas.in
SMTP_FROM_NAME=MAS Callnet HRMS
FRONTEND_URL=https://your-frontend-url
```

For local development, add them in:

```text
backend/.env
```

For production, add them in the hosting provider environment variable screen and restart/redeploy the backend.

## 2. Validate SMTP config

Use an admin token and call:

```http
GET /api/auth/launch/email-config
```

Expected result:

```json
{
  "success": true,
  "data": {
    "configured": true,
    "host": "smtp.gmail.com",
    "port": 587,
    "userConfigured": true,
    "passConfigured": true
  }
}
```

## 3. Send test email

```http
POST /api/auth/launch/email-config/test
Content-Type: application/json

{
  "to": "shivam.giri@teammas.in"
}
```

Expected result: test email received.

## 4. Existing employee forgot-password flow

After SMTP is configured, an existing employee can:

1. Open the HRMS login page.
2. Click `Forgot password?`.
3. Enter official email ID.
4. Receive reset link.
5. Open `/reset-password?token=...` from email.
6. Set new password.
7. Login using official email or Employee Code.

API used:

```http
POST /api/auth/forgot-password
{
  "email": "employee@teammas.in"
}
```

Then:

```http
POST /api/auth/reset-password
{
  "token": "email-token",
  "password": "new-password"
}
```

## 5. Existing employee launch invite flow

Before mass rollout:

```http
GET /api/auth/launch/launch-readiness
```

Dry run:

```http
POST /api/auth/launch/bootstrap-existing-users
{
  "dryRun": true
}
```

Actual bootstrap:

```http
POST /api/auth/launch/bootstrap-existing-users
{
  "dryRun": false
}
```

Send invites:

```http
POST /api/auth/launch/send-invites
{
  "limit": 100
}
```

## 6. Security note

If an app password was shared in chat or copied to any visible place, rotate it after successful testing and update the backend runtime environment only.
