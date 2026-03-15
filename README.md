# Squad Squadra

AI travel agent that builds complex trip plans from real-world constraints — group dynamics, personal tastes, logistics.

## What it does

You describe a trip situation (who's going, what they like, constraints, dates) and Squad Squadra produces a detailed, opinionated travel plan. It integrates with real data sources (maps, reviews, hidden gems) and handles the messy reality of group travel — different budgets, interests, dietary needs, energy levels.

## Quick start

```bash
cp .env.example .env
# Fill in your API keys
npm install
npm run dev
```

## Trip data

The `trips/` folder stores private travel data per user. It's gitignored — back it up to your cloud storage of choice.

## Requirements

- Node.js 20+
- Anthropic API key
- Google Maps API key (for routing and places)

---

**[Tantu](https://tantu.studio)** — One thread, many structures.
