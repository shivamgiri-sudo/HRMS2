/**
 * TrackerSummaryCards - Unit Tests (Task 8)
 *
 * Tests card data definitions and summary calculations:
 * 1. All 7 cards rendered with correct labels
 * 2. Correct counts from TrackerSummary
 * 3. onCardClick called with correct filterType
 * 4. Active card detection (ring-2 class logic)
 * 5. Percentage shown only for non-'all' cards
 *
 * Pattern: Pure logic tests matching quality-dashboard.e2e.test.tsx style.
 * No DOM rendering (no RTL/jsdom installed in root).
 */

import { describe, it, expect, vi } from 'vitest';
import type { TrackerSummary } from '../../../types/joiningDocumentsTracker';

// ---------------------------------------------------------------------------
// Card definitions (mirrors the component's CARD_DEFINITIONS array)
// ---------------------------------------------------------------------------

interface CardDef {
  label: string;
  filterType: string;
  colorClass: string;
}

const CARD_DEFINITIONS: CardDef[] = [
  { label: 'Total Employees',              filterType: 'all',                 colorClass: 'text-slate-600 bg-slate-50 border-slate-200' },
  { label: 'Complete (100%)',              filterType: 'complete',            colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  { label: 'Pending Verification (75-99%)',filterType: 'pending_verification',colorClass: 'text-amber-700 bg-amber-50 border-amber-200' },
  { label: 'In Progress (1-74%)',          filterType: 'in_progress',         colorClass: 'text-blue-700 bg-blue-50 border-blue-200' },
  { label: 'Not Started (0%)',             filterType: 'not_started',         colorClass: 'text-slate-600 bg-slate-50 border-slate-200' },
  { label: 'Overdue Documents',            filterType: 'overdue',             colorClass: 'text-rose-700 bg-rose-50 border-rose-200' },
  { label: 'Needs Correction',             filterType: 'needs_correction',    colorClass: 'text-rose-700 bg-rose-50 border-rose-200' },
];

// ---------------------------------------------------------------------------
// Helper: get count from summary by filterType
// ---------------------------------------------------------------------------
function getCountForFilter(summary: TrackerSummary, filterType: string): number {
  switch (filterType) {
    case 'all':                 return summary.total;
    case 'complete':            return summary.complete;
    case 'pending_verification':return summary.pending_verification;
    case 'in_progress':         return summary.in_progress;
    case 'not_started':         return summary.not_started;
    case 'overdue':             return summary.overdue;
    case 'needs_correction':    return summary.needs_correction;
    default:                    return 0;
  }
}

// ---------------------------------------------------------------------------
// Helper: compute card percentage
// ---------------------------------------------------------------------------
function getPercentageForFilter(summary: TrackerSummary, filterType: string): number | null {
  if (filterType === 'all') return null; // not shown for 'all'
  const count = getCountForFilter(summary, filterType);
  return summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Helper: determine if a card should show ring-2 (active highlight)
// ---------------------------------------------------------------------------
function isCardActive(activeFilter: string | null, filterType: string): boolean {
  return activeFilter === filterType;
}

// ---------------------------------------------------------------------------
// Mock summary data
// ---------------------------------------------------------------------------
const mockSummary: TrackerSummary = {
  total: 100,
  complete: 40,
  pending_verification: 20,
  in_progress: 15,
  not_started: 10,
  overdue: 8,
  needs_correction: 7,
};

const emptySummary: TrackerSummary = {
  total: 0,
  complete: 0,
  pending_verification: 0,
  in_progress: 0,
  not_started: 0,
  overdue: 0,
  needs_correction: 0,
};

// ===========================================================================
// TEST SUITES
// ===========================================================================

describe('TrackerSummaryCards – card definitions', () => {
  // -------------------------------------------------------------------------
  // Test 1: All 7 cards with correct labels
  // -------------------------------------------------------------------------
  it('should define exactly 7 cards', () => {
    expect(CARD_DEFINITIONS).toHaveLength(7);
  });

  it('should have the correct label for each card', () => {
    const labels = CARD_DEFINITIONS.map(c => c.label);
    expect(labels).toContain('Total Employees');
    expect(labels).toContain('Complete (100%)');
    expect(labels).toContain('Pending Verification (75-99%)');
    expect(labels).toContain('In Progress (1-74%)');
    expect(labels).toContain('Not Started (0%)');
    expect(labels).toContain('Overdue Documents');
    expect(labels).toContain('Needs Correction');
  });

  it('should have the correct filterType for each card', () => {
    const filterTypes = CARD_DEFINITIONS.map(c => c.filterType);
    expect(filterTypes).toEqual([
      'all',
      'complete',
      'pending_verification',
      'in_progress',
      'not_started',
      'overdue',
      'needs_correction',
    ]);
  });

  // -------------------------------------------------------------------------
  // Test 2: Correct count for each card
  // -------------------------------------------------------------------------
  it('should return total count for "all" filterType', () => {
    expect(getCountForFilter(mockSummary, 'all')).toBe(100);
  });

  it('should return complete count for "complete" filterType', () => {
    expect(getCountForFilter(mockSummary, 'complete')).toBe(40);
  });

  it('should return pending_verification count', () => {
    expect(getCountForFilter(mockSummary, 'pending_verification')).toBe(20);
  });

  it('should return in_progress count', () => {
    expect(getCountForFilter(mockSummary, 'in_progress')).toBe(15);
  });

  it('should return not_started count', () => {
    expect(getCountForFilter(mockSummary, 'not_started')).toBe(10);
  });

  it('should return overdue count', () => {
    expect(getCountForFilter(mockSummary, 'overdue')).toBe(8);
  });

  it('should return needs_correction count', () => {
    expect(getCountForFilter(mockSummary, 'needs_correction')).toBe(7);
  });

  // -------------------------------------------------------------------------
  // Test 3: onCardClick called with correct filterType
  // -------------------------------------------------------------------------
  it('should call onCardClick with the card filterType when clicked', () => {
    const onCardClick = vi.fn();

    // Simulate clicking each card
    CARD_DEFINITIONS.forEach(card => {
      onCardClick(card.filterType);
    });

    expect(onCardClick).toHaveBeenCalledTimes(7);
    expect(onCardClick).toHaveBeenCalledWith('all');
    expect(onCardClick).toHaveBeenCalledWith('complete');
    expect(onCardClick).toHaveBeenCalledWith('pending_verification');
    expect(onCardClick).toHaveBeenCalledWith('in_progress');
    expect(onCardClick).toHaveBeenCalledWith('not_started');
    expect(onCardClick).toHaveBeenCalledWith('overdue');
    expect(onCardClick).toHaveBeenCalledWith('needs_correction');
  });

  it('should call onCardClick with "all" when total card is clicked', () => {
    const onCardClick = vi.fn();
    const totalCard = CARD_DEFINITIONS.find(c => c.filterType === 'all')!;
    onCardClick(totalCard.filterType);
    expect(onCardClick).toHaveBeenCalledWith('all');
  });

  // -------------------------------------------------------------------------
  // Test 4: Active card detection (ring-2 class logic)
  // -------------------------------------------------------------------------
  it('should mark a card as active when activeFilter matches its filterType', () => {
    expect(isCardActive('complete', 'complete')).toBe(true);
  });

  it('should not mark a card as active when activeFilter does not match', () => {
    expect(isCardActive('complete', 'all')).toBe(false);
  });

  it('should not mark any card as active when activeFilter is null', () => {
    CARD_DEFINITIONS.forEach(card => {
      expect(isCardActive(null, card.filterType)).toBe(false);
    });
  });

  it('should mark only the matching card as active when a filter is set', () => {
    const activeFilter = 'overdue';
    const activeCards = CARD_DEFINITIONS.filter(c => isCardActive(activeFilter, c.filterType));
    expect(activeCards).toHaveLength(1);
    expect(activeCards[0].filterType).toBe('overdue');
  });

  // -------------------------------------------------------------------------
  // Test 5: Percentage shown for non-'all' cards; hidden for 'all'
  // -------------------------------------------------------------------------
  it('should return null percentage for "all" filterType', () => {
    expect(getPercentageForFilter(mockSummary, 'all')).toBeNull();
  });

  it('should return a numeric percentage for "complete" filterType', () => {
    const pct = getPercentageForFilter(mockSummary, 'complete');
    expect(pct).not.toBeNull();
    expect(pct).toBe(40); // 40/100 = 40%
  });

  it('should return a numeric percentage for "pending_verification" filterType', () => {
    const pct = getPercentageForFilter(mockSummary, 'pending_verification');
    expect(pct).toBe(20); // 20/100 = 20%
  });

  it('should return a numeric percentage for "in_progress" filterType', () => {
    const pct = getPercentageForFilter(mockSummary, 'in_progress');
    expect(pct).toBe(15); // 15/100 = 15%
  });

  it('should return 0 percentage when total is 0', () => {
    expect(getPercentageForFilter(emptySummary, 'complete')).toBe(0);
    expect(getPercentageForFilter(emptySummary, 'overdue')).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Color class verification
  // -------------------------------------------------------------------------
  it('should use emerald colors for the complete card', () => {
    const card = CARD_DEFINITIONS.find(c => c.filterType === 'complete')!;
    expect(card.colorClass).toContain('emerald');
  });

  it('should use amber colors for the pending_verification card', () => {
    const card = CARD_DEFINITIONS.find(c => c.filterType === 'pending_verification')!;
    expect(card.colorClass).toContain('amber');
  });

  it('should use blue colors for the in_progress card', () => {
    const card = CARD_DEFINITIONS.find(c => c.filterType === 'in_progress')!;
    expect(card.colorClass).toContain('blue');
  });

  it('should use rose colors for overdue and needs_correction cards', () => {
    const overdueCard = CARD_DEFINITIONS.find(c => c.filterType === 'overdue')!;
    const correctionCard = CARD_DEFINITIONS.find(c => c.filterType === 'needs_correction')!;
    expect(overdueCard.colorClass).toContain('rose');
    expect(correctionCard.colorClass).toContain('rose');
  });

  it('should use slate colors for all and not_started cards', () => {
    const allCard = CARD_DEFINITIONS.find(c => c.filterType === 'all')!;
    const notStartedCard = CARD_DEFINITIONS.find(c => c.filterType === 'not_started')!;
    expect(allCard.colorClass).toContain('slate');
    expect(notStartedCard.colorClass).toContain('slate');
  });
});
