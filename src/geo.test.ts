import { describe, expect, it } from "vitest";
import { distanceKm, filterByDistance } from "./geo.js";

describe("distanceKm", () => {
  it("returns 0 for same point", () => {
    expect(distanceKm({ lat: 51, lng: -1 }, { lat: 51, lng: -1 })).toBe(0);
  });

  it("calculates London to Paris (~340km)", () => {
    const d = distanceKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 });
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(350);
  });

  it("calculates short distance (~3.5km Stow to Bourton)", () => {
    const d = distanceKm({ lat: 51.9299, lng: -1.7246 }, { lat: 51.8821, lng: -1.7529 });
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(6);
  });
});

describe("filterByDistance", () => {
  const items = [
    { name: "A", coords: { lat: 51.93, lng: -1.72 } },  // ~0km from center
    { name: "B", coords: { lat: 51.88, lng: -1.75 } },  // ~6km
    { name: "C", coords: { lat: 51.75, lng: -1.26 } },  // ~40km
    { name: "D", coords: { lat: 52.5, lng: -1.9 } },    // ~64km
  ];
  const center = { lat: 51.9299, lng: -1.7246 };

  it("filters by radius", () => {
    const result = filterByDistance(items, (i) => i.coords, center, 10);
    expect(result.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("sorts by distance", () => {
    const result = filterByDistance(items, (i) => i.coords, center, 100);
    expect(result[0].name).toBe("A");
    expect(result[3].name).toBe("D");
    expect(result[0].distanceKm).toBeLessThan(result[1].distanceKm);
  });

  it("returns empty for tiny radius", () => {
    const result = filterByDistance(items, (i) => i.coords, center, 0.001);
    expect(result).toHaveLength(0);
  });
});
