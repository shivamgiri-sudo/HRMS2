import { describe, it, expect } from 'vitest';

describe('WFM Attendance Calculations', () => {
  describe('Present/Absent/LWP Calculation', () => {
    const calculateAttendance = (
      workingDays: number,
      presentDays: number,
      paidLeaveDays: number
    ): {
      workingDays: number;
      presentDays: number;
      absentDays: number;
      paidLeaveDays: number;
      lwpDays: number;
      payableDays: number;
      attendancePercentage: number;
    } => {
      const totalAttended = presentDays + paidLeaveDays;
      const absentDays = workingDays - totalAttended;
      const lwpDays = Math.max(0, absentDays); // Leave Without Pay
      const payableDays = presentDays + paidLeaveDays;
      const attendancePercentage = workingDays > 0 ? (totalAttended / workingDays) * 100 : 0;

      return {
        workingDays,
        presentDays,
        absentDays,
        paidLeaveDays,
        lwpDays,
        payableDays,
        attendancePercentage: Math.round(attendancePercentage * 100) / 100,
      };
    };

    it('should calculate full month attendance', () => {
      const result = calculateAttendance(26, 26, 0);

      expect(result.presentDays).toBe(26);
      expect(result.absentDays).toBe(0);
      expect(result.lwpDays).toBe(0);
      expect(result.payableDays).toBe(26);
      expect(result.attendancePercentage).toBe(100);
    });

    it('should calculate attendance with paid leave', () => {
      const result = calculateAttendance(26, 23, 3);

      expect(result.presentDays).toBe(23);
      expect(result.paidLeaveDays).toBe(3);
      expect(result.absentDays).toBe(0);
      expect(result.payableDays).toBe(26);
      expect(result.attendancePercentage).toBe(100);
    });

    it('should calculate LWP for absent days', () => {
      const result = calculateAttendance(26, 20, 2);

      expect(result.presentDays).toBe(20);
      expect(result.paidLeaveDays).toBe(2);
      expect(result.absentDays).toBe(4);
      expect(result.lwpDays).toBe(4);
      expect(result.payableDays).toBe(22);
      expect(result.attendancePercentage).toBeCloseTo(84.62, 1);
    });

    it('should handle zero working days', () => {
      const result = calculateAttendance(0, 0, 0);

      expect(result.attendancePercentage).toBe(0);
      expect(result.payableDays).toBe(0);
    });

    it('should calculate low attendance correctly', () => {
      const result = calculateAttendance(26, 15, 0);

      expect(result.absentDays).toBe(11);
      expect(result.lwpDays).toBe(11);
      expect(result.payableDays).toBe(15);
      expect(result.attendancePercentage).toBeCloseTo(57.69, 1);
    });
  });

  describe('Grace Period Logic', () => {
    const applyGracePeriod = (
      loginTime: string,
      shiftStartTime: string,
      gracePeriodMinutes: number
    ): { isLate: boolean; lateMinutes: number; withinGrace: boolean } => {
      const login = new Date(`2026-06-01 ${loginTime}`);
      const shiftStart = new Date(`2026-06-01 ${shiftStartTime}`);

      const diffMs = login.getTime() - shiftStart.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      const isLate = diffMinutes > 0;
      const withinGrace = isLate && diffMinutes <= gracePeriodMinutes;
      const lateMinutes = Math.max(0, diffMinutes - (withinGrace ? diffMinutes : 0));

      return {
        isLate,
        lateMinutes: withinGrace ? 0 : Math.max(0, diffMinutes),
        withinGrace,
      };
    };

    it('should mark on-time as not late', () => {
      const result = applyGracePeriod('09:00', '09:00', 15);

      expect(result.isLate).toBe(false);
      expect(result.lateMinutes).toBe(0);
      expect(result.withinGrace).toBe(false);
    });

    it('should apply grace period for late within threshold', () => {
      const result = applyGracePeriod('09:10', '09:00', 15);

      expect(result.isLate).toBe(true);
      expect(result.withinGrace).toBe(true);
      expect(result.lateMinutes).toBe(0); // Forgiven
    });

    it('should mark late beyond grace period', () => {
      const result = applyGracePeriod('09:20', '09:00', 15);

      expect(result.isLate).toBe(true);
      expect(result.withinGrace).toBe(false);
      expect(result.lateMinutes).toBe(20);
    });

    it('should handle zero grace period', () => {
      const result = applyGracePeriod('09:01', '09:00', 0);

      expect(result.isLate).toBe(true);
      expect(result.withinGrace).toBe(false);
      expect(result.lateMinutes).toBe(1);
    });

    it('should handle early arrival', () => {
      const result = applyGracePeriod('08:50', '09:00', 15);

      expect(result.isLate).toBe(false);
      expect(result.lateMinutes).toBe(0);
    });
  });

  describe('Overtime Calculation', () => {
    const calculateOvertime = (
      shiftDurationHours: number,
      actualWorkedHours: number,
      otEligibilityThreshold: number
    ): { overtimeHours: number; isEligible: boolean } => {
      const extraHours = Math.max(0, actualWorkedHours - shiftDurationHours);
      const isEligible = extraHours >= otEligibilityThreshold;
      const overtimeHours = isEligible ? extraHours : 0;

      return {
        overtimeHours: Math.round(overtimeHours * 100) / 100,
        isEligible,
      };
    };

    it('should calculate overtime for extra hours', () => {
      const result = calculateOvertime(9, 11, 0.5);

      expect(result.overtimeHours).toBe(2);
      expect(result.isEligible).toBe(true);
    });

    it('should not count overtime below threshold', () => {
      const result = calculateOvertime(9, 9.25, 0.5);

      expect(result.overtimeHours).toBe(0);
      expect(result.isEligible).toBe(false);
    });

    it('should handle exact shift duration (no OT)', () => {
      const result = calculateOvertime(9, 9, 0.5);

      expect(result.overtimeHours).toBe(0);
      expect(result.isEligible).toBe(false);
    });

    it('should calculate OT with zero threshold', () => {
      const result = calculateOvertime(9, 9.5, 0);

      expect(result.overtimeHours).toBe(0.5);
      expect(result.isEligible).toBe(true);
    });

    it('should handle short shift (no OT)', () => {
      const result = calculateOvertime(9, 8, 0.5);

      expect(result.overtimeHours).toBe(0);
      expect(result.isEligible).toBe(false);
    });
  });

  describe('Shift Duration Calculation', () => {
    const calculateShiftDuration = (
      clockIn: string,
      clockOut: string,
      breakMinutes: number
    ): { grossHours: number; netHours: number; breakHours: number } => {
      const inTime = new Date(`2026-06-01 ${clockIn}`);
      const outTime = new Date(`2026-06-01 ${clockOut}`);

      const diffMs = outTime.getTime() - inTime.getTime();
      const grossMinutes = Math.floor(diffMs / (1000 * 60));
      const grossHours = grossMinutes / 60;

      const breakHours = breakMinutes / 60;
      const netHours = grossHours - breakHours;

      return {
        grossHours: Math.round(grossHours * 100) / 100,
        netHours: Math.round(netHours * 100) / 100,
        breakHours: Math.round(breakHours * 100) / 100,
      };
    };

    it('should calculate 9-hour shift with 1-hour break', () => {
      const result = calculateShiftDuration('09:00', '18:00', 60);

      expect(result.grossHours).toBe(9);
      expect(result.breakHours).toBe(1);
      expect(result.netHours).toBe(8);
    });

    it('should calculate shift with 30-minute break', () => {
      const result = calculateShiftDuration('09:00', '18:00', 30);

      expect(result.grossHours).toBe(9);
      expect(result.breakHours).toBe(0.5);
      expect(result.netHours).toBe(8.5);
    });

    it('should handle shift with no break', () => {
      const result = calculateShiftDuration('09:00', '17:00', 0);

      expect(result.grossHours).toBe(8);
      expect(result.breakHours).toBe(0);
      expect(result.netHours).toBe(8);
    });

    it('should calculate half-day shift', () => {
      const result = calculateShiftDuration('09:00', '13:00', 0);

      expect(result.grossHours).toBe(4);
      expect(result.netHours).toBe(4);
    });

    it('should handle long shift with multiple breaks', () => {
      const result = calculateShiftDuration('09:00', '21:00', 120);

      expect(result.grossHours).toBe(12);
      expect(result.breakHours).toBe(2);
      expect(result.netHours).toBe(10);
    });
  });

  describe('Attendance Status Determination', () => {
    const determineStatus = (
      clockInTime: string | null,
      clockOutTime: string | null,
      isWeekOff: boolean,
      isHoliday: boolean,
      isPaidLeave: boolean
    ): string => {
      if (isWeekOff) return 'WO'; // Week Off
      if (isHoliday) return 'H'; // Holiday
      if (isPaidLeave) return 'PL'; // Paid Leave

      if (!clockInTime && !clockOutTime) return 'A'; // Absent

      if (clockInTime && clockOutTime) return 'P'; // Present
      if (clockInTime && !clockOutTime) return 'HD'; // Half Day (no clock out)

      return 'A';
    };

    it('should mark present with clock in/out', () => {
      expect(determineStatus('09:00', '18:00', false, false, false)).toBe('P');
    });

    it('should mark absent with no clock in/out', () => {
      expect(determineStatus(null, null, false, false, false)).toBe('A');
    });

    it('should mark half day with clock in only', () => {
      expect(determineStatus('09:00', null, false, false, false)).toBe('HD');
    });

    it('should mark week off regardless of attendance', () => {
      expect(determineStatus('09:00', '18:00', true, false, false)).toBe('WO');
      expect(determineStatus(null, null, true, false, false)).toBe('WO');
    });

    it('should mark holiday', () => {
      expect(determineStatus(null, null, false, true, false)).toBe('H');
    });

    it('should mark paid leave', () => {
      expect(determineStatus(null, null, false, false, true)).toBe('PL');
    });

    it('should prioritize week-off over holiday', () => {
      expect(determineStatus(null, null, true, true, false)).toBe('WO');
    });
  });

  describe('Monthly Attendance Summary', () => {
    const calculateMonthlySummary = (attendanceRecords: {
      status: string;
      netHours: number;
    }[]): {
      totalDays: number;
      presentDays: number;
      absentDays: number;
      paidLeaveDays: number;
      weekOffDays: number;
      holidayDays: number;
      totalWorkedHours: number;
      avgHoursPerDay: number;
    } => {
      const totalDays = attendanceRecords.length;
      const presentDays = attendanceRecords.filter((r) => r.status === 'P').length;
      const absentDays = attendanceRecords.filter((r) => r.status === 'A').length;
      const paidLeaveDays = attendanceRecords.filter((r) => r.status === 'PL').length;
      const weekOffDays = attendanceRecords.filter((r) => r.status === 'WO').length;
      const holidayDays = attendanceRecords.filter((r) => r.status === 'H').length;
      const totalWorkedHours = attendanceRecords.reduce((sum, r) => sum + r.netHours, 0);
      const workDays = presentDays + paidLeaveDays;
      const avgHoursPerDay = workDays > 0 ? totalWorkedHours / workDays : 0;

      return {
        totalDays,
        presentDays,
        absentDays,
        paidLeaveDays,
        weekOffDays,
        holidayDays,
        totalWorkedHours: Math.round(totalWorkedHours * 100) / 100,
        avgHoursPerDay: Math.round(avgHoursPerDay * 100) / 100,
      };
    };

    it('should calculate perfect attendance month', () => {
      const records = Array(22).fill({ status: 'P', netHours: 8 });

      const summary = calculateMonthlySummary(records);

      expect(summary.presentDays).toBe(22);
      expect(summary.absentDays).toBe(0);
      expect(summary.totalWorkedHours).toBe(176); // 22 * 8
      expect(summary.avgHoursPerDay).toBe(8);
    });

    it('should calculate mixed attendance month', () => {
      const records = [
        ...Array(18).fill({ status: 'P', netHours: 8 }),
        ...Array(2).fill({ status: 'PL', netHours: 0 }),
        ...Array(2).fill({ status: 'A', netHours: 0 }),
        ...Array(4).fill({ status: 'WO', netHours: 0 }),
      ];

      const summary = calculateMonthlySummary(records);

      expect(summary.totalDays).toBe(26);
      expect(summary.presentDays).toBe(18);
      expect(summary.absentDays).toBe(2);
      expect(summary.paidLeaveDays).toBe(2);
      expect(summary.weekOffDays).toBe(4);
      expect(summary.totalWorkedHours).toBe(144); // 18 * 8
      expect(summary.avgHoursPerDay).toBeCloseTo(7.2, 1); // 144 / 20
    });

    it('should handle month with holidays', () => {
      const records = [
        ...Array(20).fill({ status: 'P', netHours: 8 }),
        ...Array(2).fill({ status: 'H', netHours: 0 }),
        ...Array(4).fill({ status: 'WO', netHours: 0 }),
      ];

      const summary = calculateMonthlySummary(records);

      expect(summary.holidayDays).toBe(2);
      expect(summary.weekOffDays).toBe(4);
      expect(summary.presentDays).toBe(20);
    });
  });
});
