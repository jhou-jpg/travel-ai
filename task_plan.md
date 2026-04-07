# Task Plan: Travel AI — MVP Build

## Goal
Build an AI-powered travel planner MVP that accepts messy input (screenshots, URLs, freeform notes) and produces a shareable day-by-day itinerary.

## Current Phase
Phase 5 — Itinerary Generation

## Phases

### Phase 1: Project Scaffold
- [x] Init Next.js 16 App Router project with TypeScript strict mode
- [x] Configure Tailwind CSS v4
- [x] Set up ESLint + tsconfig strict
- [x] Create folder structure: `/lib/ingestion`, `/lib/data`, `/lib/planning`, `/lib/prompts`, `/app/api/`
- [x] Create `.env.local.example` with env var keys
- [x] Install core dependencies: `zod`, `@anthropic-ai/sdk`, `cheerio`, `@upstash/redis`, `nanoid`
- **Status:** complete

### Phase 2: Ingestion + Vision Analysis (Layer 1)
- [x] **`/api/analyze` route** — unified ingestion endpoint (686 lines)
  - Image upload → base64 → vision model → place extraction
  - TikTok URL → ScrapCreators API → video download → ffmpeg frame extraction → Whisper transcription → vision analysis
  - Instagram URL → ScrapCreators API → carousel/reel handling → frame extraction → Whisper → vision analysis
  - Generic URL → Cheerio scrape → OG image + text → vision/text analysis
- [x] **`lib/prompts/screenshot-parse.ts`** — SCREENSHOT_PARSE_PROMPT + URL_CONTENT_PARSE_PROMPT
- [x] **`app/page.tsx`** — Working UI: image upload (drag-and-drop), URL input, rich results display
- **Deviation from original plan:** Uses OpenRouter + Qwen 3.5 Flash (not Anthropic Claude), ScrapCreators API (not Playwright), single `/api/analyze` (not separate ingest/extract endpoints)
- **Status:** complete

### Phase 3: Google Maps Integration (Data Layer)
- [x] **Zod schemas** — `/lib/data/schemas.ts`
  - ExtractedPlace, ResolvedPlace, EnrichedPlace types
  - ExtractionResultSchema validates LLM output
- [x] **Place resolver** — `/lib/data/place-resolver.ts`
  - Google Maps Places API (New) text search
  - Input: `{ name, location_hint }` → Output: `{ place_id, name, address, lat, lng, maps_url, verified: true }`
  - Unresolved → `{ verified: false }`, never silently drop
- [x] **Enricher** — `/lib/data/enricher.ts`
  - Google Maps Place Details: place_id → hours, rating, review_count, category, photo_url, price_level, website, phone
  - Failure → `{ enrichment_status: 'failed' }`, never hallucinate
- [x] **Wired into `/api/analyze`** — all 4 code paths (image, TikTok, Instagram, generic URL) run resolve → enrich
- [x] **UI updated** — enriched places show Maps links, photos, ratings, hours, verified/unverified badges
- **Status:** complete

### Phase 4: Multi-Input Collection + Session State
- [x] **Client-side state + localStorage** — no Redis needed yet
  - Accumulates places across multiple analyze calls
  - Persists to localStorage for page refresh recovery
  - "New trip" button to reset
- [x] **UI: trip builder** — redesigned `page.tsx`
  - Input bar always visible at top (URL / image tabs)
  - Sources list: what was added, place count, remove button
  - Unified deduplicated places list with all enriched data
  - Per-place remove button
  - "Plan my trip" CTA (placeholder for Phase 5)
- [x] **Deduplication** — by `place_id` for verified, by `name+hint` for unverified
- [x] **Chain restaurant fix** — `place-resolver.ts` geocodes `location_context` first, uses as `locationBias` (10km radius) for all Text Search requests
- [ ] **Freeform text input** — deferred (URL + image covers the core flow)
- **Status:** complete

### Phase 5: Itinerary Generation (Planning Layer)
- [ ] **Constraint parser** — `/lib/planning/constraint-parser.ts`
  - Short user prompt → dates, pace (relaxed/packed), travel style
  - Zod-validated output
- [ ] **Itinerary generator** — `/lib/planning/itinerary-generator.ts`
  - Enriched places + constraints → day-by-day JSON schedule
  - Cross-check hours before scheduling (flag conflicts)
  - Zod-validated output
- [ ] **Prompt templates** — `/lib/prompts/constraint-parse.ts`, `/lib/prompts/itinerary-generation.ts`
- [ ] **API route: `POST /api/plan`** — constraint-parser → itinerary-generator
- **Status:** pending

### Phase 6: Storage + Shareable Links
- [ ] **Output formatter** — `/lib/planning/output-formatter.ts`
  - nanoid slug generation
  - Store itinerary JSON in Upstash Redis (TTL 30 days)
- [ ] **Trip output page** — `/app/trip/[slug]/page.tsx`
  - Render day-by-day itinerary from Redis
  - Flag unverified places visually
  - Copy/share link button
  - "Try it yourself" viral CTA
- [ ] **API route: `GET /api/trip/[slug]`** or direct Redis read in page component
- **Status:** pending

### Phase 7: Polish + Quality
- [ ] Zod-validate ALL LLM outputs end-to-end
- [ ] Error boundaries + loading states in UI
- [ ] Mobile-responsive pass on all pages
- [ ] Hours cross-check: warn if scheduling a venue when it's closed
- [ ] Cost tracking dashboard / logging
- **Status:** pending

### Phase 8: Deploy
- [ ] Configure Vercel project + env vars
- [ ] Configure Upstash Redis production instance
- [ ] Deploy and smoke-test live URL
- [ ] Verify shareable trip link works end-to-end
- **Status:** pending

## Key Questions
1. ~~Use Claude vision or Google Cloud Vision API for screenshots?~~ → Resolved: OpenRouter + Qwen vision (cheap)
2. ~~TikTok URLs: Cheerio or Playwright?~~ → Resolved: ScrapCreators API
3. Upstash Redis TTL for anonymous trips: 30 days? (Confirmed)
4. Google Maps Places API (New) vs legacy — need to confirm billing + quotas
5. Should multi-input state live client-side or in Redis sessions?
6. Should the analyze endpoint be refactored into proper `/lib/ingestion/` modules, or keep the monolith working?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| OpenRouter + Qwen 3.5 Flash for vision/text | ~100x cheaper than Claude; fast; good enough for extraction |
| ScrapCreators API for TikTok/Instagram | Reliable metadata + video URLs; no headless browser infra |
| Whisper for audio transcription | Captures voiceover content from travel reels |
| ffmpeg frame extraction (~0.5fps) | Visual analysis of video content; catches signage, food, landmarks |
| Single `/api/analyze` endpoint | Simpler than separate ingest/extract; can refactor later if needed |
| Upstash Redis for storage | Anonymous sessions + shareable trips; no DB needed for MVP |
| nanoid for shareable slugs | URL-safe, short, collision-resistant |
| Flag unverified/failed places | Never silently drop — transparency builds trust |
| No SSE streaming in v1 | Simple POST/response sufficient |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | — | — |

## Notes
- Week 1 DoD: TikTok URL or screenshot → JSON array of resolved, enriched place objects
- The ingestion layer is the strongest part — video extraction pipeline is genuinely impressive
- Next critical path: Google Maps integration turns fuzzy place names into real, verified data
- Multi-input collection is what makes this a trip planner vs. a single-URL analyzer
