/**
 * Atlas Obscura scraper — curated "hidden gems" and unusual places.
 *
 * No official API exists. We scrape using two approaches:
 *   1. JSON endpoint `/places/{id}.json` — structured place data (lightweight)
 *   2. HTML scraping of place detail pages — descriptions, tags, directions
 *
 * Uses `got-scraping` for TLS fingerprinting to bypass Cloudflare protection.
 * Cache aggressively and respect rate limits (~1 req/s).
 *
 * See docs/api-research.md for scraping assessment and strategy.
 */

import { gotScraping } from "got-scraping";
import { parse } from "node-html-parser";

// ---------------------------------------------------------------------------
// Types — public
// ---------------------------------------------------------------------------

export interface SearchAreaOptions {
  /** Latitude of the search center */
  lat: number;
  /** Longitude of the search center */
  lng: number;
  /** Maximum distance from center in km (default 50) */
  radiusKm?: number;
  /** Safety cap on pages fetched (default 15) */
  maxPages?: number;
}

export interface SearchNearbyOptions {
  /** Latitude of the search center */
  lat: number;
  /** Longitude of the search center */
  lng: number;
  /** Page number (default 1) */
  page?: number;
}

export interface SearchNearbyResult {
  /** Total results Atlas Obscura reports (global — not all are relevant) */
  totalReported: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  places: PlacePreview[];
}

export interface PlacePreview {
  id: number;
  title: string;
  subtitle: string;
  location: string;
  url: string;
  thumbnailUrl: string;
  coordinates: { lat: number; lng: number };
  /** Distance from query point, e.g. "2.3 km" */
  distance?: string;
}

export interface Place {
  id: number;
  title: string;
  subtitle: string;
  city: string;
  country: string;
  location: string;
  url: string;
  thumbnailUrl: string;
  coordinates: { lat: number; lng: number };
  nearbyPlaces: PlacePreview[];
  nearbyFoods: PlacePreview[];
}

export interface PlaceDetails extends Place {
  /** Body text paragraphs */
  description: string[];
  /** "Know Before You Go" section */
  directions: string[];
  /** Tags/categories */
  tags: PlaceTag[];
  /** Cover image URL */
  coverImage?: string;
  /** All image URLs from the gallery */
  images: string[];
}

export interface PlaceTag {
  title: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.atlasobscura.com";
const USER_AGENT = "SquadSquadra/0.1 (travel-planner)";

/** Minimum delay between requests in ms */
export const RATE_LIMIT_MS = 1_000;
let lastRequestTime = 0;

/** Reset rate limiter state — for testing only. */
export function _resetRateLimit(): void {
  lastRequestTime = 0;
}

async function rateLimitedFetch(url: string): Promise<string> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const proxyUrl = process.env.HTTP_PROXY ?? process.env.http_proxy;

  const response = await gotScraping({
    url,
    proxyUrl,
    headerGeneratorOptions: {
      browsers: [
        { name: "chrome", minVersion: 115 },
        { name: "firefox", minVersion: 115 },
      ],
      devices: ["desktop"],
      locales: ["en-US"],
      operatingSystems: ["windows", "macos"],
    },
    // HTTP/2 doesn't work through forward proxies
    http2: !proxyUrl,
  });

  if (response.statusCode !== 200) {
    throw new Error(`Atlas Obscura request failed (${response.statusCode}): ${url}`);
  }

  return response.body;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Collect all Atlas Obscura places within a radius of a center point.
 *
 * Auto-paginates until results exceed the radius or pages run out.
 * Results are sorted by distance (closest first) — this is how Atlas Obscura
 * returns them, so we just stop when places get too far.
 *
 * For the Cotswolds (~80x80km) with a 50km radius, expect ~100-150 results
 * fetched across ~8-12 pages with 1s rate limiting between each.
 */
export async function searchArea(options: SearchAreaOptions): Promise<PlacePreview[]> {
  const { lat, lng, radiusKm = 50, maxPages = 15 } = options;
  const collected: PlacePreview[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchNearby({ lat, lng, page });

    for (const place of result.places) {
      const dist = parseFloat(place.distance ?? "");
      if (!Number.isNaN(dist) && dist > radiusKm) {
        return collected;
      }
      collected.push(place);
    }

    if (!result.hasMore) break;
  }

  return collected;
}

/**
 * Search for places near a coordinate (single page).
 * Scrapes the Atlas Obscura search page with nearby=true.
 * Prefer searchArea() for collecting all places in a region.
 */
export async function searchNearby(options: SearchNearbyOptions): Promise<SearchNearbyResult> {
  const { lat, lng, page = 1 } = options;

  const url = `${BASE_URL}/search?utf8=%E2%9C%93&q=&location=&nearby=true&lat=${lat}&lng=${lng}&page=${page}`;
  const html = await rateLimitedFetch(url);

  const match = html.match(/AtlasObscura\.place_search\s*=\s*(.*?);/);
  if (!match) {
    throw new Error("Could not extract search data from Atlas Obscura page");
  }

  const raw = JSON.parse(match[1]) as RawSearchResult;

  const totalReported = raw.total?.value ?? 0;
  const currentPage = raw.current_page ?? page;
  const perPage = raw.per_page ?? 0;
  const places = (raw.results ?? []).map(mapPreviewFromSearch);

  return {
    totalReported,
    page: currentPage,
    perPage,
    hasMore: places.length === perPage && currentPage * perPage < totalReported,
    places,
  };
}

/**
 * Get basic place data by numeric ID.
 * Uses the JSON endpoint — fast, structured, no HTML parsing.
 */
export async function getPlace(id: number): Promise<Place> {
  const url = `${BASE_URL}/places/${id}.json?place_only=1`;
  const body = await rateLimitedFetch(url);
  const raw = JSON.parse(body) as RawPlaceJson;

  return mapPlace(raw);
}

/**
 * Get full place details including description, tags, and images.
 * Fetches the JSON endpoint first, then scrapes the HTML page for rich content.
 */
export async function getPlaceDetails(id: number): Promise<PlaceDetails> {
  const place = await getPlace(id);
  const extended = await scrapePlacePage(place.url);

  return { ...place, ...extended };
}

/**
 * Scrape rich content from a place's HTML page.
 * Used internally by getPlaceDetails, but exported for cases where
 * you already have the URL (e.g. from search results).
 */
export async function scrapePlacePage(url: string): Promise<Omit<PlaceDetails, keyof Place>> {
  const fullUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;
  const html = await rateLimitedFetch(fullUrl);
  const doc = parse(html);

  // Description — body paragraphs
  const description = doc
    .querySelectorAll(".place-body p")
    .map((p) => p.textContent.trim())
    .filter(Boolean);

  // "Know Before You Go" section
  const sections = doc.querySelectorAll("section");
  let directions: string[] = [];
  for (const section of sections) {
    const h2 = section.querySelector("h2");
    if (h2 && h2.textContent.trim() === "Know Before You Go") {
      directions = section
        .querySelectorAll("p")
        .map((p) => p.textContent.trim())
        .filter(Boolean);
      break;
    }
  }

  // Tags
  const tags: PlaceTag[] = doc
    .querySelectorAll(".aon-pill-badge-component")
    .map((el) => ({
      title: el.querySelector(".aon-pill-badge-text")?.textContent.trim() ?? "",
      url: el.getAttribute("href") ?? "",
    }))
    .filter((t) => t.title);

  // Images from gallery
  const images = doc
    .querySelectorAll(".swiper-slide img")
    .map((img) => img.getAttribute("src"))
    .filter((src): src is string => Boolean(src));

  return {
    description,
    directions,
    tags,
    coverImage: images[0],
    images,
  };
}

// ---------------------------------------------------------------------------
// Raw API shapes (internal)
// ---------------------------------------------------------------------------

interface RawSearchResult {
  total?: { value: number; relation: string };
  per_page?: number;
  current_page?: number;
  results?: RawSearchPlace[];
}

interface RawSearchPlace {
  id: number;
  title?: string;
  subtitle?: string;
  location?: string;
  thumbnail_url?: string;
  url?: string;
  coordinates?: { lat: number; lng: number };
  distance_from_query?: string;
}

interface RawPlaceJson {
  id: number;
  title?: string;
  subtitle?: string;
  city?: string;
  country?: string;
  location?: string;
  url?: string;
  thumbnail_url?: string;
  coordinates?: { lat: number; lng: number };
  nearby_places?: RawSearchPlace[];
  nearby_foods?: RawSearchPlace[];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapPreviewFromSearch(raw: RawSearchPlace): PlacePreview {
  return {
    id: raw.id,
    title: raw.title ?? "",
    subtitle: raw.subtitle ?? "",
    location: raw.location ?? "",
    url: raw.url ?? "",
    thumbnailUrl: raw.thumbnail_url ?? "",
    coordinates: raw.coordinates ?? { lat: 0, lng: 0 },
    distance: raw.distance_from_query,
  };
}

function mapPreview(raw: RawSearchPlace): PlacePreview {
  return {
    id: raw.id,
    title: raw.title ?? "",
    subtitle: raw.subtitle ?? "",
    location: raw.location ?? "",
    url: raw.url ?? "",
    thumbnailUrl: raw.thumbnail_url ?? "",
    coordinates: raw.coordinates ?? { lat: 0, lng: 0 },
  };
}

function mapPlace(raw: RawPlaceJson): Place {
  return {
    id: raw.id,
    title: raw.title ?? "",
    subtitle: raw.subtitle ?? "",
    city: raw.city ?? "",
    country: raw.country ?? "",
    location: raw.location ?? "",
    url: raw.url ?? "",
    thumbnailUrl: raw.thumbnail_url ?? "",
    coordinates: raw.coordinates ?? { lat: 0, lng: 0 },
    nearbyPlaces: (raw.nearby_places ?? []).map(mapPreview),
    nearbyFoods: (raw.nearby_foods ?? []).map(mapPreview),
  };
}
