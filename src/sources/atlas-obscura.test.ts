import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock got-scraping before importing the module
vi.mock("got-scraping", () => ({
  gotScraping: vi.fn(),
}));

import { gotScraping } from "got-scraping";
import { searchArea, searchNearby, getPlace, getPlaceDetails, scrapePlacePage, _resetRateLimit, RATE_LIMIT_MS } from "./atlas-obscura.js";

const mockGot = vi.mocked(gotScraping);

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimit();
  // Make Date.now() increment by 2s on each call so the rate limiter never waits
  let clock = 10_000;
  vi.spyOn(Date, "now").mockImplementation(() => {
    clock += RATE_LIMIT_MS + 1;
    return clock;
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const searchPageHtml = `
<html><body>
<script>
AtlasObscura.place_search = {"total":{"value":42,"relation":"eq"},"per_page":20,"current_page":1,"results":[{"id":101,"title":"Bunkers del Carmel","subtitle":"The best panoramic views of Barcelona","location":"Barcelona, Spain","thumbnail_url":"https://img.atlasobscura.com/bunkers.jpg","url":"/places/bunkers-del-carmel","coordinates":{"lat":41.4189,"lng":2.1521},"distance_from_query":"1.2 km"},{"id":102,"title":"Hospital de la Santa Creu","subtitle":"A medieval hospital turned cultural center","location":"Barcelona, Spain","thumbnail_url":"https://img.atlasobscura.com/hospital.jpg","url":"/places/hospital-santa-creu","coordinates":{"lat":41.3811,"lng":2.1694},"distance_from_query":"3.5 km"}]};
</script>
</body></html>
`;

const placeJson = JSON.stringify({
  id: 101,
  title: "Bunkers del Carmel",
  subtitle: "The best panoramic views of Barcelona",
  city: "Barcelona",
  country: "Spain",
  location: "Barcelona, Spain",
  url: "/places/bunkers-del-carmel",
  thumbnail_url: "https://img.atlasobscura.com/bunkers.jpg",
  coordinates: { lat: 41.4189, lng: 2.1521 },
  nearby_places: [
    {
      id: 200,
      title: "Park Güell",
      subtitle: "Gaudí's colorful park",
      location: "Barcelona, Spain",
      url: "/places/park-guell",
      thumbnail_url: "https://img.atlasobscura.com/guell.jpg",
      coordinates: { lat: 41.4145, lng: 2.1527 },
    },
  ],
  nearby_foods: [],
});

const placePageHtml = `
<html><body>
  <div class="place-body">
    <p>From the top of this hill, you can see all of Barcelona spread out below you.</p>
    <p>The bunkers were built during the Spanish Civil War as anti-aircraft batteries.</p>
  </div>
  <section>
    <h2>Know Before You Go</h2>
    <p>Free to visit. Best at sunset.</p>
    <p>Accessible via bus V17 or a steep uphill walk.</p>
  </section>
  <a class="aon-pill-badge-component" href="/topics/hidden-gems">
    <span class="aon-pill-badge-text">Hidden Gems</span>
  </a>
  <a class="aon-pill-badge-component" href="/topics/ruins">
    <span class="aon-pill-badge-text">Ruins</span>
  </a>
  <div class="swiper-slide"><img src="https://img.atlasobscura.com/bunkers-1.jpg" /></div>
  <div class="swiper-slide"><img src="https://img.atlasobscura.com/bunkers-2.jpg" /></div>
</body></html>
`;

// ---------------------------------------------------------------------------
// searchNearby
// ---------------------------------------------------------------------------

describe("searchNearby", () => {
  it("parses embedded search data from HTML", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: searchPageHtml } as any);

    const result = await searchNearby({ lat: 41.3874, lng: 2.1686 });

    expect(result.totalReported).toBe(42);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(20);
    expect(result.places).toHaveLength(2);
    // 2 results < perPage of 20 → no more pages
    expect(result.hasMore).toBe(false);
  });

  it("maps place previews correctly", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: searchPageHtml } as any);

    const result = await searchNearby({ lat: 41.3874, lng: 2.1686 });
    const place = result.places[0];

    expect(place.id).toBe(101);
    expect(place.title).toBe("Bunkers del Carmel");
    expect(place.subtitle).toBe("The best panoramic views of Barcelona");
    expect(place.location).toBe("Barcelona, Spain");
    expect(place.url).toBe("/places/bunkers-del-carmel");
    expect(place.coordinates.lat).toBeCloseTo(41.4189);
    expect(place.distance).toBe("1.2 km");
  });

  it("passes page parameter in URL", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: searchPageHtml } as any);

    await searchNearby({ lat: 41.3874, lng: 2.1686, page: 3 });

    const calledUrl = (mockGot.mock.calls[0][0] as any).url;
    expect(calledUrl).toContain("page=3");
  });

  it("throws on missing search data", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: "<html></html>" } as any);

    await expect(searchNearby({ lat: 0, lng: 0 })).rejects.toThrow(
      "Could not extract search data",
    );
  });

  it("throws on non-200 response", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 403, body: "Forbidden" } as any);

    await expect(searchNearby({ lat: 0, lng: 0 })).rejects.toThrow("403");
  });
});

// ---------------------------------------------------------------------------
// searchArea
// ---------------------------------------------------------------------------

function makeSearchPage(results: Array<{ id: number; title: string; distance: string }>, page: number, perPage = 15): string {
  const json = JSON.stringify({
    total: { value: 200, relation: "eq" },
    per_page: perPage,
    current_page: page,
    results: results.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: "",
      location: "Test",
      thumbnail_url: "",
      url: `/places/test-${r.id}`,
      coordinates: { lat: 0, lng: 0 },
      distance_from_query: r.distance,
    })),
  });
  return `<html><script>AtlasObscura.place_search = ${json};</script></html>`;
}

describe("searchArea", () => {
  it("collects places across multiple pages within radius", async () => {
    // Page 1: 3 places at 5-10km (perPage=3 so hasMore=true)
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: makeSearchPage([
      { id: 1, title: "Place A", distance: "5.0" },
      { id: 2, title: "Place B", distance: "8.0" },
      { id: 3, title: "Place C", distance: "10.0" },
    ], 1, 3) } as any);

    // Page 2: 3 places, last one exceeds 20km radius
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: makeSearchPage([
      { id: 4, title: "Place D", distance: "15.0" },
      { id: 5, title: "Place E", distance: "19.0" },
      { id: 6, title: "Place F", distance: "25.0" },
    ], 2, 3) } as any);

    const places = await searchArea({ lat: 51.0, lng: -1.0, radiusKm: 20 });

    expect(places).toHaveLength(5);
    expect(places.map((p) => p.title)).toEqual([
      "Place A", "Place B", "Place C", "Place D", "Place E",
    ]);
  });

  it("stops when no more pages", async () => {
    // Single page with fewer results than perPage
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: makeSearchPage([
      { id: 1, title: "Only Place", distance: "2.0" },
    ], 1, 15) } as any);

    const places = await searchArea({ lat: 51.0, lng: -1.0, radiusKm: 50 });

    expect(places).toHaveLength(1);
    expect(mockGot).toHaveBeenCalledTimes(1);
  });

  it("respects maxPages cap", async () => {
    // All pages within radius but we cap at 2 pages
    for (let i = 0; i < 2; i++) {
      mockGot.mockResolvedValueOnce({ statusCode: 200, body: makeSearchPage([
        { id: i * 3 + 1, title: `P${i * 3 + 1}`, distance: "1.0" },
        { id: i * 3 + 2, title: `P${i * 3 + 2}`, distance: "2.0" },
        { id: i * 3 + 3, title: `P${i * 3 + 3}`, distance: "3.0" },
      ], i + 1, 3) } as any);
    }

    const places = await searchArea({ lat: 51.0, lng: -1.0, radiusKm: 100, maxPages: 2 });

    expect(places).toHaveLength(6);
    expect(mockGot).toHaveBeenCalledTimes(2);
  });

  it("uses default 50km radius", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: makeSearchPage([
      { id: 1, title: "Close", distance: "10.0" },
      { id: 2, title: "Far", distance: "55.0" },
    ], 1, 15) } as any);

    const places = await searchArea({ lat: 51.0, lng: -1.0 });

    expect(places).toHaveLength(1);
    expect(places[0].title).toBe("Close");
  });
});

// ---------------------------------------------------------------------------
// getPlace
// ---------------------------------------------------------------------------

describe("getPlace", () => {
  it("fetches and maps JSON place data", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placeJson } as any);

    const place = await getPlace(101);

    expect(place.id).toBe(101);
    expect(place.title).toBe("Bunkers del Carmel");
    expect(place.city).toBe("Barcelona");
    expect(place.country).toBe("Spain");
    expect(place.coordinates.lat).toBeCloseTo(41.4189);
    expect(place.nearbyPlaces).toHaveLength(1);
    expect(place.nearbyPlaces[0].title).toBe("Park Güell");
    expect(place.nearbyFoods).toHaveLength(0);
  });

  it("calls the correct JSON endpoint", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placeJson } as any);

    await getPlace(101);

    const calledUrl = (mockGot.mock.calls[0][0] as any).url;
    expect(calledUrl).toContain("/places/101.json?place_only=1");
  });
});

// ---------------------------------------------------------------------------
// scrapePlacePage
// ---------------------------------------------------------------------------

describe("scrapePlacePage", () => {
  it("extracts description paragraphs", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placePageHtml } as any);

    const details = await scrapePlacePage("/places/bunkers-del-carmel");

    expect(details.description).toHaveLength(2);
    expect(details.description[0]).toContain("see all of Barcelona");
    expect(details.description[1]).toContain("Spanish Civil War");
  });

  it("extracts Know Before You Go directions", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placePageHtml } as any);

    const details = await scrapePlacePage("/places/bunkers-del-carmel");

    expect(details.directions).toHaveLength(2);
    expect(details.directions[0]).toContain("Free to visit");
    expect(details.directions[1]).toContain("bus V17");
  });

  it("extracts tags", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placePageHtml } as any);

    const details = await scrapePlacePage("/places/bunkers-del-carmel");

    expect(details.tags).toHaveLength(2);
    expect(details.tags[0]).toEqual({ title: "Hidden Gems", url: "/topics/hidden-gems" });
    expect(details.tags[1]).toEqual({ title: "Ruins", url: "/topics/ruins" });
  });

  it("extracts images from gallery", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placePageHtml } as any);

    const details = await scrapePlacePage("/places/bunkers-del-carmel");

    expect(details.images).toHaveLength(2);
    expect(details.coverImage).toBe("https://img.atlasobscura.com/bunkers-1.jpg");
  });

  it("prepends base URL for relative paths", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placePageHtml } as any);

    await scrapePlacePage("/places/bunkers-del-carmel");

    const calledUrl = (mockGot.mock.calls[0][0] as any).url;
    expect(calledUrl).toMatch(/^https:\/\/www\.atlasobscura\.com/);
  });

  it("uses absolute URL as-is", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placePageHtml } as any);

    await scrapePlacePage("https://www.atlasobscura.com/places/bunkers-del-carmel");

    const calledUrl = (mockGot.mock.calls[0][0] as any).url;
    expect(calledUrl).toBe("https://www.atlasobscura.com/places/bunkers-del-carmel");
  });

  it("handles page without Know Before You Go section", async () => {
    const html = `<html><body><div class="place-body"><p>Just a description.</p></div></body></html>`;
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: html } as any);

    const details = await scrapePlacePage("/places/test");

    expect(details.description).toEqual(["Just a description."]);
    expect(details.directions).toEqual([]);
    expect(details.tags).toEqual([]);
    expect(details.images).toEqual([]);
    expect(details.coverImage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getPlaceDetails
// ---------------------------------------------------------------------------

describe("getPlaceDetails", () => {
  it("combines JSON data with scraped HTML content", async () => {
    // First call: JSON endpoint
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placeJson } as any);
    // Second call: HTML page
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placePageHtml } as any);

    const details = await getPlaceDetails(101);

    // From JSON
    expect(details.id).toBe(101);
    expect(details.title).toBe("Bunkers del Carmel");
    expect(details.city).toBe("Barcelona");
    expect(details.nearbyPlaces).toHaveLength(1);

    // From HTML
    expect(details.description).toHaveLength(2);
    expect(details.tags).toHaveLength(2);
    expect(details.directions).toHaveLength(2);
    expect(details.images).toHaveLength(2);
  });

  it("makes two requests — JSON then HTML", async () => {
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placeJson } as any);
    mockGot.mockResolvedValueOnce({ statusCode: 200, body: placePageHtml } as any);

    await getPlaceDetails(101);

    expect(mockGot).toHaveBeenCalledTimes(2);
    const firstUrl = (mockGot.mock.calls[0][0] as any).url;
    const secondUrl = (mockGot.mock.calls[1][0] as any).url;
    expect(firstUrl).toContain(".json");
    expect(secondUrl).toContain("/places/bunkers-del-carmel");
  });
});
