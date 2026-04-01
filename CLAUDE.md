# Squad Squadra

AI travel agent — plans complex trips from real-world constraints.

## Commands

```bash
npm run build        # TypeScript → dist/
npm run dev          # Dev mode with watch
npm run lint         # ESLint
npm run test         # Vitest
```

## Architecture

- `src/` — Agent logic, integrations, trip planning engine
- `src/sources/` — Data source integrations (Wikivoyage, Atlas Obscura)
- `src/services/` — API clients (Google Maps, Rome2Rio)
- `src/geo.ts` — Geo utilities (haversine distance, spatial filtering)
- `src/research.ts` — Read/write persisted research files from trip vaults
- `trips/` — Private trip data (gitignored, cloud-backed)

TypeScript, ESM, Node 20+. Uses Claude SDK for AI planning and external APIs (Google Maps, Atlas Obscura, Wikivoyage, Rome2Rio) for real-world data.

## Working with research data

Research data is persisted as markdown in each trip's `research/` folder. The key functions in `src/research.ts`:

- **`fetchAndWriteAtlasObscura(filePath, center, radiusKm)`** — Scrapes Atlas Obscura for places within a radius of a center point and writes them to a research file. Use this when starting research for a new area.
- **`nearbyFromResearch(filePath, point, radiusKm)`** — Loads a persisted research file and returns places within a radius of any point, sorted by distance. Use this to answer "what's interesting near X?".
- **`parseAtlasObscuraResearch(filePath)`** — Parses a research file into typed `ResearchPlace` objects with coordinates.
- **`filterByDistance(items, getCoords, center, radiusKm)`** — Generic spatial filter from `src/geo.ts`. Works on any array with coordinates.

Example: "What Atlas Obscura places are within 5km of Bourton-on-the-Water?"
```ts
import { nearbyFromResearch } from "./research.js";
const nearby = nearbyFromResearch(
  "trips/2026-04-cotswolds/research/atlas-obscura.md",
  { lat: 51.8821, lng: -1.7529 },
  5,
);
```

## Itinerary structure

Itineraries live in each trip's `itinerary/` folder, not as a single file in the trip root.

- **`itinerary/_index.md`** — Overview: at-a-glance table, booked meals, links to daily files.
- **`itinerary/day-N.md`** — One file per day. Frontmatter has `day`, `date` (YYYY-MM-DD), and `title`.

Daily files start as lightweight summaries (stops, meals, key highlights). When the user requests a deep dive, expand that day's file with timing suggestions, detailed stop descriptions, practical info (hours, prices, tips), and hidden gems from research data. Use the `/daily-itinerary` skill for writing detailed daily files.

## Conventions

See [Tantu base conventions](https://github.com/tantu-studio/tantu/blob/master/docs/CLAUDE_BASE.md).
