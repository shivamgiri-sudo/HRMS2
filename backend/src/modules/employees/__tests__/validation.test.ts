import { describe, it, expect } from 'vitest';

describe('Employee Data Validation', () => {
  describe('Aadhar Validation', () => {
    const validateAadhar = (aadhar: string): boolean => {
      // Remove spaces/dashes
      const cleaned = aadhar.replace(/[\s-]/g, '');

      // Must be 12 digits
      if (!/^\d{12}$/.test(cleaned)) return false;

      // Cannot be all zeros
      if (cleaned === '000000000000') return false;

      // Basic format validation only (Verhoeff algorithm complex, skip for tests)
      return true;
    };

    it('should accept valid 12-digit Aadhar', () => {
      expect(validateAadhar('234567890123')).toBe(true);
    });

    it('should accept Aadhar with spaces', () => {
      expect(validateAadhar('2345 6789 0123')).toBe(true);
    });

    it('should accept Aadhar with dashes', () => {
      expect(validateAadhar('2345-6789-0123')).toBe(true);
    });

    it('should reject less than 12 digits', () => {
      expect(validateAadhar('12345678901')).toBe(false);
    });

    it('should reject more than 12 digits', () => {
      expect(validateAadhar('1234567890123')).toBe(false);
    });

    it('should reject non-numeric characters', () => {
      expect(validateAadhar('12345678901A')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateAadhar('')).toBe(false);
    });

    it('should reject all zeros', () => {
      expect(validateAadhar('000000000000')).toBe(false);
    });
  });

  describe('PAN Validation', () => {
    const validatePAN = (pan: string): boolean => {
      // Format: ABCDE1234F
      // 5 letters + 4 digits + 1 letter (uppercase)
      const regex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
      return regex.test(pan.toUpperCase());
    };

    it('should accept valid PAN format', () => {
      expect(validatePAN('ABCDE1234F')).toBe(true);
    });

    it('should accept lowercase and convert', () => {
      expect(validatePAN('abcde1234f')).toBe(true);
    });

    it('should reject missing letters', () => {
      expect(validatePAN('ABC1234F')).toBe(false);
    });

    it('should reject missing digits', () => {
      expect(validatePAN('ABCDE123F')).toBe(false);
    });

    it('should reject letters in digit position', () => {
      expect(validatePAN('ABCDE12A4F')).toBe(false);
    });

    it('should reject digits in letter position', () => {
      expect(validatePAN('ABC1E1234F')).toBe(false);
    });

    it('should reject special characters', () => {
      expect(validatePAN('ABCDE-1234F')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validatePAN('')).toBe(false);
    });
  });

  describe('Email Validation', () => {
    const validateEmail = (email: string): boolean => {
      const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return regex.test(email);
    };

    it('should accept valid email', () => {
      expect(validateEmail('user@example.com')).toBe(true);
    });

    it('should accept email with subdomain', () => {
      expect(validateEmail('user@mail.example.com')).toBe(true);
    });

    it('should accept email with numbers', () => {
      expect(validateEmail('user123@example.com')).toBe(true);
    });

    it('should accept email with dots in local part', () => {
      expect(validateEmail('first.last@example.com')).toBe(true);
    });

    it('should reject email without @', () => {
      expect(validateEmail('userexample.com')).toBe(false);
    });

    it('should reject email without domain', () => {
      expect(validateEmail('user@')).toBe(false);
    });

    it('should reject email without TLD', () => {
      expect(validateEmail('user@example')).toBe(false);
    });

    it('should reject email with spaces', () => {
      expect(validateEmail('user @example.com')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateEmail('')).toBe(false);
    });
  });

  describe('Phone Validation (Indian)', () => {
    const validatePhone = (phone: string): boolean => {
      // Indian mobile: +91 XXXXXXXXXX or 10 digits starting with 6-9
      const cleaned = phone.replace(/[\s-()]/g, '');

      // With country code
      if (/^\+91[6-9]\d{9}$/.test(cleaned)) return true;

      // Without country code
      if (/^[6-9]\d{9}$/.test(cleaned)) return true;

      return false;
    };

    it('should accept 10-digit mobile number', () => {
      expect(validatePhone('9876543210')).toBe(true);
    });

    it('should accept number with +91', () => {
      expect(validatePhone('+919876543210')).toBe(true);
    });

    it('should accept number with spaces', () => {
      expect(validatePhone('98765 43210')).toBe(true);
    });

    it('should accept number with dashes', () => {
      expect(validatePhone('9876-543-210')).toBe(true);
    });

    it('should accept number with parentheses', () => {
      expect(validatePhone('+91 (987) 654-3210')).toBe(true);
    });

    it('should reject number starting with 5', () => {
      expect(validatePhone('5876543210')).toBe(false);
    });

    it('should reject 11-digit number', () => {
      expect(validatePhone('98765432101')).toBe(false);
    });

    it('should reject 9-digit number', () => {
      expect(validatePhone('987654321')).toBe(false);
    });

    it('should reject alphabets', () => {
      expect(validatePhone('987654321A')).toBe(false);
    });
  });

  describe('Date Range Validation', () => {
    const validateDateRange = (fromDate: string, toDate: string): { valid: boolean; error?: string } => {
      const from = new Date(fromDate);
      const to = new Date(toDate);

      if (isNaN(from.getTime())) {
        return { valid: false, error: 'Invalid from date' };
      }

      if (isNaN(to.getTime())) {
        return { valid: false, error: 'Invalid to date' };
      }

      if (to < from) {
        return { valid: false, error: 'To date must be after from date' };
      }

      return { valid: true };
    };

    it('should accept valid date range', () => {
      const result = validateDateRange('2026-06-01', '2026-06-10');
      expect(result.valid).toBe(true);
    });

    it('should accept same day range', () => {
      const result = validateDateRange('2026-06-01', '2026-06-01');
      expect(result.valid).toBe(true);
    });

    it('should reject inverted range', () => {
      const result = validateDateRange('2026-06-10', '2026-06-01');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('after');
    });

    it('should reject invalid from date', () => {
      const result = validateDateRange('invalid', '2026-06-10');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid from date');
    });

    it('should reject invalid to date', () => {
      const result = validateDateRange('2026-06-01', 'invalid');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid to date');
    });
  });

  describe('Employee Code Format', () => {
    const validateEmployeeCode = (code: string): boolean => {
      // Format: MAS00001 (3 letters + 5 digits)
      return /^[A-Z]{3}\d{5}$/.test(code);
    };

    it('should accept valid format', () => {
      expect(validateEmployeeCode('MAS00001')).toBe(true);
    });

    it('should accept different prefix', () => {
      expect(validateEmployeeCode('ABC12345')).toBe(true);
    });

    it('should reject lowercase', () => {
      expect(validateEmployeeCode('mas00001')).toBe(false);
    });

    it('should reject wrong digit count', () => {
      expect(validateEmployeeCode('MAS0001')).toBe(false);
      expect(validateEmployeeCode('MAS000001')).toBe(false);
    });

    it('should reject wrong letter count', () => {
      expect(validateEmployeeCode('MA00001')).toBe(false);
      expect(validateEmployeeCode('MASS00001')).toBe(false);
    });

    it('should reject special characters', () => {
      expect(validateEmployeeCode('MAS-00001')).toBe(false);
    });
  });

  describe('Salary Range Validation', () => {
    const validateSalaryRange = (
      amount: number,
      min: number = 0,
      max: number = 10000000
    ): { valid: boolean; error?: string } => {
      if (isNaN(amount)) {
        return { valid: false, error: 'Invalid amount' };
      }

      if (amount < 0) {
        return { valid: false, error: 'Amount cannot be negative' };
      }

      if (amount < min) {
        return { valid: false, error: `Amount must be at least ₹${min}` };
      }

      if (amount > max) {
        return { valid: false, error: `Amount cannot exceed ₹${max}` };
      }

      return { valid: true };
    };

    it('should accept valid salary', () => {
      const result = validateSalaryRange(50000);
      expect(result.valid).toBe(true);
    });

    it('should accept zero salary', () => {
      const result = validateSalaryRange(0);
      expect(result.valid).toBe(true);
    });

    it('should reject negative salary', () => {
      const result = validateSalaryRange(-1000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('negative');
    });

    it('should reject salary below minimum', () => {
      const result = validateSalaryRange(5000, 10000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least');
    });

    it('should reject salary above maximum', () => {
      const result = validateSalaryRange(15000000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed');
    });

    it('should accept salary at boundaries', () => {
      expect(validateSalaryRange(0, 0, 100000).valid).toBe(true);
      expect(validateSalaryRange(100000, 0, 100000).valid).toBe(true);
    });
  });
});
