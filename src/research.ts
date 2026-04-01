/**
 * Research file parser — reads persisted research data from trip vault files.
 *
 * Research files use a markdown format with YAML frontmatter and structured
 * entries. This module parses them back into typed objects so agents can
 * query and filter the data.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
