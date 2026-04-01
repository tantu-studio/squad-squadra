# Squad Squadra — Roadmap

AI travel agent that plans complex trips through conversation.

The agent is Claude Code itself — no custom CLI or SDK wrapper needed. The project provides the structure, templates, and tooling so that any agent session can manage trips consistently.

## Architecture

```
trips/<trip-name>/          ← vault: structured markdown per trip
src/templates/              ← YAML/markdown templates per entity type
src/scripts/                ← CLI tools to create/manage trips and entities
```

### Trip Vault

Central knowledge store per trip. Structured markdown files with YAML frontmatter.

```
trips/cotswolds-2026/
├── trip.md                  # Dates, destination, status, summary
├── travelers/
│   ├── xavier.md            # Profile, preferences, dietary, budget
│   └── maria.md
├── places/
│   └── bourton-on-the-water.md
├── logistics/
│   ├── accommodation.md
│   ├── transport.md
│   └── budget.md
├── itinerary/
│   ├── day-1.md
│   └── day-2.md
├── research/
│   └── restaurants.md
├── docs/                    # Attached files — tickets, bookings, receipts, etc.
│   ├── ryanair-bcn-lhr.pdf
│   └── hotel-confirmation.pdf
├── attachments/
│   ├── ryanair-bcn-lhr.md   # Extracted info + metadata pointing to docs/ file
│   └── hotel-confirmation.md
└── decisions.md             # Log of confirmed decisions
```

Design principles:
- **Markdown-native.** Human-readable, zero lock-in.
- **Incrementally built.** Files created and updated as the trip evolves through conversation.
- **Agent-queryable.** Any Claude session can read the vault and have full context.
- **Source of truth.** The conversation is ephemeral; the vault persists.

---

## Phases

### Phase 1 — Vault Structure & Templates

Define the information architecture and provide templates for consistency.

- [x] Define vault folder structure
- [x] Create templates for each entity type (trip, traveler, place, accommodation, transport, budget, itinerary day, research, decision)
- [x] Define YAML frontmatter schemas per template

**Result:** Clear, documented structure. Any agent session knows how trip data should look.

### Phase 2 — Scripts & Tooling

CLI scripts to manage trips and entities without doing everything freehand.

- [x] `create-trip` — scaffold a new trip folder from templates
- [x] `add-traveler` — create a traveler file from template
- [x] `add-place` / `add-day` / etc. — entity creation helpers
- [x] `list-trips` — show existing trips and their status
- [ ] Whatever other CRUD operations make sense as we go

**Result:** Standardized operations. Trips are created consistently regardless of which agent session runs them.

### Phase 3 — API Research

Investigate what external data sources are available for enriching trip planning.

- [x] Research travel APIs — pricing, rate limits, access requirements, data quality (Google Maps, Yelp, TripAdvisor, OpenWeatherMap, Atlas Obscura, Timeout, Skyscanner, Booking, etc.)
- [x] Evaluate scraping vs API for sources without public APIs
- [x] Prioritize by value and feasibility

**Result:** Full research in [docs/api-research.md](docs/api-research.md). 15+ sources evaluated, 7 recommended for integration (all free-tier viable), clear integration order defined.
