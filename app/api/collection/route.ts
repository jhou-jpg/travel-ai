import { getSessionId } from "@/lib/session";
import { getCollection, saveCollection } from "@/lib/collections";
import type { EnrichedPlace } from "@/lib/data/schemas";

/** GET — fetch the user's saved collection */
export async function GET() {
  try {
    const sessionId = await getSessionId();
    const collection = await getCollection(sessionId);

    return Response.json({
      places: collection?.places ?? [],
      preferences: collection?.preferences ?? {},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** POST — sync places to the user's collection */
export async function POST(request: Request) {
  try {
    const sessionId = await getSessionId();
    const body: { places: EnrichedPlace[] } = await request.json();

    if (!body.places || !Array.isArray(body.places)) {
      return Response.json(
        { error: "places array required" },
        { status: 400 }
      );
    }

    await saveCollection(sessionId, body.places);

    return Response.json({ ok: true, count: body.places.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
