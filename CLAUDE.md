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
- `trips/` — Private trip data (gitignored, cloud-backed)

TypeScript, ESM, Node 20+. Uses Claude SDK for AI planning and external APIs (Google Maps, Atlas Obscura, Timeout) for real-world data.

## Conventions

See [Tantu base conventions](https://github.com/tantu-studio/tantu/blob/master/docs/CLAUDE_BASE.md).
