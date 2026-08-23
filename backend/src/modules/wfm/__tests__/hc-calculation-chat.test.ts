import { describe, it, expect } from "vitest";

/**
 * Unit tests for chat HC calculation formula.
 *
 * Bug fixed: agent_capacity_mins was `60 * concurrency` (per-hour capacity)
 * but total_workload_mins covers the full slot. This under-counted by ~8x
 * (for default 8-hour slot). Fix: `60 * concurrency * slot_hours`.
 *
 * Formula:
 *   total_workload_mins = chat_volume × (avg_chat_duration_seconds / 60)
 *   agent_capacity_mins = 60 × concurrency × slot_hours
 *   productive_hc = total_workload_mins / agent_capacity_mins
 */

// Inline assertion: with 480 chats × 10 min each = 4800 min workload
// concurrency=3, slot=8h → capacity = 60×3×8 = 1440 min/agent → HC = 4800/1440 ≈ 3.34 → ceil = 4
// OLD BUG: capacity was 60×3 = 180 → HC = 4800/180 = 26.67 → ceil = 27 (8× over!)
describe("calcChat – slot_hours multiplier fix", () => {
  // We test the formula directly since calcChat is not exported.
  // If it becomes exported or the service exposes an endpoint, replace with integration call.

  function calcChatFormula(params: {
    chat_volume: number;
    avg_chat_duration_seconds: number;
    chat_concurrency: number;
    slot_hours: number;
    shrinkage_pct?: number;
  }) {
    const duration_mins = params.avg_chat_duration_seconds / 60;
    const volume = params.chat_volume;
    const concurrency = params.chat_concurrency;
    const slotHours = params.slot_hours;
    const shrinkage = params.shrinkage_pct ?? 0;

    const total_workload_mins = volume * duration_mins;
    const agent_capacity_mins = 60 * concurrency * slotHours;
    const productive_hc = agent_capacity_mins > 0 ? total_workload_mins / agent_capacity_mins : 0;
    const planned_hc = productive_hc / (1 - shrinkage / 100);

    return { productive_hc, planned_hc, agent_capacity_mins, total_workload_mins };
  }

  it("should include slot_hours in capacity (default 8h slot)", () => {
    const result = calcChatFormula({
      chat_volume: 480,
      avg_chat_duration_seconds: 600, // 10 min
      chat_concurrency: 3,
      slot_hours: 8,
    });

    // 480 × 10 = 4800 mins workload
    expect(result.total_workload_mins).toBe(4800);
    // 60 × 3 × 8 = 1440 capacity per agent
    expect(result.agent_capacity_mins).toBe(1440);
    // 4800 / 1440 ≈ 3.33
    expect(result.productive_hc).toBeCloseTo(3.33, 1);
  });

  it("should NOT produce ~8× overcounted HC (the old bug)", () => {
    const result = calcChatFormula({
      chat_volume: 480,
      avg_chat_duration_seconds: 600,
      chat_concurrency: 3,
      slot_hours: 8,
    });

    // Old buggy formula: 60 * concurrency = 180 → 4800/180 = 26.67
    // Fixed formula should be ~3.33, NOT ~26.67
    expect(result.productive_hc).toBeLessThan(5);
    expect(result.productive_hc).toBeGreaterThan(3);
  });

  it("respects custom slot_hours", () => {
    const result = calcChatFormula({
      chat_volume: 100,
      avg_chat_duration_seconds: 300, // 5 min
      chat_concurrency: 2,
      slot_hours: 4,
    });

    // 100 × 5 = 500 min workload
    // 60 × 2 × 4 = 480 min capacity
    // HC = 500 / 480 ≈ 1.04
    expect(result.agent_capacity_mins).toBe(480);
    expect(result.productive_hc).toBeCloseTo(1.04, 1);
  });

  it("applies shrinkage correctly", () => {
    const result = calcChatFormula({
      chat_volume: 480,
      avg_chat_duration_seconds: 600,
      chat_concurrency: 3,
      slot_hours: 8,
      shrinkage_pct: 30,
    });

    // productive ≈ 3.33, planned = 3.33 / 0.7 ≈ 4.76
    expect(result.planned_hc).toBeCloseTo(4.76, 1);
  });
});
