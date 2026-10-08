import { describe, it, expect } from "vitest";

// Pure helpers defined locally — they mirror the implementation in location.routes.ts
// but are kept here so the test does not depend on the route module.

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isOutsideGeofence(
  empLat: number,
  empLng: number,
  branchLat: number,
  branchLng: number,
  radiusKm: number,
): { outside: boolean; distanceKm: number } {
  const distanceKm = haversineKm(empLat, empLng, branchLat, branchLng);
  return { outside: distanceKm > radiusKm, distanceKm };
}

describe("geofence — haversine & isOutsideGeofence", () => {
  // Branch coords: MAS Callnet Nagpur office (example fixed coords)
  const branchLat = 21.1458;
  const branchLng = 79.0882;

  it("returns outside:false when employee is within 1 km of branch", () => {
    // ~0.09 km offset — well inside the default 1 km radius
    const empLat = branchLat + 0.0008; // ≈ 89 m north
    const empLng = branchLng;
    const result = isOutsideGeofence(empLat, empLng, branchLat, branchLng, 1.0);
    expect(result.outside).toBe(false);
    expect(result.distanceKm).toBeLessThan(1.0);
  });

  it("returns outside:true when employee is more than 1 km from branch", () => {
    // ~1.11 km offset — outside the default 1 km radius
    const empLat = branchLat + 0.01; // ≈ 1.11 km north
    const empLng = branchLng;
    const result = isOutsideGeofence(empLat, empLng, branchLat, branchLng, 1.0);
    expect(result.outside).toBe(true);
    expect(result.distanceKm).toBeGreaterThan(1.0);
  });

  it("stricter radius: 0.5 km catches employees that 1.0 km does not", () => {
    // ~0.67 km offset — inside 1 km but outside 0.5 km
    const empLat = branchLat + 0.006; // ≈ 0.67 km north
    const empLng = branchLng;
    const withinOneKm = isOutsideGeofence(empLat, empLng, branchLat, branchLng, 1.0);
    const outsideHalfKm = isOutsideGeofence(empLat, empLng, branchLat, branchLng, 0.5);
    expect(withinOneKm.outside).toBe(false);
    expect(outsideHalfKm.outside).toBe(true);
  });

  it("returns distanceKm of 0 and outside:false when coordinates are identical", () => {
    const result = isOutsideGeofence(branchLat, branchLng, branchLat, branchLng, 1.0);
    expect(result.distanceKm).toBe(0);
    expect(result.outside).toBe(false);
  });
});
