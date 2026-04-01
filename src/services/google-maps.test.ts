import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchPlaces, getPlaceDetails, computeRoute, _resetDispatcher } from "./google-maps.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
  // Ensure pfetch falls through to the mocked global fetch, not undici
  vi.stubEnv("HTTP_PROXY", "");
  vi.stubEnv("http_proxy", "");
  _resetDispatcher();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

// ---------------------------------------------------------------------------
// searchPlaces
// ---------------------------------------------------------------------------

describe("searchPlaces", () => {
  it("sends correct request and maps response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        places: [
          {
            id: "abc123",
            displayName: { text: "Ichiran Shibuya" },
            formattedAddress: "1-22-7 Jinnan, Shibuya",
            location: { latitude: 35.6612, longitude: 139.6981 },
            types: ["restaurant"],
            rating: 4.3,
            userRatingCount: 1200,
            priceLevel: "PRICE_LEVEL_MODERATE",
          },
        ],
      }),
    );

    const results = await searchPlaces({ query: "best ramen in Shibuya" });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: "abc123",
      displayName: "Ichiran Shibuya",
      formattedAddress: "1-22-7 Jinnan, Shibuya",
      location: { latitude: 35.6612, longitude: 139.6981 },
      types: ["restaurant"],
      rating: 4.3,
      userRatingCount: 1200,
      priceLevel: "PRICE_LEVEL_MODERATE",
    });

    // Verify request shape
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("places:searchText");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");

    const body = JSON.parse(init.body);
    expect(body.textQuery).toBe("best ramen in Shibuya");
    expect(body.maxResultCount).toBe(10);
  });

  it("passes location bias when provided", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ places: [] }));

    await searchPlaces({
      query: "coffee",
      locationBias: { latitude: 41.39, longitude: 2.17 },
      radiusMeters: 5000,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.locationBias.circle.center).toEqual({
      latitude: 41.39,
      longitude: 2.17,
    });
    expect(body.locationBias.circle.radius).toBe(5000);
  });

  it("returns empty array when no places found", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const results = await searchPlaces({ query: "nonexistent" });
    expect(results).toEqual([]);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "bad request" }, 400));
    await expect(searchPlaces({ query: "test" })).rejects.toThrow(
      /searchText failed \(400\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// getPlaceDetails
// ---------------------------------------------------------------------------

describe("getPlaceDetails", () => {
  it("fetches and maps full place details", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "abc123",
        displayName: { text: "Sagrada Familia" },
        formattedAddress: "C/ de Mallorca, 401, Barcelona",
        location: { latitude: 41.4036, longitude: 2.1744 },
        types: ["church", "tourist_attraction"],
        rating: 4.8,
        userRatingCount: 250000,
        websiteUri: "https://sagradafamilia.org",
        nationalPhoneNumber: "+34 932 08 04 14",
        regularOpeningHours: {
          weekdayDescriptions: ["Monday: 9:00 AM – 8:00 PM"],
          openNow: true,
        },
        editorialSummary: { text: "Iconic Gaudí basilica" },
        reviews: [
          {
            rating: 5,
            text: { text: "Breathtaking architecture" },
            authorAttribution: { displayName: "Traveler" },
            relativePublishTimeDescription: "2 weeks ago",
          },
        ],
        googleMapsUri: "https://maps.google.com/?cid=abc",
      }),
    );

    const details = await getPlaceDetails({ placeId: "abc123" });

    expect(details.displayName).toBe("Sagrada Familia");
    expect(details.websiteUri).toBe("https://sagradafamilia.org");
    expect(details.regularOpeningHours?.openNow).toBe(true);
    expect(details.reviews).toHaveLength(1);
    expect(details.reviews![0].text).toBe("Breathtaking architecture");
    expect(details.googleMapsUri).toBe("https://maps.google.com/?cid=abc");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/places/abc123");
  });

  it("passes language parameter", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: "x", displayName: { text: "Test" } }),
    );

    await getPlaceDetails({ placeId: "x", language: "es" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("languageCode=es");
  });
});

// ---------------------------------------------------------------------------
// computeRoute
// ---------------------------------------------------------------------------

describe("computeRoute", () => {
  it("computes a route and maps the response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        routes: [
          {
            distanceMeters: 12500,
            duration: "1200s",
            polyline: { encodedPolyline: "abc" },
            description: "Via Diagonal",
            legs: [
              {
                distanceMeters: 12500,
                duration: "1200s",
                startLocation: {
                  latLng: { latitude: 41.39, longitude: 2.17 },
                },
                endLocation: {
                  latLng: { latitude: 41.4, longitude: 2.18 },
                },
              },
            ],
          },
        ],
      }),
    );

    const route = await computeRoute({
      origin: { latitude: 41.39, longitude: 2.17 },
      destination: { latitude: 41.4, longitude: 2.18 },
    });

    expect(route).not.toBeNull();
    expect(route!.distanceMeters).toBe(12500);
    expect(route!.duration).toBe("1200s");
    expect(route!.polyline).toBe("abc");
    expect(route!.legs).toHaveLength(1);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.travelMode).toBe("DRIVE");
  });

  it("returns null when no routes found", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ routes: [] }));

    const route = await computeRoute({
      origin: { latitude: 0, longitude: 0 },
      destination: { latitude: 0, longitude: 0 },
    });

    expect(route).toBeNull();
  });

  it("supports different travel modes", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ routes: [] }));

    await computeRoute({
      origin: { latitude: 41.39, longitude: 2.17 },
      destination: { latitude: 41.4, longitude: 2.18 },
      travelMode: "TRANSIT",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.travelMode).toBe("TRANSIT");
  });
});

// ---------------------------------------------------------------------------
// Missing API key
// ---------------------------------------------------------------------------

describe("missing API key", () => {
  it("throws when GOOGLE_MAPS_API_KEY is not set", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");

    await expect(searchPlaces({ query: "test" })).rejects.toThrow(
      "GOOGLE_MAPS_API_KEY is not set",
    );
  });
});
