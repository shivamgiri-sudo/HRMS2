import { describe, it, expect } from 'vitest';

describe('Leave Balance Calculations', () => {
  describe('Annual Leave Accrual', () => {
    const calculateAnnualAccrual = (maxDays: number, joiningDate: string, referenceDate: string): number => {
      const joining = new Date(joiningDate);
      const reference = new Date(referenceDate);

      // Calculate months of service in current year
      const yearStart = new Date(reference.getFullYear(), 0, 1);
      const effectiveStart = joining > yearStart ? joining : yearStart;

      const monthsInYear = 12;
      const monthsServed = Math.floor(
        (reference.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      );

      const monthsToConsider = Math.min(monthsServed + 1, monthsInYear);
      const accrued = (maxDays / monthsInYear) * monthsToConsider;

      return Math.round(accrued * 100) / 100; // 2 decimal places
    };

    it('should accrue full annual leaves for full year', () => {
      const result = calculateAnnualAccrual(24, '2025-01-01', '2026-12-31');
      expect(result).toBeCloseTo(24, 1);
    });

    it('should prorate for mid-year joining', () => {
      const result = calculateAnnualAccrual(24, '2026-07-01', '2026-12-31');
      // July to December = 6 months = 24 * (6/12) = 12
      expect(result).toBeGreaterThanOrEqual(10);
      expect(result).toBeLessThanOrEqual(14);
    });

    it('should calculate partial accrual at current date', () => {
      const result = calculateAnnualAccrual(24, '2026-01-01', '2026-06-01');
      // Jan to June = 5-6 months = ~10-12
      expect(result).toBeGreaterThanOrEqual(9);
      expect(result).toBeLessThanOrEqual(13);
    });

    it('should handle joining in same year', () => {
      const result = calculateAnnualAccrual(18, '2026-03-15', '2026-09-15');
      // Mar to Sep = ~6 months
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(18);
    });

    it('should return 0 for joining after reference date', () => {
      const result = calculateAnnualAccrual(24, '2027-01-01', '2026-12-31');
      expect(result).toBe(0);
    });
  });

  describe('Monthly Accrual', () => {
    const calculateMonthlyAccrual = (maxDays: number): number => {
      return Math.round((maxDays / 12) * 100) / 100;
    };

    it('should calculate monthly accrual', () => {
      expect(calculateMonthlyAccrual(24)).toBeCloseTo(2.0, 2);
      expect(calculateMonthlyAccrual(18)).toBeCloseTo(1.5, 2);
      expect(calculateMonthlyAccrual(12)).toBeCloseTo(1.0, 2);
    });

    it('should handle odd numbers', () => {
      expect(calculateMonthlyAccrual(15)).toBeCloseTo(1.25, 2);
      expect(calculateMonthlyAccrual(21)).toBeCloseTo(1.75, 2);
    });

    it('should return 0 for zero max days', () => {
      expect(calculateMonthlyAccrual(0)).toBe(0);
    });
  });

  describe('Leave Balance Calculation', () => {
    interface LeaveBalance {
      opening: number;
      accrued: number;
      taken: number;
      lapsed: number;
      closing: number;
    }

    const calculateBalance = (
      opening: number,
      accrued: number,
      taken: number,
      maxCarryForward: number = 0
    ): LeaveBalance => {
      const available = opening + accrued;
      const balance = available - taken;

      let lapsed = 0;
      let closing = balance;

      if (maxCarryForward > 0 && closing > maxCarryForward) {
        lapsed = closing - maxCarryForward;
        closing = maxCarryForward;
      }

      return {
        opening,
        accrued,
        taken,
        lapsed,
        closing,
      };
    };

    it('should calculate simple balance', () => {
      const result = calculateBalance(5, 12, 8, 0);

      expect(result.opening).toBe(5);
      expect(result.accrued).toBe(12);
      expect(result.taken).toBe(8);
      expect(result.closing).toBe(9); // 5+12-8
      expect(result.lapsed).toBe(0);
    });

    it('should apply carry forward limit', () => {
      const result = calculateBalance(10, 12, 5, 10);

      expect(result.closing).toBe(10); // Capped at carry forward limit
      expect(result.lapsed).toBe(7); // 17-10 lapsed
    });

    it('should handle zero carry forward', () => {
      const result = calculateBalance(5, 12, 10, 0);

      expect(result.closing).toBe(7);
      expect(result.lapsed).toBe(0); // No limit, so no lapse
    });

    it('should handle full utilization', () => {
      const result = calculateBalance(5, 12, 17, 10);

      expect(result.closing).toBe(0);
      expect(result.lapsed).toBe(0);
    });

    it('should handle over-utilization (negative balance)', () => {
      const result = calculateBalance(5, 10, 20, 10);

      expect(result.closing).toBe(-5);
      expect(result.lapsed).toBe(0);
    });
  });

  describe('Carry Forward Calculation', () => {
    const calculateCarryForward = (
      currentBalance: number,
      maxCarryForward: number | null,
      carryForwardPercentage: number | null
    ): { carried: number; lapsed: number } => {
      if (maxCarryForward === null && carryForwardPercentage === null) {
        // No carry forward allowed
        return { carried: 0, lapsed: currentBalance };
      }

      let allowedCarryForward = currentBalance;

      if (carryForwardPercentage !== null) {
        allowedCarryForward = Math.floor(currentBalance * (carryForwardPercentage / 100));
      }

      if (maxCarryForward !== null) {
        allowedCarryForward = Math.min(allowedCarryForward, maxCarryForward);
      }

      const carried = Math.min(currentBalance, allowedCarryForward);
      const lapsed = currentBalance - carried;

      return { carried, lapsed };
    };

    it('should carry forward with max limit', () => {
      const result = calculateCarryForward(15, 10, null);

      expect(result.carried).toBe(10);
      expect(result.lapsed).toBe(5);
    });

    it('should carry forward with percentage', () => {
      const result = calculateCarryForward(20, null, 50);

      expect(result.carried).toBe(10); // 50% of 20
      expect(result.lapsed).toBe(10);
    });

    it('should apply both max and percentage (stricter wins)', () => {
      const result = calculateCarryForward(30, 12, 50);

      expect(result.carried).toBe(12); // min(15, 12) = 12
      expect(result.lapsed).toBe(18);
    });

    it('should lapse all if no carry forward allowed', () => {
      const result = calculateCarryForward(15, null, null);

      expect(result.carried).toBe(0);
      expect(result.lapsed).toBe(15);
    });

    it('should carry all if within limits', () => {
      const result = calculateCarryForward(8, 10, null);

      expect(result.carried).toBe(8);
      expect(result.lapsed).toBe(0);
    });
  });

  describe('Encashment Calculation', () => {
    const calculateEncashment = (
      balance: number,
      maxEncashableDays: number,
      perDayRate: number
    ): { days: number; amount: number } => {
      const days = Math.min(balance, maxEncashableDays);
      const amount = days * perDayRate;

      return { days, amount };
    };

    it('should calculate encashment within limit', () => {
      const result = calculateEncashment(20, 15, 2000);

      expect(result.days).toBe(15);
      expect(result.amount).toBe(30000); // 15 * 2000
    });

    it('should encash full balance if below limit', () => {
      const result = calculateEncashment(10, 15, 2500);

      expect(result.days).toBe(10);
      expect(result.amount).toBe(25000); // 10 * 2500
    });

    it('should return 0 for zero balance', () => {
      const result = calculateEncashment(0, 15, 2000);

      expect(result.days).toBe(0);
      expect(result.amount).toBe(0);
    });

    it('should handle different per-day rates', () => {
      const result = calculateEncashment(10, 10, 3000);

      expect(result.amount).toBe(30000);
    });

    it('should cap at max encashable days', () => {
      const result = calculateEncashment(30, 20, 2000);

      expect(result.days).toBe(20);
      expect(result.amount).toBe(40000);
    });
  });

  describe('Proration for Mid-Year Joining', () => {
    const calculateProratedLeave = (
      maxDaysPerYear: number,
      joiningDate: string,
      yearEnd: string
    ): number => {
      const joining = new Date(joiningDate);
      const endOfYear = new Date(yearEnd);

      const totalDaysInYear = 365;
      const daysRemaining = Math.ceil((endOfYear.getTime() - joining.getTime()) / (1000 * 60 * 60 * 24));

      const prorated = (maxDaysPerYear / totalDaysInYear) * daysRemaining;

      return Math.round(prorated * 100) / 100;
    };

    it('should prorate for mid-year joining', () => {
      const result = calculateProratedLeave(24, '2026-07-01', '2026-12-31');
      // ~184 days remaining out of 365 = ~12.1 days
      expect(result).toBeGreaterThan(11);
      expect(result).toBeLessThan(13);
    });

    it('should give full leaves for Jan 1 joining', () => {
      const result = calculateProratedLeave(24, '2026-01-01', '2026-12-31');
      expect(result).toBeCloseTo(24, 0);
    });

    it('should give minimal leaves for Dec 31 joining', () => {
      const result = calculateProratedLeave(24, '2026-12-31', '2026-12-31');
      expect(result).toBeCloseTo(0, 1);
    });

    it('should handle Q2 joining', () => {
      const result = calculateProratedLeave(18, '2026-04-01', '2026-12-31');
      // ~275 days / 365 = 75% of 18 = 13.5
      expect(result).toBeGreaterThan(12);
      expect(result).toBeLessThan(15);
    });
  });

  describe('Proration for Mid-Year Exit', () => {
    const calculateExitProration = (
      openingBalance: number,
      accrualRate: number,
      monthsServed: number,
      leavesTaken: number
    ): { entitled: number; taken: number; encashable: number } => {
      const entitled = openingBalance + accrualRate * monthsServed;
      const encashable = entitled - leavesTaken;

      return {
        entitled: Math.round(entitled * 100) / 100,
        taken: leavesTaken,
        encashable: Math.max(0, Math.round(encashable * 100) / 100),
      };
    };

    it('should calculate entitled leaves for exit', () => {
      const result = calculateExitProration(5, 2, 6, 8);

      expect(result.entitled).toBeCloseTo(17, 1); // 5 + 2*6
      expect(result.taken).toBe(8);
      expect(result.encashable).toBeCloseTo(9, 1); // 17-8
    });

    it('should show zero encashable if over-utilized', () => {
      const result = calculateExitProration(5, 2, 6, 20);

      expect(result.entitled).toBeCloseTo(17, 1);
      expect(result.taken).toBe(20);
      expect(result.encashable).toBe(0); // No negative encashment
    });

    it('should handle exact utilization', () => {
      const result = calculateExitProration(10, 1.5, 8, 22);

      expect(result.entitled).toBeCloseTo(22, 1); // 10 + 1.5*8
      expect(result.taken).toBe(22);
      expect(result.encashable).toBe(0);
    });

    it('should calculate for early exit (< 1 year)', () => {
      const result = calculateExitProration(0, 2, 3, 2);

      expect(result.entitled).toBeCloseTo(6, 1); // 0 + 2*3
      expect(result.taken).toBe(2);
      expect(result.encashable).toBeCloseTo(4, 1);
    });
  });

  describe('Leave Balance Validation', () => {
    const validateLeaveApplication = (
      availableBalance: number,
      requestedDays: number,
      minBalance: number = 0
    ): { valid: boolean; error?: string } => {
      if (requestedDays <= 0) {
        return { valid: false, error: 'Requested days must be positive' };
      }

      if (requestedDays > availableBalance) {
        return {
          valid: false,
          error: `Insufficient balance. Available: ${availableBalance}, Requested: ${requestedDays}`,
        };
      }

      if (availableBalance - requestedDays < minBalance) {
        return {
          valid: false,
          error: `Cannot reduce balance below minimum ${minBalance} days`,
        };
      }

      return { valid: true };
    };

    it('should approve valid leave request', () => {
      const result = validateLeaveApplication(10, 5);
      expect(result.valid).toBe(true);
    });

    it('should reject insufficient balance', () => {
      const result = validateLeaveApplication(5, 10);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient');
    });

    it('should reject negative days', () => {
      const result = validateLeaveApplication(10, -2);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('positive');
    });

    it('should reject zero days', () => {
      const result = validateLeaveApplication(10, 0);
      expect(result.valid).toBe(false);
    });

    it('should enforce minimum balance requirement', () => {
      const result = validateLeaveApplication(10, 8, 5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('minimum');
    });

    it('should allow leave up to min balance', () => {
      const result = validateLeaveApplication(10, 5, 5);
      expect(result.valid).toBe(true);
    });
  });
});
