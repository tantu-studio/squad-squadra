/**
 * Google Maps Platform integration — Places API (New) + Routes API.
 *
 * Uses field masks to control which data (and pricing tier) each request hits.
 * See docs/api-research.md for cost breakdown and usage strategy.
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";

// ---------------------------------------------------------------------------
// Proxy-aware fetch — routes through sandbox HTTP proxy when available.
// Checked lazily so tests can stub env vars before the first call.
// ---------------------------------------------------------------------------

let _dispatcher: ProxyAgent | undefined;
let _dispatcherInit = false;

/** @internal — test-only reset for the lazy proxy dispatcher */
export function _resetDispatcher(): void {
  _dispatcher = undefined;
  _dispatcherInit = false;
}

function getDispatcher(): ProxyAgent | undefined {
  if (!_dispatcherInit) {
    const proxy = process.env.HTTP_PROXY ?? process.env.http_proxy;
    _dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
    _dispatcherInit = true;
  }
  return _dispatcher;
}

function pfetch(url: string, init?: RequestInit): Promise<Response> {
  const d = getDispatcher();
  if (!d) return fetch(url, init);
  return undiciFetch(url, { ...init, dispatcher: d } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface SearchPlacesOptions {
  /** Natural language query, e.g. "best ramen in Shibuya" */
  query: string;
  /** Bias results near this location */
  locationBias?: LatLng;
  /** Bias radius in meters (default 10 000) */
  radiusMeters?: number;
  /** Max results (1-20, default 10) */
  maxResults?: number;
  /** BCP-47 language code, e.g. "en" */
  language?: string;
}

/** Lightweight place from Text Search — uses Pro tier (5K free/mo). */
export interface PlaceSearchResult {
  id: string;
  displayName: string;
  formattedAddress: string;
  location: LatLng;
  types: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
}

export interface GetPlaceDetailsOptions {
  placeId: string;
  /** BCP-47 language code */
  language?: string;
}

/** Full place details — uses Enterprise tier (1K free/mo). Fetch selectively. */
export interface PlaceDetails {
  id: string;
  displayName: string;
  formattedAddress: string;
  location: LatLng;
  types: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: OpeningHours;
  editorialSummary?: string;
  reviews?: PlaceReview[];
  googleMapsUri?: string;
}

export interface OpeningHours {
  weekdayDescriptions: string[];
  openNow?: boolean;
}

export interface PlaceReview {
  rating: number;
  text: string;
  authorAttribution: string;
  relativePublishTimeDescription: string;
}

export interface ComputeRouteOptions {
  origin: LatLng;
  destination: LatLng;
  /** Default DRIVE */
  travelMode?: "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT";
  /** BCP-47 language code */
  language?: string;
}

export interface RouteResult {
  distanceMeters: number;
  duration: string;
  polyline?: string;
  description?: string;
  legs: RouteLeg[];
}

export interface RouteLeg {
  distanceMeters: number;
  duration: string;
  startLocation: LatLng;
  endLocation: LatLng;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PLACES_BASE = "https://places.googleapis.com/v1/places";
const ROUTES_BASE = "https://routes.googleapis.com/directions/v2:computeRoutes";

function getApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  return key;
}

// ---------------------------------------------------------------------------
// Field masks — control what we fetch (and what tier we pay for)
// ---------------------------------------------------------------------------

/** Pro tier fields — name, address, type, location, rating */
const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
].join(",");

/** Enterprise tier fields — hours, reviews, website, editorial summary */
const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "rating",
  "userRatingCount",
  "priceLevel",
  "websiteUri",
  "nationalPhoneNumber",
  "regularOpeningHours",
  "editorialSummary",
  "reviews",
  "googleMapsUri",
].join(",");

const ROUTE_FIELDS = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.polyline",
  "routes.description",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
  "routes.legs.startLocation",
  "routes.legs.endLocation",
].join(",");

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Text Search — discover places by natural language query.
 * Uses Pro tier (5K free calls/month).
 */
export async function searchPlaces(
  options: SearchPlacesOptions,
): Promise<PlaceSearchResult[]> {
  const { query, locationBias, radiusMeters = 10_000, maxResults = 10, language } = options;

  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: maxResults,
  };

  if (language) body.languageCode = language;

  if (locationBias) {
    body.locationBias = {
      circle: {
        center: locationBias,
        radius: radiusMeters,
      },
    };
  }

  const res = await pfetch(`${PLACES_BASE}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getApiKey(),
      "X-Goog-FieldMask": SEARCH_FIELDS,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Places searchText failed (${res.status}): ${error}`);
  }

  const data = (await res.json()) as { places?: RawPlace[] };
  return (data.places ?? []).map(mapSearchResult);
}

/**
 * Place Details — full info for a single place.
 * Uses Enterprise tier (1K free calls/month). Only call for places the user cares about.
 */
export async function getPlaceDetails(
  options: GetPlaceDetailsOptions,
): Promise<PlaceDetails> {
  const { placeId, language } = options;

  const params = new URLSearchParams();
  if (language) params.set("languageCode", language);
  const qs = params.toString();

  const res = await pfetch(`${PLACES_BASE}/${placeId}${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": getApiKey(),
      "X-Goog-FieldMask": DETAIL_FIELDS,
    },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Places getDetails failed (${res.status}): ${error}`);
  }

  const raw = (await res.json()) as RawPlace;
  return mapPlaceDetails(raw);
}

/**
 * Compute Routes — directions between two points.
 * Uses Essentials tier (10K free calls/month).
 */
export async function computeRoute(
  options: ComputeRouteOptions,
): Promise<RouteResult | null> {
  const { origin, destination, travelMode = "DRIVE", language } = options;

  const body: Record<string, unknown> = {
    origin: { location: { latLng: origin } },
    destination: { location: { latLng: destination } },
    travelMode,
  };

  if (language) body.languageCode = language;

  const res = await pfetch(ROUTES_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getApiKey(),
      "X-Goog-FieldMask": ROUTE_FIELDS,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Routes computeRoutes failed (${res.status}): ${error}`);
  }

  const data = (await res.json()) as { routes?: RawRoute[] };
  const route = data.routes?.[0];
  if (!route) return null;

  return {
    distanceMeters: route.distanceMeters,
    duration: route.duration,
    polyline: route.polyline?.encodedPolyline,
    description: route.description,
    legs: (route.legs ?? []).map((leg) => ({
      distanceMeters: leg.distanceMeters,
      duration: leg.duration,
      startLocation: leg.startLocation.latLng,
      endLocation: leg.endLocation.latLng,
    })),
  };
}

// ---------------------------------------------------------------------------
// Raw API shapes (internal)
// ---------------------------------------------------------------------------

interface RawPlace {
  id?: string;
  name?: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: LatLng;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: {
    weekdayDescriptions?: string[];
    openNow?: boolean;
  };
  editorialSummary?: { text: string };
  reviews?: Array<{
    rating?: number;
    text?: { text: string };
    authorAttribution?: { displayName: string };
    relativePublishTimeDescription?: string;
  }>;
  googleMapsUri?: string;
}

interface RawRoute {
  distanceMeters: number;
  duration: string;
  polyline?: { encodedPolyline: string };
  description?: string;
  legs: Array<{
    distanceMeters: number;
    duration: string;
    startLocation: { latLng: LatLng };
    endLocation: { latLng: LatLng };
  }>;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapSearchResult(raw: RawPlace): PlaceSearchResult {
  return {
    id: placeId(raw),
    displayName: raw.displayName?.text ?? "",
    formattedAddress: raw.formattedAddress ?? "",
    location: raw.location ?? { latitude: 0, longitude: 0 },
    types: raw.types ?? [],
    rating: raw.rating,
    userRatingCount: raw.userRatingCount,
    priceLevel: raw.priceLevel,
  };
}

function mapPlaceDetails(raw: RawPlace): PlaceDetails {
  return {
    id: placeId(raw),
    displayName: raw.displayName?.text ?? "",
    formattedAddress: raw.formattedAddress ?? "",
    location: raw.location ?? { latitude: 0, longitude: 0 },
    types: raw.types ?? [],
    rating: raw.rating,
    userRatingCount: raw.userRatingCount,
    priceLevel: raw.priceLevel,
    websiteUri: raw.websiteUri,
    nationalPhoneNumber: raw.nationalPhoneNumber,
    regularOpeningHours: raw.regularOpeningHours
      ? {
          weekdayDescriptions: raw.regularOpeningHours.weekdayDescriptions ?? [],
          openNow: raw.regularOpeningHours.openNow,
        }
      : undefined,
    editorialSummary: raw.editorialSummary?.text,
    reviews: raw.reviews?.map((r) => ({
      rating: r.rating ?? 0,
      text: r.text?.text ?? "",
      authorAttribution: r.authorAttribution?.displayName ?? "",
      relativePublishTimeDescription: r.relativePublishTimeDescription ?? "",
    })),
    googleMapsUri: raw.googleMapsUri,
  };
}

/** Extract place ID — the API returns `name` as "places/{id}" or `id` directly. */
function placeId(raw: RawPlace): string {
  if (raw.id) return raw.id;
  if (raw.name) return raw.name.replace("places/", "");
  return "";
}
