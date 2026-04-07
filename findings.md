# Findings & Decisions — Travel AI

## Competitive Research (2026-04-07)

### Direct Competitors

**Mindtrip (mindtrip.ai)** — Most polished competitor
- "Start Anywhere": accepts screenshots, photos, PDFs, Google Maps imports, email forwarding
- TikTok support confirmed by TechCrunch (July 2024) but unclear depth — likely caption-only
- Collaborative boards, collections by "vibe", creator program
- Ex-Apple/Google/LinkedIn team. Free app.
- Source: https://techcrunch.com/2024/07/31/travel-startup-mindtrips-new-feature-lets-you-build-an-itinerary-from-a-screenshot-youtube-or-tiktok-video/

**Reelstrip (reelstrip.com)** — Closest direct competitor
- "Copy TikTok URL, paste into our app" — TikTok, Instagram Reels, YouTube Shorts
- Browser extension for one-click save from Instagram
- Claims to analyze "video content, captions, and audio" — but no technical specifics
- Likely just caption parsing + Google Maps lookup
- Source: https://reelstrip.com/tiktok-travel-planner

**Airial** — Ex-Meta engineers, logistics-focused
- "Add a link to a blog, a TikTok, or a Reel"
- Focuses on flights, hotels, multi-city transport
- Uses Claude Sonnet + GPT-3
- Source: https://techcrunch.com/2025/06/30/former-meta-engineers-airial-travel-tool-helps-travelers-solve-logistics-planning-with-ai/

**Layla (layla.ai)** — Absorbed Roam Around
- Chat-based, 10M+ itineraries, live pricing for flights/hotels
- Supports PDF/photo attachments (booking confirmations)
- No social media URL ingestion

**Wanderlog (wanderlog.com)** — Traditional planner, no AI ingestion
- 1M+ users, ~$40/yr Pro. Drag-and-drop, collaboration, expense tracking
- No TikTok/Instagram support at all

**Wanderplan** — Dead. Domain parked for sale at $30K.

### How Competitors Handle "Video Ingestion"
**Key finding: They don't actually watch videos. They read captions.**

TikTok's oEmbed API returns the caption in the `title` field + author + thumbnail. That's what most competitors parse. No evidence any shipping product does:
- Video frame extraction
- Audio transcription via Whisper
- Vision analysis of signage/food/landmarks

A Nexla blog post describes the real multimodal pipeline (frame sampling + Whisper + vision LLM) as a reference architecture, but no shipping consumer product implements it.
Source: https://nexla.com/blog/ai-video-travel-itinerary-pipeline/

### Our Differentiator
Our pipeline is the only shipping implementation that actually watches the video:
```
Competitors:  URL → oEmbed → caption text → LLM → place names
Us:           URL → download video → ffmpeg frames → vision model + Whisper → deep extraction
```
Example: Creator captions "tokyo food tour" but video shows sign "麺屋一燈" and voiceover says "Michelin-starred ramen in Shinjuku." Competitors get "tokyo food tour." We get "Menya Itto, Michelin-starred, Shinjuku."

### Competitive Gaps We Need to Close
1. **Shareable links** — every competitor has this, we don't yet
2. **Browser extension** — Reelstrip has one-click save from TikTok/IG
3. **Chat-based planning** — Mindtrip and Layla do this
4. **Booking integration** — Layla and Airial link to actual bookings

## Architecture: What Actually Exists

### Actual Stack
- **Framework:** Next.js 16 + React 19 + TypeScript strict + Tailwind CSS v4
- **LLM:** OpenRouter API → Qwen 3.5 Flash (vision + text)
- **Video scraping:** ScrapCreators API (TikTok + Instagram)
- **Audio transcription:** OpenAI Whisper
- **Video frames:** ffmpeg (local, ~0.5fps, up to 60 frames)
- **URL scraping:** Cheerio (generic URLs)
- **Maps:** Google Maps Places API (New) — Text Search + Place Details
- **Maps UI:** @vis.gl/react-google-maps (interactive, zoomable)
- **Storage:** localStorage (client-side, no auth yet)
- **Validation:** Zod for all LLM outputs

### Environment Variables
```
OPENROUTER_API_KEY          — LLM provider
OPENAI_API_KEY              — Whisper transcription
GOOGLE_MAPS_API_KEY         — Places API (server-side)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — Maps JS API (client-side)
SCRAPECREATORS_API_KEY      — TikTok + Instagram data
```

### Cost Model
- Vision (Qwen 3.5 Flash): $0.065/M input, $0.26/M output
- Per TikTok analysis with ~15 frames: ~$0.001-0.003
- Google Maps text search: $0.032/request
- Google Maps place details: $0.017-0.025/request
- Whisper: $0.006/minute audio

## Product Vision (2026-04-07)

### Current: Single-session trip builder
Add sources → review places → generate itinerary → share link

### Future: Mindtrip-style persistent collections + chat
1. Users passively save TikToks/screenshots over weeks/months → builds knowledge base
2. When planning a real trip, chat with AI that references their entire collection
3. Conversational, iterative planning ("swap day 2 lunch", "add a cafe near Shibuya")

### Approach: Polish locally first, add auth later
Get the core experience right (ingestion quality, generation quality, sharing) before introducing user accounts and persistent storage.

---
*Last updated: 2026-04-07*
