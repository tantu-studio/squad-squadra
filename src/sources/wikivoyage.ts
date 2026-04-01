/**
 * Wikivoyage client — fetches and parses structured travel guides
 * via the MediaWiki API (en.wikivoyage.org).
 *
 * Wikivoyage articles follow a consistent structure:
 *   Understand → Get in → Get around → See → Do → Buy → Eat → Drink → Sleep → Stay safe → Connect → Go next
 *
 * Listings use multiple template formats:
 *   - Classic:  {{see|name=...|lat=...|content=...}}
 *   - Marker:   {{marker|type=see|name=...|lat=...|long=...}}
 *   - Generic:  {{listing|type=go|name=...|url=...}}
 *   - Capital:  {{Eat|name=...|content=...}}
 */

import { ProxyAgent } from "undici";

const API_BASE = "https://en.wikivoyage.org/w/api.php";
const USER_AGENT = "SquadSquadra/0.1 (travel-planner; contact@tantu.studio)";

const proxyUrl = process.env.HTTP_PROXY ?? process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

// -- Types ------------------------------------------------------------------

export interface WikivoyageListing {
  type: "see" | "do" | "eat" | "drink" | "sleep" | "buy" | "go" | "listing";
  name: string;
  alt?: string;
  url?: string;
  lat?: number;
  long?: number;
  directions?: string;
  phone?: string;
  email?: string;
  hours?: string;
  price?: string;
  description?: string;
}

export interface WikivoyageSection {
  title: string;
  level: number;
  content: string;
  listings: WikivoyageListing[];
}

export interface WikivoyageArticle {
  title: string;
  pageId: number;
  sections: WikivoyageSection[];
  raw: string;
}

// -- API fetching -----------------------------------------------------------

async function apiRequest(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    ...(dispatcher && { dispatcher }),
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`Wikivoyage API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch raw wikitext for a given article title.
 * Automatically follows #REDIRECT pages.
 * Returns null if the page doesn't exist.
 */
async function fetchWikitext(title: string): Promise<{ wikitext: string; pageId: number; resolvedTitle: string } | null> {
  const data = await apiRequest({
    action: "query",
    titles: title,
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    redirects: "1",
  }) as {
    query: {
      redirects?: Array<{ from: string; to: string }>;
      pages: Record<string, {
        pageid?: number;
        title?: string;
        missing?: string;
        revisions?: Array<{ slots: { main: { "*": string } } }>;
      }>;
    };
  };

  const pages = data.query.pages;
  const page = Object.values(pages)[0];

  if (!page || page.missing !== undefined || !page.revisions?.length) {
    return null;
  }

  return {
    wikitext: page.revisions[0].slots.main["*"],
    pageId: page.pageid!,
    resolvedTitle: page.title ?? title,
  };
}

/**
 * Search for destination articles. Returns matching titles.
 */
export async function searchDestinations(query: string, limit = 10): Promise<string[]> {
  const data = await apiRequest({
    action: "opensearch",
    search: query,
    limit: String(limit),
    namespace: "0",
  }) as [string, string[]];

  return data[1] ?? [];
}

// -- Wikitext parsing -------------------------------------------------------

/** Template names that directly indicate listing type */
const TYPED_TEMPLATES = ["see", "do", "eat", "drink", "sleep", "buy", "go"] as const;
/** Templates where the type comes from a `type=` parameter */
const GENERIC_TEMPLATES = ["marker", "listing"] as const;
const ALL_TEMPLATES = [...TYPED_TEMPLATES, ...GENERIC_TEMPLATES];

type ListingType = WikivoyageListing["type"];

function resolveListingType(templateName: string, typeParam?: string): ListingType {
  const normalized = templateName.toLowerCase();
  if ((TYPED_TEMPLATES as readonly string[]).includes(normalized)) {
    return normalized as ListingType;
  }
  // For marker/listing, use the type= param if it maps to a known type
  if (typeParam) {
    const t = typeParam.toLowerCase();
    if ((TYPED_TEMPLATES as readonly string[]).includes(t)) return t as ListingType;
  }
  return "listing";
}

/**
 * Parse a single listing template.
 * Handles all Wikivoyage formats:
 *   {{see|name=Foo|lat=1.23|content=Bar}}
 *   {{marker|type=see|name=Foo|lat=1.23}}
 *   {{listing|type=go|name=Foo|url=...}}
 *   {{Eat|name=Foo|content=Bar}}
 */
export function parseListing(templateName: string, templateBody: string): WikivoyageListing {
  const listing: WikivoyageListing = { type: "listing", name: "" };

  const params = splitTemplateParams(templateBody);
  let typeParam: string | undefined;

  for (const param of params) {
    const eqIdx = param.indexOf("=");
    if (eqIdx === -1) continue;

    const key = param.slice(0, eqIdx).trim().toLowerCase();
    const value = param.slice(eqIdx + 1).trim();
    if (!value) continue;

    switch (key) {
      case "type": typeParam = value; break;
      case "name": listing.name = value; break;
      case "alt": listing.alt = value; break;
      case "url": listing.url = value; break;
      case "lat": listing.lat = parseFloat(value) || undefined; break;
      case "long": listing.long = parseFloat(value) || undefined; break;
      case "directions": listing.directions = value; break;
      case "phone": listing.phone = value; break;
      case "email": listing.email = value; break;
      case "hours": listing.hours = value; break;
      case "price": listing.price = value; break;
      case "content": listing.description = cleanWikitext(value); break;
      case "address": listing.directions ??= value; break;
    }
  }

  listing.type = resolveListingType(templateName, typeParam);
  return listing;
}

/**
 * Split template parameters on `|` while respecting nested {{ }}, [[ ]], and {{ }}
 */
function splitTemplateParams(text: string): string[] {
  const params: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if ((ch === "{" && next === "{") || (ch === "[" && next === "[")) {
      depth++;
      current += ch + next;
      i++;
    } else if ((ch === "}" && next === "}") || (ch === "]" && next === "]")) {
      depth--;
      current += ch + next;
      i++;
    } else if (ch === "|" && depth === 0) {
      params.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  if (current) params.push(current);
  return params;
}

/**
 * Strip basic wikitext markup from a string.
 */
function cleanWikitext(text: string): string {
  return text
    // [[Link|Display]] → Display, [[Link]] → Link
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    // '''bold''' → bold, ''italic'' → italic
    .replace(/'{2,3}/g, "")
    // <ref>...</ref> and <ref ... />
    .replace(/<ref[^>]*>.*?<\/ref>/gs, "")
    .replace(/<ref[^/]*\/>/g, "")
    // HTML tags
    .replace(/<[^>]+>/g, "")
    // Remaining templates {{...}} — remove
    .replace(/\{\{[^}]*\}\}/g, "")
    .trim();
}

/**
 * Extract all listings from a block of wikitext.
 * Matches {{see|...}}, {{marker|type=see|...}}, {{listing|...}}, {{Eat|...}}, etc.
 */
function extractListings(wikitext: string): WikivoyageListing[] {
  const listings: WikivoyageListing[] = [];
  const pattern = new RegExp(
    `\\{\\{\\s*(${ALL_TEMPLATES.join("|")})\\s*\\|([\\s\\S]*?)\\}\\}`,
    "gi",
  );

  let match;
  while ((match = pattern.exec(wikitext)) !== null) {
    const templateName = match[1];
    const listing = parseListing(templateName, match[2]);
    if (listing.name) {
      listings.push(listing);
    }
  }

  return listings;
}

/**
 * Split wikitext into sections based on == headings ==.
 */
export function parseSections(wikitext: string): WikivoyageSection[] {
  const sections: WikivoyageSection[] = [];

  // Match lines like == Title == or === Title ===
  const headerRegex = /^(={2,})\s*(.+?)\s*\1\s*$/gm;
  const headers: Array<{ title: string; level: number; start: number }> = [];

  let headerMatch;
  while ((headerMatch = headerRegex.exec(wikitext)) !== null) {
    headers.push({
      title: headerMatch[2].trim(),
      level: headerMatch[1].length,
      start: headerMatch.index,
    });
  }

  // Content before the first header (intro)
  if (headers.length > 0 && headers[0].start > 0) {
    const introContent = wikitext.slice(0, headers[0].start).trim();
    if (introContent) {
      sections.push({
        title: "Introduction",
        level: 1,
        content: cleanWikitext(introContent),
        listings: extractListings(introContent),
      });
    }
  }

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i + 1].start : wikitext.length;
    const rawContent = wikitext.slice(header.start + wikitext.slice(header.start).indexOf("\n") + 1, nextStart).trim();

    sections.push({
      title: header.title,
      level: header.level,
      content: cleanWikitext(rawContent),
      listings: extractListings(rawContent),
    });
  }

  return sections;
}

// -- Public API -------------------------------------------------------------

/**
 * Fetch and parse a Wikivoyage article for a destination.
 *
 * @param destination - Destination name (e.g., "Barcelona", "Cotswolds", "Tokyo/Shibuya")
 * @returns Parsed article with sections and listings, or null if not found.
 */
export async function getDestination(destination: string): Promise<WikivoyageArticle | null> {
  const result = await fetchWikitext(destination);
  if (!result) return null;

  return {
    title: result.resolvedTitle,
    pageId: result.pageId,
    sections: parseSections(result.wikitext),
    raw: result.wikitext,
  };
}

/**
 * Get listings from specific sections of a destination article.
 * Only matches the exact section title (not subsections).
 */
export function getListingsBySection(
  article: WikivoyageArticle,
  ...sectionNames: string[]
): WikivoyageListing[] {
  const names = new Set(sectionNames.map((s) => s.toLowerCase()));
  return article.sections
    .filter((s) => names.has(s.title.toLowerCase()))
    .flatMap((s) => s.listings);
}

/**
 * Get listings from a top-level section and all its subsections.
 * E.g., getListingsUnder(article, "Eat") returns listings from "Eat",
 * "Budget", "Mid-range", "Splurge" etc.
 */
export function getListingsUnder(
  article: WikivoyageArticle,
  sectionName: string,
): WikivoyageListing[] {
  const name = sectionName.toLowerCase();
  const listings: WikivoyageListing[] = [];
  let collecting = false;
  let parentLevel = 0;

  for (const section of article.sections) {
    if (section.title.toLowerCase() === name) {
      collecting = true;
      parentLevel = section.level;
      listings.push(...section.listings);
    } else if (collecting) {
      if (section.level <= parentLevel) break; // Hit next sibling or higher
      listings.push(...section.listings);
    }
  }

  return listings;
}

/**
 * Get a text summary of a destination — intro + key sections, no listings.
 * Good for feeding to Claude as research context.
 */
export function getSummary(article: WikivoyageArticle): string {
  const keySections = ["Introduction", "Understand", "Get in", "Get around"];
  const parts: string[] = [`# ${article.title}\n`];

  for (const section of article.sections) {
    if (keySections.some((k) => k.toLowerCase() === section.title.toLowerCase())) {
      if (section.content) {
        parts.push(`## ${section.title}\n\n${section.content}\n`);
      }
    }
  }

  return parts.join("\n");
}
