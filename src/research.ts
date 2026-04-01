/**
 * Research file parser — reads persisted research data from trip vault files.
 *
 * Research files use a markdown format with YAML frontmatter and structured
 * entries. This module parses them back into typed objects so agents can
 * query and filter the data.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { type LatLng, filterByDistance } from "./geo.js";
import { type PlacePreview, searchArea } from "./sources/atlas-obscura.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResearchPlace {
  name: string;
  summary: string;
  location: string;
  coordinates: LatLng;
  distanceFromCenter: number;
  url: string;
}

export interface NearbyPlace {
  name: string;
  source: "atlas-obscura" | "wikivoyage";
  type: string;
  coordinates: LatLng;
  distanceKm: number;
  description?: string;
  url?: string;
  phone?: string;
  email?: string;
  hours?: string;
  price?: string;
  directions?: string;
  section?: string;
  article?: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a persisted Atlas Obscura research file into structured place objects.
 *
 * Expects the format written by the Atlas Obscura fetch script:
 * ```
 * ### Place Name
 * One-line summary.
 * - **Location:** City, Country (lat, lng)
 * - **Distance from center:** 3.46 km
 * - **URL:** https://...
 * ```
 */
export function parseAtlasObscuraResearch(filePath: string): ResearchPlace[] {
  const content = readFileSync(filePath, "utf-8");
  const places: ResearchPlace[] = [];

  const blocks = content.split(/^### /m).slice(1); // skip header

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const name = lines[0]?.trim() ?? "";
    const summary = lines[1]?.trim() ?? "";

    let location = "";
    let lat = 0;
    let lng = 0;
    let distance = 0;
    let url = "";

    for (const line of lines) {
      const locMatch = line.match(/\*\*Location:\*\*\s*(.+?)\s*\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)/);
      if (locMatch) {
        location = locMatch[1];
        lat = parseFloat(locMatch[2]);
        lng = parseFloat(locMatch[3]);
      }

      const distMatch = line.match(/\*\*Distance from center:\*\*\s*([\d.]+)\s*km/);
      if (distMatch) {
        distance = parseFloat(distMatch[1]);
      }

      const urlMatch = line.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
      if (urlMatch) {
        url = urlMatch[1];
      }
    }

    places.push({ name, summary, location, coordinates: { lat, lng }, distanceFromCenter: distance, url });
  }

  return places;
}

/**
 * Load Atlas Obscura research and return places within a radius of a point.
 *
 * @example
 * ```ts
 * // "What's interesting within 5km of Bourton-on-the-Water?"
 * const nearby = nearbyFromResearch(
 *   "trips/2026-04-cotswolds/research/atlas-obscura.md",
 *   { lat: 51.8821, lng: -1.7529 },
 *   5,
 * );
 * ```
 */
export function nearbyFromResearch(
  filePath: string,
  center: LatLng,
  radiusKm: number,
): Array<ResearchPlace & { distanceKm: number }> {
  const places = parseAtlasObscuraResearch(filePath);
  return filterByDistance(places, (p) => p.coordinates, center, radiusKm);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Serialize Atlas Obscura places to the canonical research markdown format.
 *
 * This is the format that `parseAtlasObscuraResearch` reads back —
 * the two functions are a matched pair. Always use this to write
 * Atlas Obscura research files.
 */
export function formatAtlasObscuraResearch(
  places: PlacePreview[],
  center: LatLng,
  radiusKm: number,
): string {
  const today = new Date().toISOString().slice(0, 10);

  let md = `---
topic: atlas-obscura
source: atlas-obscura
center: '${center.lat}, ${center.lng}'
radius_km: ${radiusKm}
fetched: '${today}'
total: ${places.length}
---

# Atlas Obscura — Area Search

Hidden gems and unusual places within ${radiusKm}km of center (${center.lat}, ${center.lng}).
Each entry includes coordinates for proximity planning.

`;

  for (const p of places) {
    md += `### ${p.title}\n`;
    md += `${p.subtitle}\n`;
    md += `- **Location:** ${p.location} (${p.coordinates.lat}, ${p.coordinates.lng})\n`;
    md += `- **Distance from center:** ${p.distance} km\n`;
    md += `- **URL:** https://www.atlasobscura.com${p.url}\n`;
    md += `\n`;
  }

  return md;
}

/**
 * Fetch Atlas Obscura places within a radius and write to a research file.
 *
 * This is the end-to-end function: scrape → format → write.
 *
 * @returns Number of places written.
 *
 * @example
 * ```ts
 * // Fetch hidden gems within 50km of the Cotswolds center
 * const count = await fetchAndWriteAtlasObscura(
 *   "trips/2026-04-cotswolds/research/atlas-obscura.md",
 *   { lat: 51.9299, lng: -1.7246 },
 *   50,
 * );
 * ```
 */
export async function fetchAndWriteAtlasObscura(
  filePath: string,
  center: LatLng,
  radiusKm = 50,
): Promise<number> {
  const places = await searchArea({ ...center, radiusKm });
  const md = formatAtlasObscuraResearch(places, center, radiusKm);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, md);
  return places.length;
}

// ---------------------------------------------------------------------------
// Wikivoyage parsing
// ---------------------------------------------------------------------------

interface WikivoyageParsedListing {
  name: string;
  type: string;
  lat?: number;
  lng?: number;
  description?: string;
  url?: string;
  phone?: string;
  email?: string;
  hours?: string;
  price?: string;
  directions?: string;
  alt?: string;
  section: string;
  article: string;
}

/**
 * Parse a dumped Wikivoyage article file and extract all listings with coordinates.
 */
export function parseWikivoyageResearch(filePath: string): WikivoyageParsedListing[] {
  const content = readFileSync(filePath, "utf-8");
  const listings: WikivoyageParsedListing[] = [];

  // Extract article title from frontmatter
  const titleMatch = content.match(/^title:\s*"(.+)"$/m);
  const article = titleMatch?.[1] ?? "";

  // Track current section heading
  let currentSection = "";
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    // Track section headings
    const headingMatch = lines[i].match(/^#{2,}\s+(.+)$/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      continue;
    }

    // Match listing line: - **Name**
    const nameMatch = lines[i].match(/^- \*\*(.+?)\*\*$/);
    if (!nameMatch) continue;

    const listing: WikivoyageParsedListing = {
      name: nameMatch[1],
      type: "listing",
      section: currentSection,
      article,
    };

    // Next line has metadata: type: see | coords: 51.93, -1.724 | phone: ...
    const metaLine = lines[i + 1];
    if (metaLine && metaLine.startsWith("  ")) {
      const meta = metaLine.trim();

      const typeMatch = meta.match(/(?:^|\| )type: (\w+)/);
      if (typeMatch) listing.type = typeMatch[1];

      const coordsMatch = meta.match(/coords: (-?[\d.]+), (-?[\d.]+)/);
      if (coordsMatch) {
        listing.lat = parseFloat(coordsMatch[1]);
        listing.lng = parseFloat(coordsMatch[2]);
      }

      const phoneMatch = meta.match(/(?:^|\| )phone: ([^|]+)/);
      if (phoneMatch) listing.phone = phoneMatch[1].trim();

      const emailMatch = meta.match(/(?:^|\| )email: ([^|]+)/);
      if (emailMatch) listing.email = emailMatch[1].trim();

      const urlMatch = meta.match(/(?:^|\| )url: ([^|]+)/);
      if (urlMatch) listing.url = urlMatch[1].trim();

      const hoursMatch = meta.match(/(?:^|\| )hours: ([^|]+)/);
      if (hoursMatch) listing.hours = hoursMatch[1].trim();

      const priceMatch = meta.match(/(?:^|\| )price: ([^|]+)/);
      if (priceMatch) listing.price = priceMatch[1].trim();

      const dirMatch = meta.match(/(?:^|\| )directions: ([^|]+)/);
      if (dirMatch) listing.directions = dirMatch[1].trim();

      const altMatch = meta.match(/(?:^|\| )alt: ([^|]+)/);
      if (altMatch) listing.alt = altMatch[1].trim();
    }

    // Line after metadata might be the description
    const descIdx = metaLine?.startsWith("  ") ? i + 2 : i + 1;
    const descLine = lines[descIdx];
    if (descLine && descLine.startsWith("  ") && !descLine.match(/^- \*\*/)) {
      listing.description = descLine.trim();
    }

    listings.push(listing);
  }

  return listings;
}

// ---------------------------------------------------------------------------
// Unified nearby search
// ---------------------------------------------------------------------------

export interface NearbyFilter {
  /** Wikivoyage listing types: "see", "do", "eat", "drink", "sleep", "buy" */
  types?: string[];
  /** Sources to include. Defaults to all. */
  sources?: Array<"atlas-obscura" | "wikivoyage">;
}

/**
 * Find places near a point from all research sources in a trip's research folder.
 *
 * Reads Atlas Obscura and Wikivoyage research files and returns a unified
 * list sorted by distance, with the source identified on each result.
 *
 * @example
 * ```ts
 * // Everything within 5km
 * nearbyPlaces("trips/.../research", center, 5);
 *
 * // Just restaurants and pubs within 2km
 * nearbyPlaces("trips/.../research", center, 2, { types: ["eat", "drink"] });
 *
 * // Only Atlas Obscura hidden gems
 * nearbyPlaces("trips/.../research", center, 10, { sources: ["atlas-obscura"] });
 * ```
 */
export function nearbyPlaces(
  researchDir: string,
  center: LatLng,
  radiusKm: number,
  filter?: NearbyFilter,
): NearbyPlace[] {
  const allowedTypes = filter?.types ? new Set(filter.types.map((t) => t.toLowerCase())) : null;
  const allowedSources = filter?.sources ? new Set(filter.sources) : null;
  const results: NearbyPlace[] = [];

  // Atlas Obscura
  if (!allowedSources || allowedSources.has("atlas-obscura")) {
    // Atlas Obscura places pass type filter if "hidden-gem" is in types, or no type filter is set
    const atlasPassesType = !allowedTypes || allowedTypes.has("hidden-gem");
    if (atlasPassesType) {
      const atlasFile = join(researchDir, "atlas-obscura.md");
      if (existsSync(atlasFile)) {
        const places = parseAtlasObscuraResearch(atlasFile);
        const nearby = filterByDistance(places, (p) => p.coordinates, center, radiusKm);
        for (const p of nearby) {
          results.push({
            name: p.name,
            source: "atlas-obscura",
            type: "hidden-gem",
            coordinates: p.coordinates,
            distanceKm: p.distanceKm,
            description: p.summary,
            url: p.url,
          });
        }
      }
    }
  }

  // Wikivoyage — scan all files in wikivoyage/ subfolder
  if (!allowedSources || allowedSources.has("wikivoyage")) {
    const wikiDir = join(researchDir, "wikivoyage");
    if (existsSync(wikiDir)) {
      const files = readdirSync(wikiDir).filter((f) => f.endsWith(".md") && f !== "_index.md");
      for (const file of files) {
        const listings = parseWikivoyageResearch(join(wikiDir, file));
        const withCoords = listings.filter((l) => l.lat != null && l.lng != null);
        const filtered = allowedTypes
          ? withCoords.filter((l) => allowedTypes.has(l.type.toLowerCase()))
          : withCoords;
        const nearby = filterByDistance(
          filtered,
          (l) => ({ lat: l.lat!, lng: l.lng! }),
          center,
          radiusKm,
        );
        for (const l of nearby) {
          results.push({
            name: l.name,
            source: "wikivoyage",
            type: l.type,
            coordinates: { lat: l.lat!, lng: l.lng! },
            distanceKm: l.distanceKm,
            description: l.description,
            url: l.url,
            phone: l.phone,
            email: l.email,
            hours: l.hours,
            price: l.price,
            directions: l.directions,
            section: l.section,
            article: l.article,
          });
        }
      }
    }
  }

  // Sort everything by distance
  results.sort((a, b) => a.distanceKm - b.distanceKm);
  return results;
}
