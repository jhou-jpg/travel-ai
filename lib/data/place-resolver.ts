import type { ExtractedPlace, ResolvedPlace } from "./schemas";

const PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

type TextSearchResult = {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    googleMapsUri?: string;
  }>;
};

type LocationBias = { lat: number; lng: number; radiusMeters: number };

/**
 * Geocode a location context string (e.g. "Shinjuku, Tokyo") into coordinates
 * by running a text search for the area itself.
 */
async function geocodeContext(
  locationContext: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location",
      },
      body: JSON.stringify({
        textQuery: locationContext,
        maxResultCount: 1,
      }),
    });

    if (!res.ok) return null;
    const data: TextSearchResult = await res.json();
    const loc = data.places?.[0]?.location;
    if (loc) {
      console.log(
        `[place-resolver] Geocoded "${locationContext}" → ${loc.latitude}, ${loc.longitude}`
      );
      return { lat: loc.latitude, lng: loc.longitude };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a single extracted place against Google Maps Text Search.
 * Uses locationBias to prefer nearby results (avoids wrong chain branches).
 */
async function resolveOne(
  place: ExtractedPlace,
  locationContext?: string,
  bias?: LocationBias
): Promise<ResolvedPlace> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { ...place, verified: false } as ResolvedPlace;
  }

  // Build a search query: "place name, location hint" or "place name, location context"
  const hint = place.location_hint || locationContext || "";
  const query = hint ? `${place.name}, ${hint}` : place.name;

  // Build request body with optional locationBias for chain disambiguation
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 1,
  };

  if (bias) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.lat, longitude: bias.lng },
        radius: bias.radiusMeters,
      },
    };
  }

  try {
    const res = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(
        `[place-resolver] Maps API error for "${query}": ${res.status} ${await res.text()}`
      );
      return { ...place, verified: false };
    }

    const data: TextSearchResult = await res.json();
    const match = data.places?.[0];

    if (!match) {
      console.log(`[place-resolver] No match for "${query}"`);
      return { ...place, verified: false };
    }

    return {
      ...place,
      place_id: match.id,
      verified: true,
      canonical_name: match.displayName?.text,
      address: match.formattedAddress,
      lat: match.location?.latitude,
      lng: match.location?.longitude,
      maps_url: match.googleMapsUri,
    };
  } catch (err) {
    console.error(`[place-resolver] Error resolving "${query}":`, err);
    return { ...place, verified: false };
  }
}

/**
 * Resolve all extracted places against Google Maps.
 * Geocodes locationContext first to bias searches toward the right area
 * (prevents chain restaurants from resolving to the wrong branch).
 * Never drops a place — unresolved ones get verified: false.
 */
export async function resolvePlaces(
  places: ExtractedPlace[],
  locationContext?: string
): Promise<ResolvedPlace[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  // Step 1: Geocode the location context to get a center point for biasing
  let bias: LocationBias | undefined;
  if (locationContext && apiKey) {
    const center = await geocodeContext(locationContext, apiKey);
    if (center) {
      // 10km radius — tight enough to prefer the right chain branch,
      // wide enough to not exclude places in the same city
      bias = { ...center, radiusMeters: 10000 };
    }
  }

  // Step 2: Resolve all places in parallel with the location bias
  const results = await Promise.all(
    places.map((p) => resolveOne(p, locationContext, bias))
  );
  return results;
}
