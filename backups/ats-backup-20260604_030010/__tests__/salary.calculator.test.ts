import { describe, it, expect } from 'vitest';
import { calculateSalary } from '../salary.calculator';

describe('calculateSalary', () => {
  it('computes gross and net for Band D CTC 100000 non-metro', () => {
    const r = calculateSalary(100000, 40, 40, false);
    // gross = ctc - pf_employer - esic_employer - gratuity - admin
    // monthly gross ~ 7692 (≤ 21000 → ESIC applies)
    expect(r.offered_ctc).toBeCloseTo(100000 / 12, 0);
    expect(r.gross).toBeGreaterThan(0);
    expect(r.basic).toBeGreaterThan(0);
    expect(r.net_in_hand).toBeGreaterThan(0);
    expect(r.net_in_hand).toBeLessThan(r.gross);
  });

  it('does not apply ESIC when monthly gross > 21000', () => {
    const r = calculateSalary(400000, 45, 40, false);
    // monthly gross ≈ 400000 / 12 = 33333 > 21000 → no ESIC
    expect(r.esic_employee).toBe(0);
    expect(r.esic_employer).toBe(0);
  });

  it('caps PF employee at 1800/month (21600/year)', () => {
    const r = calculateSalary(1000000, 50, 50, false);
    expect(r.pf_employee).toBeCloseTo(1800, 0); // monthly cap = ₹1,800
  });

  it('all values stored as monthly (annual / 12)', () => {
    const r = calculateSalary(120000, 40, 40, false);
    // monthly ctc = 10000
    expect(r.offered_ctc).toBeCloseTo(120000 / 12, 0);
  });
});
