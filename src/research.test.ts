import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseAtlasObscuraResearch, nearbyFromResearch, formatAtlasObscuraResearch } from "./research.js";
import type { PlacePreview } from "./sources/atlas-obscura.js";

const fixture = join(import.meta.dirname, "../trips/2026-04-cotswolds/research/atlas-obscura.md");

describe("parseAtlasObscuraResearch", () => {
  it("parses the Cotswolds research file", () => {
    const places = parseAtlasObscuraResearch(fixture);

    expect(places.length).toBeGreaterThan(200);

    const first = places[0];
    expect(first.name).toBe("St Edward's Church");
    expect(first.summary).toContain("medieval");
    expect(first.location).toContain("Stow-on-the-Wold");
    expect(first.coordinates.lat).toBeCloseTo(51.93, 0);
    expect(first.coordinates.lng).toBeCloseTo(-1.72, 0);
    expect(first.distanceFromCenter).toBeLessThan(1);
    expect(first.url).toContain("atlasobscura.com");
  });

  it("parses coordinates correctly for all entries", () => {
    const places = parseAtlasObscuraResearch(fixture);
    for (const p of places) {
      expect(p.coordinates.lat).not.toBe(0);
      expect(p.coordinates.lng).not.toBe(0);
    }
  });
});

describe("nearbyFromResearch", () => {
  it("finds places near Bourton-on-the-Water within 5km", () => {
    const nearby = nearbyFromResearch(fixture, { lat: 51.8821, lng: -1.7529 }, 5);

    expect(nearby.length).toBeGreaterThan(0);
    expect(nearby.length).toBeLessThan(20);

    // Should include Bourton places
    const names = nearby.map((p) => p.name);
    expect(names.some((n) => n.includes("Bourton"))).toBe(true);

    // Should be sorted by distance
    for (let i = 1; i < nearby.length; i++) {
      expect(nearby[i].distanceKm).toBeGreaterThanOrEqual(nearby[i - 1].distanceKm);
    }
  });

  it("finds more places with larger radius", () => {
    const small = nearbyFromResearch(fixture, { lat: 51.9299, lng: -1.7246 }, 5);
    const large = nearbyFromResearch(fixture, { lat: 51.9299, lng: -1.7246 }, 20);

    expect(large.length).toBeGreaterThan(small.length);
  });
});

describe("formatAtlasObscuraResearch round-trip", () => {
  const tmpFile = join(tmpdir(), "atlas-obscura-roundtrip-test.md");

  const fakePlaces: PlacePreview[] = [
    {
      id: 1,
      title: "Test Place",
      subtitle: "A place for testing.",
      location: "Test City, England",
      url: "/places/test-place",
      thumbnailUrl: "",
      coordinates: { lat: 51.5, lng: -1.2 },
      distance: "3.50",
    },
    {
      id: 2,
      title: "Another Spot",
      subtitle: "Something interesting here.",
      location: "Other Town, England",
      url: "/places/another-spot",
      thumbnailUrl: "",
      coordinates: { lat: 51.6, lng: -1.3 },
      distance: "15.20",
    },
  ];

  it("write → parse preserves all fields", () => {
    const center = { lat: 51.9, lng: -1.7 };
    const md = formatAtlasObscuraResearch(fakePlaces, center, 50);
    writeFileSync(tmpFile, md);

    const parsed = parseAtlasObscuraResearch(tmpFile);

    expect(parsed).toHaveLength(2);

    expect(parsed[0].name).toBe("Test Place");
    expect(parsed[0].summary).toBe("A place for testing.");
    expect(parsed[0].location).toBe("Test City, England");
    expect(parsed[0].coordinates.lat).toBe(51.5);
    expect(parsed[0].coordinates.lng).toBe(-1.2);
    expect(parsed[0].distanceFromCenter).toBe(3.5);
    expect(parsed[0].url).toContain("atlasobscura.com/places/test-place");

    expect(parsed[1].name).toBe("Another Spot");
    expect(parsed[1].distanceFromCenter).toBe(15.2);

    unlinkSync(tmpFile);
  });
});
