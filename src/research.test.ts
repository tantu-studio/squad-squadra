import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseAtlasObscuraResearch, nearbyFromResearch, formatAtlasObscuraResearch, parseWikivoyageResearch, nearbyPlaces } from "./research.js";
import type { PlacePreview } from "./sources/atlas-obscura.js";

const fixture = join(import.meta.dirname, "../trips/2026-04-cotswolds/research/atlas-obscura.md");
const researchDir = join(import.meta.dirname, "../trips/2026-04-cotswolds/research");
const wikiFixture = join(researchDir, "wikivoyage/stow-on-the-wold.md");

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

describe("parseWikivoyageResearch", () => {
  it("parses listings from a dumped Wikivoyage file", () => {
    const listings = parseWikivoyageResearch(wikiFixture);

    expect(listings.length).toBeGreaterThan(20);
    expect(listings[0].article).toBe("Stow-on-the-Wold");
  });

  it("extracts coordinates at full precision", () => {
    const listings = parseWikivoyageResearch(wikiFixture);
    const gallery = listings.find((l) => l.name === "Fosse Art Gallery");

    expect(gallery).toBeDefined();
    expect(gallery!.lat).toBe(51.93114);
    expect(gallery!.lng).toBe(-1.72343);
  });

  it("extracts contact details", () => {
    const listings = parseWikivoyageResearch(wikiFixture);
    const gallery = listings.find((l) => l.name === "Fosse Art Gallery");

    expect(gallery!.phone).toContain("+44");
    expect(gallery!.url).toContain("fossegallery");
  });

  it("extracts type and section", () => {
    const listings = parseWikivoyageResearch(wikiFixture);
    const church = listings.find((l) => l.name === "St Edward's Church");

    expect(church!.type).toBe("see");
    expect(church!.section).toBe("See");
  });

  it("extracts hours and descriptions", () => {
    const listings = parseWikivoyageResearch(wikiFixture);
    const withHours = listings.filter((l) => l.hours);
    const withDesc = listings.filter((l) => l.description);

    expect(withHours.length).toBeGreaterThan(0);
    expect(withDesc.length).toBeGreaterThan(0);
  });
});

describe("nearbyPlaces", () => {
  // Center of Stow-on-the-Wold
  const stow = { lat: 51.9299, lng: -1.7246 };

  it("returns places from both sources", () => {
    const places = nearbyPlaces(researchDir, stow, 2);

    const sources = new Set(places.map((p) => p.source));
    expect(sources.has("atlas-obscura")).toBe(true);
    expect(sources.has("wikivoyage")).toBe(true);
  });

  it("sorts by distance", () => {
    const places = nearbyPlaces(researchDir, stow, 5);

    for (let i = 1; i < places.length; i++) {
      expect(places[i].distanceKm).toBeGreaterThanOrEqual(places[i - 1].distanceKm);
    }
  });

  it("respects radius filter", () => {
    const small = nearbyPlaces(researchDir, stow, 1);
    const large = nearbyPlaces(researchDir, stow, 10);

    expect(large.length).toBeGreaterThan(small.length);
    for (const p of small) {
      expect(p.distanceKm).toBeLessThanOrEqual(1);
    }
  });

  it("includes source-specific fields", () => {
    const places = nearbyPlaces(researchDir, stow, 2);

    const wikiPlace = places.find((p) => p.source === "wikivoyage" && p.phone);
    expect(wikiPlace).toBeDefined();
    expect(wikiPlace!.article).toBeDefined();
    expect(wikiPlace!.section).toBeDefined();

    const atlasPlace = places.find((p) => p.source === "atlas-obscura");
    expect(atlasPlace).toBeDefined();
    expect(atlasPlace!.type).toBe("hidden-gem");
  });

  it("filters by type", () => {
    const eatDrink = nearbyPlaces(researchDir, stow, 2, { types: ["eat", "drink"] });

    expect(eatDrink.length).toBeGreaterThan(0);
    for (const p of eatDrink) {
      expect(["eat", "drink"]).toContain(p.type);
    }
  });

  it("filters by source", () => {
    const wikiOnly = nearbyPlaces(researchDir, stow, 5, { sources: ["wikivoyage"] });
    const atlasOnly = nearbyPlaces(researchDir, stow, 5, { sources: ["atlas-obscura"] });

    for (const p of wikiOnly) expect(p.source).toBe("wikivoyage");
    for (const p of atlasOnly) expect(p.source).toBe("atlas-obscura");
  });

  it("type filter excludes atlas obscura unless hidden-gem is requested", () => {
    const seeOnly = nearbyPlaces(researchDir, stow, 5, { types: ["see"] });
    expect(seeOnly.every((p) => p.source === "wikivoyage")).toBe(true);

    const withGems = nearbyPlaces(researchDir, stow, 5, { types: ["see", "hidden-gem"] });
    const sources = new Set(withGems.map((p) => p.source));
    expect(sources.has("atlas-obscura")).toBe(true);
    expect(sources.has("wikivoyage")).toBe(true);
  });
});
