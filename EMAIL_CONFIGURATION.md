# Email Configuration Guide

**Project**: MAS Callnet HRMS  
**Email Provider**: Gmail SMTP  
**Date**: 2026-06-05  

---

## 📧 Email Configuration

### Current Setup

**Email Account**: `shivam.giri@teammas.in`  
**App Password**: `mdyf bqih vdth cqbn` (with spaces) or `mdyfbqihvdthcqbn` (no spaces)  
**SMTP Server**: `smtp.gmail.com`  
**Port**: `587` (STARTTLS)  
**Encryption**: STARTTLS (not SSL)  

---

## 🔧 Environment Variables

### For `.env` or `.env.production`

```env
# Email Configuration (Gmail SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=shivam.giri@teammas.in
EMAIL_PASSWORD=mdyfbqihvdthcqbn
EMAIL_FROM_NAME=MAS Callnet HRMS
EMAIL_FROM_ADDRESS=shivam.giri@teammas.in

# Additional Settings
EMAIL_TLS_REJECT_UNAUTHORIZED=false
EMAIL_DEBUG=false
```

### Important Notes

1. **EMAIL_SECURE=false**: Use `false` for port 587 (STARTTLS)
2. **App Password**: Remove spaces when adding to .env
3. **No Spaces**: `mdyfbqihvdthcqbn` not `mdyf bqih vdth cqbn`

---

## 📝 Backend Implementation

### Nodemailer Configuration

```javascript
// backend/src/config/email.ts or backend/src/services/email.service.ts
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransporter({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === 'true', // false for 587, true for 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  tls: {
    rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED !== 'false'
  }
});

// Verify configuration
export const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email configuration verified');
    return true;
  } catch (error) {
    console.error('❌ Email configuration error:', error);
    return false;
  }
};

// Send email function
export const sendEmail = async (options: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}) => {
  const mailOptions = {
    from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  return await transporter.sendMail(mailOptions);
};

export default transporter;
```

---

## 🎯 Email Use Cases in HRMS

### 1. ATS - Candidate Notifications

```javascript
// Offer Letter Email
await sendEmail({
  to: candidate.email,
  subject: `Offer Letter - ${candidate.full_name}`,
  html: `
    <h2>Congratulations ${candidate.full_name}!</h2>
    <p>You have been selected for the position at ${branch_name}.</p>
    <p>Please find your offer letter attached.</p>
  `
});

// Rejection Email
await sendEmail({
  to: candidate.email,
  subject: `Application Status - ${candidate.full_name}`,
  html: `
    <p>Dear ${candidate.full_name},</p>
    <p>Thank you for your interest in our position.</p>
    <p>Unfortunately, we are unable to proceed with your application at this time.</p>
  `
});

// Onboarding Token Email
await sendEmail({
  to: candidate.email,
  subject: `Complete Your Onboarding - ${candidate.full_name}`,
  html: `
    <h2>Welcome to MAS Callnet!</h2>
    <p>Click the link below to complete your onboarding:</p>
    <a href="${FRONTEND_URL}/onboard?token=${token}">Complete Onboarding</a>
    <p>This link expires in 7 days.</p>
  `
});
```

### 2. Leave Management

```javascript
// Leave Request Submitted
await sendEmail({
  to: employee.email,
  subject: `Leave Request Submitted`,
  html: `
    <p>Dear ${employee.full_name},</p>
    <p>Your leave request has been submitted successfully.</p>
    <p>Dates: ${from_date} to ${to_date}</p>
    <p>Status: Pending approval</p>
  `
});

// Leave Approved/Rejected
await sendEmail({
  to: employee.email,
  subject: `Leave Request ${status}`,
  html: `
    <p>Dear ${employee.full_name},</p>
    <p>Your leave request has been ${status}.</p>
    <p>Dates: ${from_date} to ${to_date}</p>
  `
});
```

### 3. Attendance

```javascript
// Regularization Approved
await sendEmail({
  to: employee.email,
  subject: `Attendance Regularization Approved`,
  html: `
    <p>Dear ${employee.full_name},</p>
    <p>Your attendance regularization request has been approved.</p>
    <p>Date: ${attendance_date}</p>
  `
});
```

### 4. System Notifications

```javascript
// Password Reset
await sendEmail({
  to: user.email,
  subject: `Password Reset Request`,
  html: `
    <h2>Password Reset</h2>
    <p>Click the link below to reset your password:</p>
    <a href="${FRONTEND_URL}/reset-password?token=${resetToken}">Reset Password</a>
    <p>This link expires in 1 hour.</p>
  `
});

// New User Registration
await sendEmail({
  to: user.email,
  subject: `Welcome to MAS Callnet HRMS`,
  html: `
    <h2>Welcome!</h2>
    <p>Your account has been created.</p>
    <p>Username: ${user.email}</p>
    <p>Click below to set your password:</p>
    <a href="${FRONTEND_URL}/set-password?token=${setPasswordToken}">Set Password</a>
  `
});
```

---

## 🧪 Testing Email Configuration

### Test Script

Create `backend/scripts/test-email.ts`:

```typescript
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

async function testEmail() {
  console.log('Testing email configuration...');
  console.log('EMAIL_HOST:', process.env.EMAIL_HOST);
  console.log('EMAIL_PORT:', process.env.EMAIL_PORT);
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  console.log('EMAIL_FROM:', process.env.EMAIL_FROM_ADDRESS);

  const transporter = nodemailer.createTransporter({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  try {
    // Verify connection
    console.log('\n1. Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified');

    // Send test email
    console.log('\n2. Sending test email...');
    const info = await transporter.sendMail({
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`,
      to: process.env.EMAIL_USER, // Send to self for testing
      subject: 'Test Email - MAS Callnet HRMS',
      text: 'This is a test email from MAS Callnet HRMS.',
      html: `
        <h2>Test Email</h2>
        <p>This is a test email from <strong>MAS Callnet HRMS</strong>.</p>
        <p>If you received this, email configuration is working correctly!</p>
        <hr>
        <p><small>Sent at: ${new Date().toISOString()}</small></p>
      `,
    });

    console.log('✅ Test email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
  } catch (error) {
    console.error('❌ Email test failed:', error);
    process.exit(1);
  }
}

testEmail();
```

### Run Test

```bash
cd backend
npm install
npx tsx scripts/test-email.ts
```

### Expected Output

```
Testing email configuration...
EMAIL_HOST: smtp.gmail.com
EMAIL_PORT: 587
EMAIL_USER: shivam.giri@teammas.in
EMAIL_FROM: shivam.giri@teammas.in

1. Verifying SMTP connection...
✅ SMTP connection verified

2. Sending test email...
✅ Test email sent successfully!
Message ID: <unique-id@gmail.com>
Response: 250 2.0.0 OK
```

---

## 🔒 Security Best Practices

### 1. App Password Generation

**Steps to create Gmail App Password**:
1. Go to Google Account: https://myaccount.google.com
2. Security → 2-Step Verification (must be enabled)
3. App passwords → Generate
4. Select "Mail" and "Other (Custom name)"
5. Copy the 16-character password
6. Use in EMAIL_PASSWORD without spaces

### 2. Environment Security

```bash
# NEVER commit .env files
echo "backend/.env*" >> .gitignore
echo "backend/.env.local" >> .gitignore
echo "backend/.env.production" >> .gitignore

# Restrict file permissions
chmod 600 backend/.env
chmod 600 backend/.env.production
```

### 3. Rate Limiting

```javascript
// Implement email rate limiting
const emailRateLimiter = {
  '1min': 10,   // Max 10 emails per minute
  '1hour': 100, // Max 100 emails per hour
  '1day': 500,  // Max 500 emails per day
};
```

---

## 🚨 Troubleshooting

### Common Issues

#### Issue 1: "Invalid login"
**Solution**: 
- Verify app password is correct
- Check if 2-Step Verification is enabled
- Generate new app password

#### Issue 2: "Connection timeout"
**Solution**:
- Check firewall allows port 587
- Verify SMTP server address
- Try port 465 with `EMAIL_SECURE=true`

#### Issue 3: "Self signed certificate"
**Solution**:
```env
EMAIL_TLS_REJECT_UNAUTHORIZED=false
```

#### Issue 4: "Authentication failed"
**Solution**:
- Remove spaces from app password
- Use app password, not regular password
- Verify EMAIL_USER is correct

### Debug Mode

Enable debug logging:

```env
EMAIL_DEBUG=true
```

```javascript
const transporter = nodemailer.createTransporter({
  // ... other config
  debug: process.env.EMAIL_DEBUG === 'true',
  logger: true,
});
```

---

## 📊 Email Templates

### Template Structure

```
backend/
└── src/
    └── templates/
        └── emails/
            ├── offer-letter.html
            ├── rejection.html
            ├── onboarding-token.html
            ├── leave-approved.html
            ├── leave-rejected.html
            └── password-reset.html
```

### Using Handlebars Templates

```javascript
import handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';

const getEmailTemplate = (templateName: string, data: Record<string, any>) => {
  const templatePath = path.join(
    __dirname,
    '../templates/emails',
    `${templateName}.html`
  );
  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  const template = handlebars.compile(templateContent);
  return template(data);
};

// Usage
const html = getEmailTemplate('offer-letter', {
  candidateName: candidate.full_name,
  branchName: branch.branch_name,
  joiningDate: formatDate(bridge.joining_date),
});

await sendEmail({
  to: candidate.email,
  subject: 'Offer Letter',
  html,
});
```

---

## 🎯 Email Logging

### Log All Emails

```javascript
// Store email logs in database
await db.execute(
  `INSERT INTO email_log
   (id, recipient, subject, status, message_id, sent_at, error_message)
   VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
  [
    randomUUID(),
    options.to,
    options.subject,
    'sent', // or 'failed'
    info.messageId,
    error?.message || null,
  ]
);
```

### Create Email Log Table

```sql
CREATE TABLE email_log (
  id CHAR(36) PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  status ENUM('sent', 'failed', 'pending') NOT NULL,
  message_id VARCHAR(255) NULL,
  sent_at DATETIME NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_recipient (recipient),
  INDEX idx_sent_at (sent_at),
  INDEX idx_status (status)
);
```

---

## ✅ Deployment Checklist

Before deploying to production:

- [ ] App password generated and configured
- [ ] Environment variables set in production
- [ ] Email test script passes
- [ ] Rate limiting configured
- [ ] Email templates created
- [ ] Email logging implemented
- [ ] Firewall allows port 587
- [ ] FROM address matches authenticated user
- [ ] Email notifications enabled in feature flags

---

## 📞 Support

**Email Issues**: Contact Google Workspace admin or generate new app password  
**SMTP Issues**: Check firewall and network settings  
**Template Issues**: Verify template paths and Handlebars syntax  

---

**Last Updated**: 2026-06-05  
**Status**: ✅ Configured and Ready  
**Email**: shivam.giri@teammas.in
