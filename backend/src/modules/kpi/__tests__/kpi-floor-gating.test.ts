import { describe, expect, it } from "vitest";
import { calculateMetricScore } from "../kpi-score-engine.js";

/**
 * min_threshold has been stored on all 291 production config rows since the table was
 * created and never once affected a score: the higher/lower-better branches use only
 * (actual / target), and minValue is read by the 'range' type alone, which nothing selects.
 *
 * The threshold always sits on the worse side of the target — below it when higher is
 * better (sales floor ₹30,000 under a ₹50,000 target), above it when lower is better
 * (AHT ceiling 360s under a 240s target).
 */
describe("floor-gated scoring", () => {
  describe("higher is better — sales, dials", () => {
    const sales = { scoringType: "floor_gated_higher", targetValue: 50000, minValue: 30000, weightage: 100 };

    it("scores zero below the floor", () => {
      const result = calculateMetricScore({ ...sales, actualValue: 29999 });
      expect(result.metricScore).toBe(0);
      expect(result.status).toBe("threshold_failed");
      expect(result.note).toContain("below the 30000 floor");
    });

    it("scores on the ratio once the floor is met", () => {
      expect(calculateMetricScore({ ...sales, actualValue: 30000 }).metricScore).toBe(60);
      expect(calculateMetricScore({ ...sales, actualValue: 50000 }).metricScore).toBe(100);
    });

    it("still caps overachievement", () => {
      expect(calculateMetricScore({ ...sales, actualValue: 500000 }).metricScore).toBe(120);
    });
  });

  describe("lower is better — AHT, error rate", () => {
    const aht = { scoringType: "floor_gated_lower", targetValue: 240, minValue: 360, weightage: 100 };

    it("scores zero above the ceiling", () => {
      const result = calculateMetricScore({ ...aht, actualValue: 480 });
      expect(result.metricScore).toBe(0);
      expect(result.status).toBe("threshold_failed");
      expect(result.note).toContain("above the 360 ceiling");
    });

    it("scores on the inverted ratio within the ceiling", () => {
      expect(calculateMetricScore({ ...aht, actualValue: 240 }).metricScore).toBe(100);
      expect(calculateMetricScore({ ...aht, actualValue: 300 }).metricScore).toBe(80);
    });

    it("treats an error rate of zero as full marks", () => {
      const errorRate = { scoringType: "floor_gated_lower", targetValue: 2, minValue: 5, weightage: 100 };
      expect(calculateMetricScore({ ...errorRate, actualValue: 0 }).metricScore).toBe(100);
      expect(calculateMetricScore({ ...errorRate, actualValue: 6 }).metricScore).toBe(0);
    });
  });

  it("ignores the gate when no threshold is configured", () => {
    const result = calculateMetricScore({
      scoringType: "floor_gated_higher", actualValue: 10, targetValue: 80, minValue: null, weightage: 100,
    });
    expect(result.status).toBe("calculated");
    expect(result.metricScore).toBe(12.5);
  });

  it("leaves un-opted-in metrics scoring exactly as before", () => {
    // The whole point of making this opt-in: switching it on everywhere would zero 87% of
    // ATTENDANCE_PCT rows, because that metric only holds 0/50/100 and every half-day sits
    // below its 85 floor. A half-day must keep scoring ~52.6%, not 0.
    const halfDay = { actualValue: 50, targetValue: 95, minValue: 85, weightage: 100 };
    expect(calculateMetricScore({ ...halfDay, scoringType: "higher_better" }).metricScore).toBe(52.63);
    expect(calculateMetricScore({ ...halfDay, scoringType: "floor_gated_higher" }).metricScore).toBe(0);
  });

  it("keeps the legacy default when a metric declares no scoring type", () => {
    const dials = { actualValue: 30, targetValue: 80, minValue: 60, weightage: 100 };
    // 37.5%, floor of 60 ignored — today's behaviour, preserved until opted in.
    expect(calculateMetricScore({ ...dials, scoringType: "higher_better" }).metricScore).toBe(37.5);
  });
});
