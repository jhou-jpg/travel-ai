# Task Plan: Travel AI — MVP Build

## Goal
Build an AI-powered travel planner that deeply analyzes TikTok/Instagram videos (frame extraction + audio transcription) to extract places, verifies them on Google Maps, and generates editorial itineraries. Long-term vision: Mindtrip-style persistent collections + chat-based planning. Current focus: polish the local experience before adding auth.

## Current Phase
Phase 6 — Shareable Links + Local Polish

## Product Vision (post-research, 2026-04-07)
**Phase 1 (NOW): Single-session trip builder** — add sources → review places → generate itinerary → share link
**Phase 2 (NEXT): Persistent collections** — save places over time, organize by destination/vibe, chat with AI to plan
**Phase 3 (LATER): Full Mindtrip competitor** — auth, collab boards, browser extension, booking links

## Phases

### Phase 1: Project Scaffold — COMPLETE
- [x] Next.js 16 + React 19 + TypeScript strict + Tailwind v4

### Phase 2: Ingestion + Vision Analysis — COMPLETE
- [x] `/api/analyze` — TikTok (ScrapCreators → ffmpeg frames → Whisper → vision), Instagram (same), generic URL (Cheerio), image upload
- [x] Prompt templates in `/lib/prompts/`

### Phase 3: Google Maps Integration — COMPLETE
- [x] Zod schemas, place resolver (Text Search + locationBias), enricher (Place Details)

### Phase 4: Multi-Input Collection — COMPLETE
- [x] Client-side state + localStorage, deduplication, insight merging from duplicates

### Phase 5: Itinerary Generation — COMPLETE
- [x] `/api/plan`, editorial prompt, Zod-validated output, constraint selectors (duration/pace)

### Phase 6: Local Polish (current)
- [x] "Midnight Magazine" editorial design system (terracotta palette, Noto Serif, sidebar nav)
- [x] Interactive zoomable Google Maps (Review + Itinerary) via @vis.gl/react-google-maps
- [x] Click place → zoom on map, auto-fit bounds, no ugly path lines
- [x] Destination hero photo from Google Maps (for /api/plan response)
- [x] Duplicate merge combines insights from multiple sources
- [x] Removed hero image from itinerary (focus on core UX)
- [ ] **Shareable links** — nanoid slug + Upstash Redis + `/trip/[slug]` page
- [ ] **Freeform text input** — third input mode
- [ ] **Server-side hours cross-check** — verify stops aren't scheduled when closed
- [ ] **Better model for generation** — consider upgrading from Qwen Flash for itinerary output quality
- [ ] **Error boundaries + loading states**
- [ ] **Mobile-responsive pass**
- **Status:** in progress

### Phase 7: Persistent Collections (v2 — requires auth)
- [ ] Upstash Redis or proper DB for per-user persistent place storage
- [ ] Auth (OAuth/email — lightweight)
- [ ] Collections/boards organized by destination or vibe
- [ ] Chat interface for conversational trip planning against user's collection
- [ ] Browser extension for one-click TikTok/IG save
- **Status:** future — polish local experience first

### Phase 8: Deploy
- [ ] Vercel + Upstash Redis production
- [ ] Shareable link smoke test
- **Status:** pending

## Key Decisions
| Decision | Rationale |
|----------|-----------|
| OpenRouter + Qwen 3.5 Flash for vision/text | ~100x cheaper than Claude; good enough for extraction |
| ScrapCreators API for TikTok/Instagram | Reliable metadata + video download URLs |
| ffmpeg + Whisper for video analysis | Our core differentiator — we actually watch the video |
| Client-side state (no auth yet) | Polish locally first, add persistence later |
| @vis.gl/react-google-maps for interactive maps | Zoomable, click-to-zoom, dark styled |
| Mindtrip-style vision for v2 | Collections + chat, but not before local UX is solid |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| TS: `Map` import shadowed built-in | Renamed to `GoogleMap` |
| `google.maps.SymbolPath.CIRCLE` undefined at render | Replaced with literal `0` |
| TS: category enum type mismatch | Cast to `ExtractedPlace["category"]` |
