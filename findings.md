# Findings & Decisions — Travel AI

## Architecture: What Actually Exists

### Actual Stack (differs from original plan)
- **Framework:** Next.js 16 + React 19 + TypeScript strict + Tailwind CSS v4
- **LLM:** OpenRouter API → Qwen 3.5 Flash (vision + text) — NOT Anthropic Claude
- **Video scraping:** ScrapCreators API (TikTok + Instagram) — NOT Playwright
- **Audio transcription:** OpenAI Whisper — not in original plan
- **Video frames:** ffmpeg (local, frame extraction at ~0.5fps) — not in original plan
- **URL scraping:** Cheerio (generic URLs only)
- **Storage (planned):** Upstash Redis — not wired up yet
- **Validation:** zod installed but NOT used yet (raw JSON regex parsing)

### Actual File Map
```
app/
  api/
    analyze/route.ts    ← 686-line unified ingestion endpoint (WORKING)
  page.tsx              ← 522-line UI with image upload + URL input (WORKING)
  layout.tsx            ← Standard layout
lib/
  prompts/
    screenshot-parse.ts ← SCREENSHOT_PARSE_PROMPT + URL_CONTENT_PARSE_PROMPT
  data/                 ← EMPTY — needs schemas, place-resolver, enricher
  ingestion/            ← EMPTY — logic lives in /api/analyze monolith
  planning/             ← EMPTY — needs constraint-parser, itinerary-generator
```

### Environment Variables (actual)
```
OPENROUTER_API_KEY      ← primary LLM provider
OPENAI_API_KEY          ← Whisper transcription (optional fallback)
GOOGLE_MAPS_API_KEY     ← not used yet, needed for Phase 3
SCRAPECREATORS_API_KEY  ← TikTok + Instagram data extraction
```

## Ingestion Pipeline Details

### TikTok Flow (working)
```
URL → ScrapCreators /v2/tiktok/video (get_transcript=true)
  → caption, author, stats, video download URL, transcript
  → Download video → ffmpeg extract frames (0.5fps, max 60)
  → If no transcript: Whisper fallback
  → All frames + caption + transcript → OpenRouter vision → place extraction JSON
```

### Instagram Flow (working)
```
URL → ScrapCreators /v1/instagram/post
  → caption, author, media type, images/video URL
  → If reel: download → ffmpeg frames → Whisper transcript
  → If carousel: download all slide images
  → If single image: download display_url
  → Also try /v2/instagram/media/transcript
  → All images/frames + caption + transcript → OpenRouter vision → place extraction JSON
```

### Generic URL Flow (working)
```
URL → fetch + Cheerio
  → Extract title, description, OG image, body text (3000 char cap)
  → If OG image: fetch + base64 → vision model
  → Else: text model only
  → Place extraction JSON
```

### Image Upload Flow (working)
```
File → base64 → data URL → vision model → place extraction JSON
```

## LLM Output Shape (current — NOT Zod-validated)
The vision/text model returns freeform JSON, extracted via regex (`/\{[\s\S]*\}/`):
```json
{
  "places": [
    {
      "name": "string",
      "location_hint": "string",
      "category": "food | accommodation | activity | ...",
      "confidence": "high | medium | low",
      "details": "string",
      "source_clue": "string (vision only)"
    }
  ],
  "location_context": "string",
  "content_type": "string (vision only)",
  "raw_text_visible": "string (vision only)",
  "usefulness_score": 1-10,
  "usefulness_note": "string"
}
```

## What Needs Google Maps Integration

After LLM extraction produces place names, each needs:
1. **Text Search** → `place_id`, canonical name, address, coordinates
2. **Place Details** → hours, rating, review_count, price_level, photos, category
3. Places that don't resolve → keep with `verified: false`
4. Enrichment failures → keep with `enrichment_status: 'failed'`

### Google Maps Places API (New) Endpoints Needed
- `POST https://places.googleapis.com/v1/places:searchText` — text search
- `GET https://places.googleapis.com/v1/places/{place_id}` — place details

## Quality / Hallucination Guards (planned)
- Zod-validate all LLM outputs before passing downstream
- Cross-check `hours` before scheduling — flag if closed on scheduled day
- Places with no Maps match → `verified: false` (never drop)
- Enrichment failure → `enrichment_status: 'failed'` + warning
- Never invent addresses, phone numbers, hours — only Maps API data

## Cost Model
- Vision model (Qwen 3.5 Flash): $0.065/M input, $0.26/M output
- Per TikTok analysis with ~15 frames: estimated $0.001–0.003
- Google Maps text search: $0.032/request (first 100K/month)
- Google Maps place details: $0.017/request (basic) to $0.025/request (contact/atmosphere)
- Whisper: $0.006/minute of audio

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| (none blocking yet) | — |

---
*Update this file after every 2 view/browser/search operations*
