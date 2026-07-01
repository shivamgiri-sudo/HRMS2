import { describe, it, expect } from 'vitest';

describe('Payroll Calculations', () => {
  describe('PF (Provident Fund) Calculation', () => {
    const calculatePF = (basic: number, da: number = 0): { employee: number; employer: number } => {
      const pfWage = basic + da;
      const cappedWage = Math.min(pfWage, 15000); // PF ceiling

      const employeeContribution = Math.round(cappedWage * 0.12);
      const employerContribution = Math.round(cappedWage * 0.12);

      return {
        employee: employeeContribution,
        employer: employerContribution,
      };
    };

    it('should calculate 12% employee + 12% employer on basic', () => {
      const result = calculatePF(10000);
      expect(result.employee).toBe(1200); // 10000 * 0.12
      expect(result.employer).toBe(1200);
    });

    it('should include DA in PF wage', () => {
      const result = calculatePF(10000, 2000);
      expect(result.employee).toBe(1440); // 12000 * 0.12
      expect(result.employer).toBe(1440);
    });

    it('should cap PF wage at ₹15,000', () => {
      const result = calculatePF(20000);
      expect(result.employee).toBe(1800); // 15000 * 0.12 (capped)
      expect(result.employer).toBe(1800);
    });

    it('should handle exact ceiling amount', () => {
      const result = calculatePF(15000);
      expect(result.employee).toBe(1800);
      expect(result.employer).toBe(1800);
    });

    it('should handle zero salary', () => {
      const result = calculatePF(0);
      expect(result.employee).toBe(0);
      expect(result.employer).toBe(0);
    });

    it('should round to nearest rupee', () => {
      const result = calculatePF(10500);
      expect(result.employee).toBe(1260); // 10500 * 0.12 = 1260 (exact)
    });
  });

  describe('ESI (Employee State Insurance) Calculation', () => {
    const calculateESI = (gross: number): { employee: number; employer: number } | null => {
      const ESI_WAGE_LIMIT = 21000; // Monthly wage limit for ESI

      if (gross > ESI_WAGE_LIMIT) {
        return null; // Not applicable
      }

      const employeeContribution = Math.round(gross * 0.0075); // 0.75%
      const employerContribution = Math.round(gross * 0.0325); // 3.25%

      return {
        employee: employeeContribution,
        employer: employerContribution,
      };
    };

    it('should calculate 0.75% employee + 3.25% employer', () => {
      const result = calculateESI(15000);
      expect(result).not.toBeNull();
      expect(result!.employee).toBe(113); // 15000 * 0.0075 = 112.5 → 113
      expect(result!.employer).toBe(488); // 15000 * 0.0325 = 487.5 → 488
    });

    it('should return null if gross > ₹21,000', () => {
      const result = calculateESI(25000);
      expect(result).toBeNull();
    });

    it('should apply ESI at exactly ₹21,000', () => {
      const result = calculateESI(21000);
      expect(result).not.toBeNull();
      expect(result!.employee).toBe(158);
      expect(result!.employer).toBe(683);
    });

    it('should handle low salaries', () => {
      const result = calculateESI(5000);
      expect(result).not.toBeNull();
      expect(result!.employee).toBe(38);
      expect(result!.employer).toBe(163);
    });

    it('should handle zero gross', () => {
      const result = calculateESI(0);
      expect(result).not.toBeNull();
      expect(result!.employee).toBe(0);
      expect(result!.employer).toBe(0);
    });
  });

  describe('Professional Tax (PT) Calculation', () => {
    const calculatePT = (gross: number, state: string = 'Maharashtra'): number => {
      // Maharashtra PT slabs (most common)
      if (state === 'Maharashtra') {
        if (gross <= 5000) return 0;
        if (gross <= 10000) return 175;
        return 200;
      }

      // Karnataka PT slabs
      if (state === 'Karnataka') {
        if (gross <= 15000) return 0;
        if (gross <= 20000) return 150;
        return 200;
      }

      return 0; // Other states
    };

    it('should calculate Maharashtra PT slabs', () => {
      expect(calculatePT(4000, 'Maharashtra')).toBe(0);
      expect(calculatePT(7000, 'Maharashtra')).toBe(175);
      expect(calculatePT(15000, 'Maharashtra')).toBe(200);
    });

    it('should calculate Karnataka PT slabs', () => {
      expect(calculatePT(10000, 'Karnataka')).toBe(0);
      expect(calculatePT(18000, 'Karnataka')).toBe(150);
      expect(calculatePT(25000, 'Karnataka')).toBe(200);
    });

    it('should return 0 for other states', () => {
      expect(calculatePT(15000, 'Gujarat')).toBe(0);
    });

    it('should handle exact slab boundaries', () => {
      expect(calculatePT(5000, 'Maharashtra')).toBe(0);
      expect(calculatePT(10000, 'Maharashtra')).toBe(175);
    });
  });

  describe('TDS (Tax Deduction at Source) Calculation', () => {
    const calculateTDS = (
      annualIncome: number,
      regime: 'old' | 'new' = 'new'
    ): { taxableIncome: number; tax: number } => {
      if (regime === 'new') {
        // New regime slabs (FY 2023-24 onwards)
        const standardDeduction = 50000;
        const taxableIncome = Math.max(0, annualIncome - standardDeduction);

        let tax = 0;

        if (taxableIncome <= 300000) {
          tax = 0; // Rebate under section 87A
        } else if (taxableIncome <= 600000) {
          tax = (taxableIncome - 300000) * 0.05;
        } else if (taxableIncome <= 900000) {
          tax = 15000 + (taxableIncome - 600000) * 0.10;
        } else if (taxableIncome <= 1200000) {
          tax = 45000 + (taxableIncome - 900000) * 0.15;
        } else if (taxableIncome <= 1500000) {
          tax = 90000 + (taxableIncome - 1200000) * 0.20;
        } else {
          tax = 150000 + (taxableIncome - 1500000) * 0.30;
        }

        return { taxableIncome, tax: Math.round(tax) };
      }

      // Old regime (simplified - without all deductions)
      const taxableIncome = annualIncome;
      let tax = 0;

      if (taxableIncome <= 250000) {
        tax = 0;
      } else if (taxableIncome <= 500000) {
        tax = (taxableIncome - 250000) * 0.05;
      } else if (taxableIncome <= 1000000) {
        tax = 12500 + (taxableIncome - 500000) * 0.20;
      } else {
        tax = 112500 + (taxableIncome - 1000000) * 0.30;
      }

      return { taxableIncome, tax: Math.round(tax) };
    };

    it('should calculate new regime TDS for ₹6L income', () => {
      const result = calculateTDS(600000, 'new');
      expect(result.taxableIncome).toBe(550000); // 600000 - 50000 standard deduction
      expect(result.tax).toBe(12500); // (550000-300000)*0.05 + (550000-600000)*0.10
    });

    it('should apply rebate for income ≤ ₹3.5L (new regime)', () => {
      const result = calculateTDS(350000, 'new');
      expect(result.tax).toBe(0); // Rebate under 87A
    });

    it('should calculate old regime TDS for ₹6L income', () => {
      const result = calculateTDS(600000, 'old');
      expect(result.tax).toBe(32500); // 12500 + (600000-500000)*0.20
    });

    it('should handle high income (new regime)', () => {
      const result = calculateTDS(2000000, 'new');
      expect(result.taxableIncome).toBe(1950000);
      // Calculation: 0-300K=0, 300-600K=15K, 600-900K=30K, 900-1200K=45K, 1200-1500K=60K, 1500-1950K=135K
      // Total: 15000 + 30000 + 45000 + 60000 + 135000 = 285000
      expect(result.tax).toBe(285000);
    });

    it('should handle income below taxable limit', () => {
      const resultNew = calculateTDS(200000, 'new');
      const resultOld = calculateTDS(200000, 'old');

      expect(resultNew.tax).toBe(0);
      expect(resultOld.tax).toBe(0);
    });

    it('should apply standard deduction in new regime only', () => {
      const income = 400000;
      const resultNew = calculateTDS(income, 'new');
      const resultOld = calculateTDS(income, 'old');

      expect(resultNew.taxableIncome).toBe(350000); // With deduction
      expect(resultOld.taxableIncome).toBe(400000); // Without deduction
    });
  });

  describe('Proration Calculation', () => {
    const calculateProration = (
      annualAmount: number,
      daysWorked: number,
      totalDays: number
    ): number => {
      if (totalDays === 0) return 0;
      return Math.round((annualAmount / 12) * (daysWorked / totalDays));
    };

    it('should calculate monthly proration', () => {
      const annual = 600000; // ₹50,000 per month
      const result = calculateProration(annual, 15, 30);
      expect(result).toBe(25000); // Half month
    });

    it('should handle full month', () => {
      const annual = 600000;
      const result = calculateProration(annual, 30, 30);
      expect(result).toBe(50000);
    });

    it('should handle partial month (mid-joining)', () => {
      const annual = 600000;
      const result = calculateProration(annual, 10, 30);
      expect(result).toBe(16667); // 10/30 of monthly
    });

    it('should handle zero days worked', () => {
      const annual = 600000;
      const result = calculateProration(annual, 0, 30);
      expect(result).toBe(0);
    });

    it('should handle February (28 days)', () => {
      const annual = 600000;
      const result = calculateProration(annual, 14, 28);
      expect(result).toBe(25000);
    });
  });

  describe('Gross to Net Calculation', () => {
    const calculateNetSalary = (gross: number): {
      gross: number;
      pf: number;
      esi: number;
      pt: number;
      tds: number;
      totalDeductions: number;
      net: number;
    } => {
      const pfCalc = calculatePF(gross * 0.5); // Assume 50% basic
      const esiCalc = calculateESI(gross);
      const pt = calculatePT(gross, 'Maharashtra');
      const tdsCalc = calculateTDS(gross * 12, 'new');

      const monthlyTDS = Math.round(tdsCalc.tax / 12);

      const pf = pfCalc.employee;
      const esi = esiCalc?.employee ?? 0;

      const totalDeductions = pf + esi + pt + monthlyTDS;
      const net = gross - totalDeductions;

      return { gross, pf, esi, pt, tds: monthlyTDS, totalDeductions, net };
    };

    const calculatePF = (basic: number): { employee: number; employer: number } => {
      const cappedWage = Math.min(basic, 15000);
      return {
        employee: Math.round(cappedWage * 0.12),
        employer: Math.round(cappedWage * 0.12),
      };
    };

    const calculateESI = (gross: number): { employee: number; employer: number } | null => {
      if (gross > 21000) return null;
      return {
        employee: Math.round(gross * 0.0075),
        employer: Math.round(gross * 0.0325),
      };
    };

    const calculatePT = (gross: number, state: string): number => {
      if (state === 'Maharashtra') {
        if (gross <= 5000) return 0;
        if (gross <= 10000) return 175;
        return 200;
      }
      return 0;
    };

    const calculateTDS = (annualIncome: number, regime: string): { tax: number } => {
      const standardDeduction = 50000;
      const taxableIncome = Math.max(0, annualIncome - standardDeduction);

      let tax = 0;
      if (taxableIncome <= 300000) {
        tax = 0;
      } else if (taxableIncome <= 600000) {
        tax = (taxableIncome - 300000) * 0.05;
      } else if (taxableIncome <= 900000) {
        tax = 15000 + (taxableIncome - 600000) * 0.10;
      } else if (taxableIncome <= 1200000) {
        tax = 45000 + (taxableIncome - 900000) * 0.15;
      } else if (taxableIncome <= 1500000) {
        tax = 90000 + (taxableIncome - 1200000) * 0.20;
      } else {
        tax = 150000 + (taxableIncome - 1500000) * 0.30;
      }

      return { tax: Math.round(tax) };
    };

    it('should calculate net salary with all deductions', () => {
      const result = calculateNetSalary(50000);

      expect(result.gross).toBe(50000);
      expect(result.pf).toBeGreaterThan(0);
      expect(result.esi).toBe(0); // Above ESI limit
      expect(result.pt).toBe(200);
      expect(result.net).toBeLessThan(result.gross);
    });

    it('should show ESI deduction for low salary', () => {
      const result = calculateNetSalary(15000);

      expect(result.esi).toBeGreaterThan(0);
      expect(result.pt).toBe(200);
    });

    it('should calculate correct deductions order', () => {
      const result = calculateNetSalary(30000);

      expect(result.totalDeductions).toBe(result.pf + result.esi + result.pt + result.tds);
      expect(result.net).toBe(result.gross - result.totalDeductions);
    });
  });

  describe('Advance Recovery Calculation', () => {
    const calculateAdvanceRecovery = (
      advanceAmount: number,
      installments: number,
      installmentsPaid: number
    ): { emi: number; remainingAmount: number; remainingInstallments: number } => {
      const emi = Math.round(advanceAmount / installments);
      const remainingInstallments = installments - installmentsPaid;
      const remainingAmount = emi * remainingInstallments;

      return { emi, remainingAmount, remainingInstallments };
    };

    it('should calculate EMI correctly', () => {
      const result = calculateAdvanceRecovery(50000, 10, 0);
      expect(result.emi).toBe(5000);
      expect(result.remainingAmount).toBe(50000);
      expect(result.remainingInstallments).toBe(10);
    });

    it('should track remaining amount', () => {
      const result = calculateAdvanceRecovery(50000, 10, 3);
      expect(result.emi).toBe(5000);
      expect(result.remainingAmount).toBe(35000); // 7 * 5000
      expect(result.remainingInstallments).toBe(7);
    });

    it('should handle last installment', () => {
      const result = calculateAdvanceRecovery(50000, 10, 9);
      expect(result.remainingInstallments).toBe(1);
      expect(result.remainingAmount).toBe(5000);
    });

    it('should show zero remaining after full payment', () => {
      const result = calculateAdvanceRecovery(50000, 10, 10);
      expect(result.remainingInstallments).toBe(0);
      expect(result.remainingAmount).toBe(0);
    });
  });
});
