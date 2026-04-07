# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Build & Dev Commands

- `npm run dev` — Start dev server (port 3000)
- `npm run build` — Production build
- `npm run start` — Run production build
- `npm run lint` — Run ESLint (flat config, ESLint v9)
- No test runner configured yet; `__tests__/` directory exists for future tests

## Architecture

Travel AI MVP — an AI-powered travel planner that converts TikTok URLs, screenshots, and text into enriched itineraries with shareable links.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript (strict) + Tailwind CSS v4 + Upstash Redis + Claude API + Google Maps API

### Three-Layer Processing Pipeline

```
Layer 1: INGESTION (/lib/ingestion/) → /api/ingest
  screenshot-parser  — Claude vision: base64 image → raw text
  url-parser         — Cheerio (static) / Playwright (JS-rendered TikTok/Instagram)
  text-input         — normalize whitespace

Layer 2: DATA ENRICHMENT (/lib/data/) → /api/extract
  entity-extractor   — Claude: raw text → structured entities (Zod-validated)
  place-resolver     — Google Maps text search: name + hint → place_id + coords
  enricher           — Google Maps Place Details: place_id → hours, rating, photos, price

Layer 3: PLANNING (/lib/planning/) → /api/plan
  constraint-parser  — Claude: user prompt → dates, pace, style
  itinerary-generator — Claude: enriched places + constraints → day-by-day JSON
  output-formatter   — nanoid slug + Redis store (TTL 30 days) → shareable URL
```

### Key Conventions

- **Zod-validate all LLM outputs** — Claude returns unreliable JSON; every response must be parsed through a Zod schema before use.
- **Never drop data** — Unverified places render with `verified: false`; failed enrichments with `enrichment_status: 'failed'`. Transparency over silence.
- **Never hallucinate place data** — Only use Google Maps API data for addresses, hours, phone numbers.
- **Prompt templates in `/lib/prompts/`** — All LLM prompts are exported constants, never inlined.
- **No streaming in v1** — Simple POST/response pattern; SSE streaming planned for v2.
- **No auth in v1** — Anonymous sessions via Upstash Redis.

### Environment Variables

See `.env.local.example`: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `SCRAPECREATORS_API_KEY`

### Path Alias

`@/*` maps to the project root (configured in tsconfig.json).

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
