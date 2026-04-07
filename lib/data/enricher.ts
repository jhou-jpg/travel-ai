import type { ResolvedPlace, EnrichedPlace } from "./schemas";

const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";

// Price level enum from Google Maps → human-readable
const PRICE_LABELS: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

type PlaceDetailsResult = {
  displayName?: { text: string };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  primaryTypeDisplayName?: { text: string };
  currentOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  photos?: Array<{ name: string }>;
};

/**
 * Build a photo URL from a Google Maps photo resource name.
 */
function photoUrl(photoName: string, apiKey: string, maxWidth = 400): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${apiKey}`;
}

/**
 * Enrich a single resolved place with Google Maps Place Details.
 * If it's unverified (no place_id), skip enrichment.
 * If enrichment fails, mark as failed — never drop or hallucinate.
 */
async function enrichOne(place: ResolvedPlace): Promise<EnrichedPlace> {
  if (!place.verified || !place.place_id) {
    return { ...place, enrichment_status: "skipped" };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { ...place, enrichment_status: "failed" };
  }

  try {
    const res = await fetch(`${PLACE_DETAILS_URL}/${place.place_id}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "displayName",
          "rating",
          "userRatingCount",
          "priceLevel",
          "nationalPhoneNumber",
          "websiteUri",
          "primaryTypeDisplayName",
          "currentOpeningHours",
          "regularOpeningHours",
          "photos",
        ].join(","),
      },
    });

    if (!res.ok) {
      console.error(
        `[enricher] Details API error for ${place.place_id}: ${res.status} ${await res.text()}`
      );
      return { ...place, enrichment_status: "failed" };
    }

    const data: PlaceDetailsResult = await res.json();

    const hours =
      data.currentOpeningHours?.weekdayDescriptions ??
      data.regularOpeningHours?.weekdayDescriptions;

    const openNow =
      data.currentOpeningHours?.openNow ??
      data.regularOpeningHours?.openNow;

    const firstPhoto = data.photos?.[0]?.name;

    return {
      ...place,
      enrichment_status: "success",
      rating: data.rating,
      review_count: data.userRatingCount,
      price_level: data.priceLevel
        ? PRICE_LABELS[data.priceLevel] ?? data.priceLevel
        : undefined,
      phone: data.nationalPhoneNumber,
      website: data.websiteUri,
      google_maps_category: data.primaryTypeDisplayName?.text,
      photo_url: firstPhoto ? photoUrl(firstPhoto, apiKey) : undefined,
      hours,
      open_now: openNow,
    };
  } catch (err) {
    console.error(`[enricher] Error enriching ${place.place_id}:`, err);
    return { ...place, enrichment_status: "failed" };
  }
}

/**
 * Enrich all resolved places with Google Maps details.
 * Runs in parallel. Never drops a place.
 */
export async function enrichPlaces(
  places: ResolvedPlace[]
): Promise<EnrichedPlace[]> {
  const results = await Promise.all(places.map((p) => enrichOne(p)));
  return results;
}
