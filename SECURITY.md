# Security Policy

## Supported Versions

We actively support the following versions of CoreHR Hub with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

**DO NOT** create a public GitHub issue for security vulnerabilities.

Instead, please report security vulnerabilities by emailing:

📧 **security@corehr-hub.example.com**

Please include the following information in your report:

1. **Description**: A clear description of the vulnerability
2. **Impact**: What an attacker could potentially achieve
3. **Steps to Reproduce**: Detailed steps to reproduce the issue
4. **Affected Components**: Which parts of the application are affected
5. **Suggested Fix**: If you have ideas on how to fix the issue (optional)
6. **Your Contact Information**: So we can follow up with questions

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Initial Assessment**: We will provide an initial assessment within 7 days
- **Regular Updates**: We will keep you informed of our progress
- **Resolution Timeline**: We aim to resolve critical vulnerabilities within 30 days
- **Credit**: We will credit you in our security acknowledgments (unless you prefer to remain anonymous)

### Scope

The following are in scope for security reports:

- CoreHR Hub application code
- Supabase Edge Functions
- Authentication and authorization mechanisms
- Data exposure vulnerabilities
- SQL injection vulnerabilities
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Insecure direct object references (IDOR)
- Row Level Security (RLS) bypass

The following are **out of scope**:

- Vulnerabilities in third-party dependencies (report these to the maintainers)
- Social engineering attacks
- Denial of service attacks
- Issues in the Supabase platform itself (report to Supabase)
- Issues requiring physical access to a user's device

## Security Best Practices

### For Self-Hosted Deployments

1. **Environment Variables**
   - Never commit secrets to version control
   - Use strong, unique values for `JWT_SECRET` and database passwords
   - Rotate secrets regularly
   - Use a secrets manager in production

2. **Database Security**
   - Enable Row Level Security (RLS) on all tables containing user data
   - Review and audit RLS policies regularly
   - Use the principle of least privilege for database roles
   - Enable SSL for database connections

3. **Authentication**
   - Enforce strong password policies
   - Consider enabling multi-factor authentication
   - Set appropriate session timeouts
   - Monitor for unusual authentication patterns

4. **Network Security**
   - Use HTTPS in production
   - Configure proper CORS policies
   - Use a Web Application Firewall (WAF) if possible
   - Keep all services behind a reverse proxy

5. **Monitoring**
   - Enable logging for authentication events
   - Monitor for suspicious activity
   - Set up alerts for failed login attempts
   - Regularly review access logs

### For Developers Contributing Code

1. **Input Validation**
   - Validate all user inputs on both client and server
   - Use schema validation (e.g., Zod) for TypeScript
   - Sanitize data before database operations
   - Encode output to prevent XSS

2. **Authentication & Authorization**
   - Never store roles in the profiles table (use `user_roles` table)
   - Never trust client-side role checks for authorization
   - Always verify permissions server-side
   - Use Supabase's `auth.uid()` for user identification

3. **Database Queries**
   - Use parameterized queries (Supabase client handles this)
   - Implement proper RLS policies for new tables
   - Avoid exposing internal IDs where possible
   - Limit query results with pagination

4. **Sensitive Data**
   - Never log sensitive information
   - Use secure methods for handling passwords
   - Encrypt sensitive data at rest
   - Be careful with error messages (don't leak information)

5. **Dependencies**
   - Keep dependencies updated
   - Review security advisories regularly
   - Use `npm audit` to check for vulnerabilities
   - Pin dependency versions in production

## Security Features

CoreHR Hub includes the following security features:

### Row Level Security (RLS)

All database tables are protected with RLS policies that ensure:
- Users can only access their own data
- Managers can access their team's data
- HR and Admin roles have appropriate elevated access
- Public data is explicitly marked as such

### Role-Based Access Control

- Roles are stored in a separate `user_roles` table
- Role checking is done via `SECURITY DEFINER` functions
- No client-side role storage or verification
- Four role levels: `admin`, `hr`, `manager`, `employee`

### Authentication

- Powered by Supabase Auth (GoTrue)
- Secure session management with JWT tokens
- Password hashing with bcrypt
- Configurable password policies

### API Security

- All API calls authenticated via JWT
- CORS configured for specific origins
- Rate limiting on authentication endpoints
- Request validation on Edge Functions

## Security Acknowledgments

We would like to thank the following individuals for responsibly disclosing security vulnerabilities:

*No acknowledgments yet. Be the first to report a vulnerability!*

## Contact

For security-related inquiries that are not vulnerability reports, you can reach us at:

- Email: security@corehr-hub.example.com
- GitHub Discussions: [Security Category](https://github.com/your-org/corehr-hub/discussions/categories/security)

---

*This security policy is based on industry best practices and will be updated as needed.*
