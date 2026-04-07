import { nanoid } from "nanoid";
import { getRedis, shareKey, SHARE_TTL } from "@/lib/redis";
import type { EnrichedPlace, Itinerary } from "@/lib/data/schemas";

type SharePayload = {
  itinerary: Itinerary;
  places: EnrichedPlace[];
  destinationPhoto?: string | null;
};

/** POST — create a shareable link for an itinerary */
export async function POST(request: Request) {
  try {
    const body: SharePayload = await request.json();

    if (!body.itinerary) {
      return Response.json(
        { error: "itinerary required" },
        { status: 400 }
      );
    }

    const redis = getRedis();
    if (!redis) {
      return Response.json(
        { error: "Sharing unavailable — Redis not configured" },
        { status: 503 }
      );
    }

    const slug = nanoid(10);
    await redis.set(
      shareKey(slug),
      {
        itinerary: body.itinerary,
        places: body.places || [],
        destinationPhoto: body.destinationPhoto ?? null,
        createdAt: Date.now(),
      },
      { ex: SHARE_TTL }
    );

    return Response.json({ slug });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
