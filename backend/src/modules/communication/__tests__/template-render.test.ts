import { describe, it, expect } from 'vitest';
import Handlebars from 'handlebars';

describe('Template Rendering (Unit Tests)', () => {
  // Register same helpers as template.service.ts
  Handlebars.registerHelper('formatDate', (date: string) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-IN');
  });

  Handlebars.registerHelper('currency', (amount: number) => {
    return `₹${Number(amount ?? 0).toLocaleString('en-IN')}`;
  });

  describe('Variable Substitution', () => {
    it('should substitute simple variables', () => {
      const template = Handlebars.compile('Hello {{employee.name}}!');
      const result = template({ employee: { name: 'John Doe' } });

      expect(result).toBe('Hello John Doe!');
    });

    it('should substitute nested variables', () => {
      const template = Handlebars.compile('{{employee.name}} works in {{employee.department.name}}');
      const result = template({
        employee: {
          name: 'Jane Smith',
          department: { name: 'HR' },
        },
      });

      expect(result).toBe('Jane Smith works in HR');
    });

    it('should handle missing variables gracefully', () => {
      const template = Handlebars.compile('Hello {{employee.name}}!');
      const result = template({});

      expect(result).toBe('Hello !'); // Empty string for missing
    });
  });

  describe('Onboarding Template', () => {
    it('should render welcome email', () => {
      const template = Handlebars.compile(`
        <h1>Welcome {{employee.name}}!</h1>
        <p>You have been assigned employee code: {{employee.code}}</p>
        <p>Branch: {{employee.branch}}</p>
        <p>Department: {{employee.department}}</p>
        <p>Joining Date: {{formatDate employee.joiningDate}}</p>
      `);

      const result = template({
        employee: {
          name: 'Amit Kumar',
          code: 'MAS00123',
          branch: 'Mumbai',
          department: 'Sales',
          joiningDate: '2026-06-01',
        },
      });

      expect(result).toContain('Welcome Amit Kumar!');
      expect(result).toContain('MAS00123');
      expect(result).toContain('Mumbai');
      expect(result).toContain('Sales');
      expect(result).toContain('1/6/2026'); // Formatted date
    });

    it('should render document checklist', () => {
      const template = Handlebars.compile(`
        <p>Dear {{employee.name}},</p>
        <p>Please submit the following documents:</p>
        <ul>
        {{#each documents}}
          <li>{{this}}</li>
        {{/each}}
        </ul>
      `);

      const result = template({
        employee: { name: 'Priya Sharma' },
        documents: ['Aadhar Card', 'PAN Card', 'Bank Passbook', 'Education Certificates'],
      });

      expect(result).toContain('Dear Priya Sharma');
      expect(result).toContain('<li>Aadhar Card</li>');
      expect(result).toContain('<li>PAN Card</li>');
      expect(result).toContain('<li>Bank Passbook</li>');
    });
  });

  describe('Payroll Template', () => {
    it('should render payslip notification', () => {
      const template = Handlebars.compile(`
        <h2>Payslip for {{month}} {{year}}</h2>
        <p>Dear {{employee.name}},</p>
        <p>Your salary for {{month}} has been processed.</p>
        <p><strong>Gross Salary:</strong> {{currency gross}}</p>
        <p><strong>Deductions:</strong> {{currency deductions}}</p>
        <p><strong>Net Salary:</strong> {{currency net}}</p>
        <p>Payment Date: {{formatDate paymentDate}}</p>
      `);

      const result = template({
        employee: { name: 'Rajesh Verma' },
        month: 'May',
        year: '2026',
        gross: 50000,
        deductions: 5000,
        net: 45000,
        paymentDate: '2026-06-05',
      });

      expect(result).toContain('Payslip for May 2026');
      expect(result).toContain('Dear Rajesh Verma');
      expect(result).toContain('₹50,000'); // Formatted currency
      expect(result).toContain('₹5,000');
      expect(result).toContain('₹45,000');
      expect(result).toContain('5/6/2026');
    });

    it('should render salary increment notification', () => {
      const template = Handlebars.compile(`
        <p>Dear {{employee.name}},</p>
        <p>Congratulations! Your salary has been revised.</p>
        <p>Old Salary: {{currency oldSalary}}</p>
        <p>New Salary: {{currency newSalary}}</p>
        <p>Increment: {{currency increment}} ({{percentage}}%)</p>
        <p>Effective from: {{formatDate effectiveDate}}</p>
      `);

      const result = template({
        employee: { name: 'Sneha Patel' },
        oldSalary: 40000,
        newSalary: 45000,
        increment: 5000,
        percentage: 12.5,
        effectiveDate: '2026-07-01',
      });

      expect(result).toContain('Dear Sneha Patel');
      expect(result).toContain('₹40,000');
      expect(result).toContain('₹45,000');
      expect(result).toContain('₹5,000');
      expect(result).toContain('12.5%');
    });
  });

  describe('Attendance Template', () => {
    it('should render attendance alert', () => {
      const template = Handlebars.compile(`
        <p>Hi {{employee.name}},</p>
        <p>Your attendance for {{month}} is below threshold.</p>
        <p>Working Days: {{workingDays}}</p>
        <p>Present Days: {{presentDays}}</p>
        <p>Absent Days: {{absentDays}}</p>
        <p>Attendance %: {{attendancePercentage}}%</p>
        {{#if isLowAttendance}}
        <p style="color: red;"><strong>Warning:</strong> Low attendance may affect salary.</p>
        {{/if}}
      `);

      const result = template({
        employee: { name: 'Vikram Singh' },
        month: 'May 2026',
        workingDays: 26,
        presentDays: 18,
        absentDays: 8,
        attendancePercentage: 69.23,
        isLowAttendance: true,
      });

      expect(result).toContain('Hi Vikram Singh');
      expect(result).toContain('Working Days: 26');
      expect(result).toContain('Present Days: 18');
      expect(result).toContain('Absent Days: 8');
      expect(result).toContain('69.23%');
      expect(result).toContain('Warning:');
    });

    it('should render leave approval', () => {
      const template = Handlebars.compile(`
        <p>Dear {{employee.name}},</p>
        <p>Your {{leaveType}} leave request has been {{status}}.</p>
        <p>From: {{formatDate fromDate}}</p>
        <p>To: {{formatDate toDate}}</p>
        <p>Days: {{days}}</p>
        {{#if reason}}
        <p>Reason: {{reason}}</p>
        {{/if}}
        {{#if approverComments}}
        <p>Comments: {{approverComments}}</p>
        {{/if}}
      `);

      const result = template({
        employee: { name: 'Anjali Mehta' },
        leaveType: 'Casual Leave',
        status: 'approved',
        fromDate: '2026-06-10',
        toDate: '2026-06-12',
        days: 3,
        reason: 'Family function',
        approverComments: 'Approved. Enjoy!',
      });

      expect(result).toContain('Dear Anjali Mehta');
      expect(result).toContain('Casual Leave');
      expect(result).toContain('approved');
      expect(result).toContain('10/6/2026');
      expect(result).toContain('12/6/2026');
      expect(result).toContain('Days: 3');
      expect(result).toContain('Family function');
      expect(result).toContain('Approved. Enjoy!');
    });
  });

  describe('Performance Template', () => {
    it('should render performance review notification', () => {
      const template = Handlebars.compile(`
        <h2>Performance Review - {{period}}</h2>
        <p>Dear {{employee.name}},</p>
        <p>Your performance review is now available.</p>
        <p><strong>Overall Rating:</strong> {{rating}}/5</p>
        <p><strong>KPI Achievement:</strong> {{kpiAchievement}}%</p>
        <ul>
        {{#each strengths}}
          <li>✅ {{this}}</li>
        {{/each}}
        </ul>
        <p>Areas for Improvement:</p>
        <ul>
        {{#each improvements}}
          <li>📌 {{this}}</li>
        {{/each}}
        </ul>
      `);

      const result = template({
        employee: { name: 'Suresh Kumar' },
        period: 'Q1 2026',
        rating: 4.2,
        kpiAchievement: 95,
        strengths: ['Excellent communication', 'Timely delivery', 'Team player'],
        improvements: ['Technical documentation', 'Code review participation'],
      });

      expect(result).toContain('Performance Review - Q1 2026');
      expect(result).toContain('Dear Suresh Kumar');
      expect(result).toContain('4.2/5');
      expect(result).toContain('95%');
      expect(result).toContain('Excellent communication');
      expect(result).toContain('Technical documentation');
    });
  });

  describe('Alert Template', () => {
    it('should render system alert', () => {
      const template = Handlebars.compile(`
        <div style="background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107;">
          <h3>⚠️ {{alertTitle}}</h3>
          <p>{{alertMessage}}</p>
          <p><strong>Priority:</strong> {{priority}}</p>
          <p><strong>Action Required:</strong> {{actionRequired}}</p>
          {{#if deadline}}
          <p><strong>Deadline:</strong> {{formatDate deadline}}</p>
          {{/if}}
        </div>
      `);

      const result = template({
        alertTitle: 'Document Expiry Alert',
        alertMessage: 'Your Aadhar card is expiring soon.',
        priority: 'High',
        actionRequired: 'Upload updated Aadhar card',
        deadline: '2026-06-30',
      });

      expect(result).toContain('⚠️ Document Expiry Alert');
      expect(result).toContain('Aadhar card is expiring soon');
      expect(result).toContain('<strong>Priority:</strong> High');
      expect(result).toContain('Upload updated Aadhar card');
      expect(result).toContain('30/6/2026');
    });
  });

  describe('Helper Functions', () => {
    it('should format date in Indian locale', () => {
      const template = Handlebars.compile('{{formatDate date}}');

      expect(template({ date: '2026-01-15' })).toBe('15/1/2026');
      expect(template({ date: '2026-12-31' })).toBe('31/12/2026');
      expect(template({ date: '' })).toBe('');
      expect(template({})).toBe('');
    });

    it('should format currency in Indian format', () => {
      const template = Handlebars.compile('{{currency amount}}');

      expect(template({ amount: 50000 })).toBe('₹50,000');
      expect(template({ amount: 1234567 })).toBe('₹12,34,567');
      expect(template({ amount: 0 })).toBe('₹0');
      expect(template({ amount: 999.99 })).toBe('₹999.99');
    });

    it('should handle null/undefined amounts', () => {
      const template = Handlebars.compile('{{currency amount}}');

      expect(template({ amount: null })).toBe('₹0');
      expect(template({ amount: undefined })).toBe('₹0');
      expect(template({})).toBe('₹0');
    });
  });

  describe('Multi-Channel Compatibility', () => {
    it('should render plain text version for SMS', () => {
      const template = Handlebars.compile(
        'Hi {{employee.name}}, your leave from {{formatDate fromDate}} to {{formatDate toDate}} is {{status}}.'
      );

      const result = template({
        employee: { name: 'Ravi' },
        fromDate: '2026-06-10',
        toDate: '2026-06-12',
        status: 'approved',
      });

      expect(result).toBe('Hi Ravi, your leave from 10/6/2026 to 12/6/2026 is approved.');
    });

    it('should render WhatsApp formatted message', () => {
      const template = Handlebars.compile(`
*Payslip Alert*

Hello {{employee.name}},

Your payslip for *{{month}}* is ready.

💰 Net Salary: {{currency net}}
📅 Payment Date: {{formatDate paymentDate}}

View details in HRMS portal.
      `);

      const result = template({
        employee: { name: 'Amit' },
        month: 'May 2026',
        net: 45000,
        paymentDate: '2026-06-05',
      });

      expect(result).toContain('*Payslip Alert*');
      expect(result).toContain('Hello Amit');
      expect(result).toContain('*May 2026*');
      expect(result).toContain('₹45,000');
      expect(result).toContain('5/6/2026');
    });
  });
});
