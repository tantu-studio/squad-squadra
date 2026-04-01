# Phase 3 — API Research

Research on external data sources for enriching trip planning.

**Scope assumption:** Flights and hotels are already booked. The agent plans everything else — itinerary, places, activities, food, local transport.

---

## Priority Matrix

| Priority | Source | Category | Cost | Access | Value |
|----------|--------|----------|------|--------|-------|
| 1 | **Wikivoyage** | Destination guides | Free (CC BY-SA) | Data dump / API | Structured bulk content |
| 2 | **Google Maps (Places + Routes)** | Places, routing | Free tier for light use | Self-service API key | Discovery + routing |
| 3 | **Atlas Obscura** | Hidden gems | Scraping only | No API | Unique curated content |
| 4 | **OpenWeatherMap** | Historical weather | 1M calls/mo free | Self-service API key | Seasonal planning |
| 5 | **Rome2Rio** | Local/regional transport | Free tier available | API key | Multi-modal A-to-B routing |
| 6 | **Viator** | Bookable experiences | Free (earns commission) | Affiliate signup | Activities with real prices |
| — | TripAdvisor | Attractions, restaurants | 5K calls/mo free | Approval required (B2C only) | Good data, access friction |
| — | Yelp | US restaurants | $8-15/1K calls, no free tier | Paid plans only | US-centric, expensive |
| — | Numbeo | Cost of living | $260+/month | Paid only | Too expensive |
| — | Time Out | City guides | Scraping only | No API | Claude covers this |

**Out of scope (flights & hotels):** Amadeus, Kiwi.com Tequila, Skyscanner, Booking.com, Google Flights.

---

## Tier 1 — Core (integrate first)

### Wikivoyage

142K+ travel articles with structured sections (Get in, Get around, See, Do, Eat, Sleep). Open license.

**What you get:**
- Complete destination guides with GPS coordinates
- Structured format maps perfectly to trip vault entities
- Listings data available as CSV/XML/GPX on GitHub

**Pricing:** Free. CC BY-SA 4.0.

**Access options:**
- Full data dump: `dumps.wikimedia.org/enwikivoyage` (<100MB for all English articles)
- MediaWiki API: `en.wikivoyage.org/w/api.php` (~1 req/30s recommended)
- Wikimedia Enterprise free tier: 5K on-demand requests/month

**Data quality:** Excellent for popular destinations, thin for obscure ones. Structured format is a major advantage for parsing.

**Why #1:** Massive amount of structured travel data for free, downloadable in bulk. The See/Do/Eat/Sleep sections map directly to our vault structure.

### Google Maps Platform

Places API (New) + Routes API. The richest on-demand place data source.

**What you get:**
- Text Search with natural language ("best ramen in Shibuya")
- Place Details: hours, reviews, ratings, price level, photos, accessibility, AI summaries (Gemini)
- Routes: traffic-aware directions, multi-stop optimization, distance matrices

**Pricing reality — the free tier is useful but limited:**

| What you need | SKU | Free/month | Cost per 1K after |
|---------------|-----|-----------|-------------------|
| Search for places (IDs only) | Text Search Essentials | **Unlimited** | Free |
| Search with names, addresses, types | Text Search Pro | 5,000 | $32 |
| Basic place info (name, address, location) | Place Details Essentials | 10,000 | $5 |
| Hours, ratings, price level, phone, website | Place Details Enterprise | **1,000** | $20 |
| Reviews, AI summaries, editorial content | Place Details Enterprise + Atmosphere | **1,000** | $25 |
| Route between two points | Compute Routes Essentials | 10,000 | $5 |
| Traffic-aware routing | Compute Routes Pro | 5,000 | $10 |

**Bottom line:** For a trip with 10-50 place lookups and 5-10 routes, the free tier covers it. The useful data (reviews, hours, ratings) comes from the Enterprise tier at 1,000 free calls/month — enough for ~20-50 trips/month if we're selective about which places get full detail lookups. Beyond that, costs escalate fast ($20-25/1K).

**Strategy:** Use Text Search to discover places, but fetch Enterprise details only for top candidates the user is actually considering — not for every search result.

**Rate limits:** 3K-6K QPM. No daily caps.

**Access:** API key + billing account. Self-service, no approval needed.

### Atlas Obscura

Curated collection of unusual, hidden, and remarkable places worldwide. Content you won't find anywhere else.

**API:** None. No official API exists.

**Scraping assessment:**
- `robots.txt` allows `/places/*` detail pages
- GPTBot and Node/simplecrawler are explicitly blocked
- Sitemap available at `atlasobscura.com/sitemaps/sitemap_index.xml.gz`
- Unofficial npm package exists: `atlas-obscura-api`
- ToS likely prohibits scraping — legal grey area

**Data quality:** Excellent. Human-curated, unique "hidden gems" content. This is their differentiator — unusual attractions that mainstream travel sources miss entirely.

**Approach:** Scrape place detail pages, cache aggressively, respect rate limits. Use sitemap for discovery. Alternatively, consider whether Claude's training data already contains enough Atlas Obscura content to be useful without scraping (it likely has substantial coverage of their more popular entries).

**Why essential:** No other source provides this type of curated unusual-places content. It's exactly what makes a trip plan feel special rather than generic.

---

## Tier 2 — High value, easy to add

### OpenWeatherMap

**What you get:** Current weather, forecasts, and — critically — **40+ years of historical data**.

**Why historical matters:** We plan trips weeks/months ahead. Forecasts beyond 5-7 days are unreliable. But historical averages ("Barcelona in late October typically has 20°C highs, 4 rainy days") are solid for seasonal planning and activity recommendations.

**Free tier:** 1M calls/month, 60 calls/min. One Call 3.0: 1K calls/day free (bundles current + forecast + historical + alerts in one request).

**Access:** Instant API key. Standard REST/JSON.

**Use cases:**
- "Should we plan outdoor activities for this day?" → historical rain probability
- "What to pack?" → historical temperature ranges
- "Best time of day for X?" → historical sunshine/cloud patterns

### Rome2Rio

**What you get:** Multi-modal transport between any two points — trains, buses, ferries, driving, and combinations. Durations and indicative prices.

**Why it matters:** The only source that answers "how do I get from Siena to San Gimignano?" with all local transport options. Essential for building realistic day-by-day itineraries with actual transport logistics.

**Free tier:** Available via `free.rome2rio.com/api/1.4/json/Search`. Also on RapidAPI.

**Access:** API key required.

**Note:** Flight routing data is also included but out of scope for us — we'd use it purely for ground/water transport.

---

## Tier 3 — Worth integrating later

### Viator (TripAdvisor Experiences)

**What you get:** 300K+ bookable experiences in 200+ countries. Real prices, availability, reviews.

**Pricing:** Free access. 8-12% commission on bookings.

**Access levels:** Basic Affiliate (instant, content/search only) → Full Affiliate → Booking Affiliate.

**Value:** Goes beyond "things to do" recommendations into actionable bookings with real prices. Useful when the agent reaches the point of actually helping book activities.

### TripAdvisor Content API

**What you get:** Restaurants, attractions globally. Ratings, rankings, subratings, up to 5 reviews per location.

**Pricing:** 5K calls/month free, then pay-as-you-go.

**Friction:** B2C only — requires consumer-facing website/app with working URL. Manual approval process. Must display TripAdvisor branding.

**Verdict:** Good data, annoying access requirements. Skip unless we build a public-facing interface.

---

## Scraping vs API Assessment

| Source | API? | Scraping viable? | Recommendation |
|--------|------|-------------------|----------------|
| Atlas Obscura | No | Yes — `robots.txt` allows `/places/*`, sitemap available | Scrape cautiously, cache aggressively. Essential content. |
| Time Out | No | Possible but high effort | **Skip.** Claude's training data covers this. |
| Numbeo | Yes but $260+/mo | Unofficial scrapers on GitHub | **Skip.** Claude can approximate cost comparisons. |

**General guidance:** Only Atlas Obscura justifies scraping effort due to truly unique, irreplaceable content. Everything else has either a proper API or Claude covers it well enough.

---

## Agent Workflow

How the data sources fit into the trip planning process:

### Step 1 — Area research (trip initialization)

**Source: Wikivoyage**

When a trip is created, pull up to ~5 Wikivoyage guides for the destination and surrounding area. Read them, summarize what's interesting: key sights, neighborhoods, food specialties, local transport tips. This becomes the trip's research baseline — a broad picture of what the area offers.

### Step 2 — Place discovery & details

**Sources: Google Maps + Atlas Obscura**

With the Wikivoyage overview as context, search for specific places to visit:
- **Google Maps** for concrete details — opening hours, ratings, reviews, exact locations, photos
- **Atlas Obscura** for hidden gems and unusual places that mainstream sources miss

This is the core of "what to visit." The combination of Google Maps (mainstream, detailed) + Atlas Obscura (curated, unusual) gives both breadth and character.

### Step 3 — Route planning

**Source: Rome2Rio**

Once we know what to visit, plan how to get between places. Rome2Rio provides multi-modal transport options (train, bus, ferry, driving) with durations and indicative prices. Essential for building realistic day-by-day itineraries.

### Step 4 — Restaurants & activities

**Sources: Google Maps + TripAdvisor/Viator**

A separate phase focused on where to eat and what to do:
- **Google Maps** for restaurant search, ratings, price levels
- **TripAdvisor** for restaurant rankings and reviews (if API access is obtained)
- **Viator** for bookable experiences with real prices (later)

### Lateral — Weather context

**Source: OpenWeatherMap (historical data)**

Not a core step but useful context: historical weather patterns for the destination during the travel dates. Helps with "should we plan outdoor activities?" and "what to pack?" decisions. Planning happens weeks/months ahead so forecasts are useless — historical averages are what matter.

---

## Usage Estimate

At 3-4 trips per year:

| Source | Calls per trip | Annual calls | Free tier |
|--------|---------------|-------------|-----------|
| Wikivoyage | ~5-10 | ~30 | Unlimited (data dump) |
| Google Maps (search) | ~20-30 | ~100 | 5K/mo Text Search Pro |
| Google Maps (details) | ~30-50 | ~150 | 1K/mo Enterprise |
| Google Maps (routes) | ~10-15 | ~50 | 10K/mo |
| Atlas Obscura | ~10-20 | ~60 | N/A (scraping) |
| Rome2Rio | ~5-10 | ~30 | Free tier |
| OpenWeatherMap | ~3-5 | ~15 | 1M/mo |

**Conclusion:** We won't come close to any free tier limit. Google Maps Enterprise (the most restrictive at 1K/month) would need ~20+ trips/month to exceed. At our volume, the entire stack is free.

---

## Integration Order

1. **Wikivoyage** — data dump + parser. Foundation for area research.
2. **Google Maps** — Places + Routes API. On-demand details and routing.
3. **Atlas Obscura** — scraper. Hidden gems enrichment.
4. **Rome2Rio** — transport routing for itineraries.
5. **OpenWeatherMap** — historical weather context.
6. **TripAdvisor / Viator** — restaurants and bookable experiences (when needed).
