import { ITINERARY_GENERATION_PROMPT } from "@/lib/prompts/itinerary-generation";
import { ItinerarySchema } from "@/lib/data/schemas";
import type { EnrichedPlace, Itinerary } from "@/lib/data/schemas";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_MODEL = "qwen/qwen3.5-flash-02-23";

type PlanRequest = {
  places: EnrichedPlace[];
  duration: number; // 3, 5, or 7
  pace: "relaxed" | "balanced" | "packed";
};

function buildPlaceSummary(places: EnrichedPlace[]): string {
  return places
    .map((p, i) => {
      const parts = [
        `${i + 1}. ${p.canonical_name || p.name}`,
        p.address && `   Address: ${p.address}`,
        p.google_maps_category && `   Category: ${p.google_maps_category}`,
        p.category && !p.google_maps_category && `   Category: ${p.category}`,
        p.rating && `   Rating: ${p.rating}/5 (${p.review_count || 0} reviews)`,
        p.price_level && `   Price: ${p.price_level}`,
        p.hours && p.hours.length > 0 && `   Hours: ${p.hours.join("; ")}`,
        p.details && `   Notes: ${p.details}`,
        p.place_id && `   place_id: ${p.place_id}`,
        p.verified ? "   [VERIFIED on Google Maps]" : "   [UNVERIFIED]",
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function extractJSON(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(request: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json(
      { error: "OPENROUTER_API_KEY not set" },
      { status: 500 }
    );
  }

  try {
    const body: PlanRequest = await request.json();
    const { places, duration, pace } = body;

    if (!places || places.length === 0) {
      return Response.json(
        { error: "No places provided" },
        { status: 400 }
      );
    }

    const placeSummary = buildPlaceSummary(places);

    const userPrompt = `Here are ${places.length} places for a trip:

${placeSummary}

Generate a ${duration}-day itinerary with a ${pace} pace.

You MUST respond with ONLY a valid JSON object, no other text.`;

    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Travel AI Itinerary",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: ITINERARY_GENERATION_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const parsed = extractJSON(text);

    if (!parsed) {
      return Response.json(
        {
          error: "Failed to parse itinerary JSON from model",
          raw_response: text,
        },
        { status: 500 }
      );
    }

    // Validate with Zod
    const result = ItinerarySchema.safeParse(parsed);

    let itinerary: Itinerary;
    if (result.success) {
      itinerary = result.data;
    } else {
      console.error("[plan] Zod validation failed:", result.error.issues);
      // Use raw parsed if shape is close enough
      itinerary = parsed as Itinerary;
    }

    // Cross-reference place data: attach photo_url and maps_url from enriched places
    const placeMap = new Map<string, EnrichedPlace>();
    for (const p of places) {
      // Index by multiple keys for fuzzy matching
      if (p.place_id) placeMap.set(p.place_id, p);
      placeMap.set((p.canonical_name || p.name).toLowerCase(), p);
      placeMap.set(p.name.toLowerCase(), p);
    }

    for (const day of itinerary.days) {
      for (const stop of day.stops) {
        const match =
          (stop.place_id && placeMap.get(stop.place_id)) ||
          placeMap.get(stop.place_name.toLowerCase());

        if (match) {
          // Ensure place_id is set
          if (!stop.place_id && match.place_id) {
            stop.place_id = match.place_id;
          }
        }
      }
    }

    // Fetch a hero photo for the destination via Google Maps
    let destination_photo_url: string | null = null;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (mapsKey && itinerary.destination) {
      try {
        const searchRes = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": mapsKey,
              "X-Goog-FieldMask": "places.photos",
            },
            body: JSON.stringify({
              textQuery: itinerary.destination,
              maxResultCount: 1,
            }),
          }
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const photoName = searchData.places?.[0]?.photos?.[0]?.name;
          if (photoName) {
            destination_photo_url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200&key=${mapsKey}`;
          }
        }
      } catch {
        // Non-critical — skip hero photo
      }
    }

    return Response.json({
      itinerary,
      destination_photo_url,
      raw_response: text,
      tokens_used: data.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
