import { z } from "zod";

// ── LLM extraction output (from vision/text analysis) ──

export const ExtractedPlaceSchema = z.object({
  name: z.string(),
  location_hint: z.string().optional(),
  category: z
    .enum([
      "food",
      "accommodation",
      "activity",
      "shopping",
      "nightlife",
      "scenic",
      "other",
    ])
    .optional(),
  confidence: z.enum(["high", "medium", "low"]),
  details: z.string().optional(),
  source_clue: z.string().optional(),
});

export const ExtractionResultSchema = z.object({
  places: z.array(ExtractedPlaceSchema).default([]),
  location_context: z.string().optional(),
  content_type: z.string().optional(),
  raw_text_visible: z.string().optional(),
  usefulness_score: z.number().min(1).max(10).optional(),
  usefulness_note: z.string().optional(),
  raw_summary: z.string().optional(),
});

export type ExtractedPlace = z.infer<typeof ExtractedPlaceSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ── After Google Maps resolution ──

export const ResolvedPlaceSchema = ExtractedPlaceSchema.extend({
  place_id: z.string().optional(),
  verified: z.boolean(),
  canonical_name: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  maps_url: z.string().optional(),
});

export type ResolvedPlace = z.infer<typeof ResolvedPlaceSchema>;

// ── After Google Maps enrichment ──

export const EnrichedPlaceSchema = ResolvedPlaceSchema.extend({
  enrichment_status: z.enum(["success", "failed", "skipped"]),
  rating: z.number().optional(),
  review_count: z.number().optional(),
  price_level: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  google_maps_category: z.string().optional(),
  photo_url: z.string().optional(),
  hours: z
    .array(z.string())
    .optional(),
  open_now: z.boolean().optional(),
});

export type EnrichedPlace = z.infer<typeof EnrichedPlaceSchema>;

// ── Itinerary (LLM-generated day-by-day plan) ──

export const ItineraryStopSchema = z.object({
  place_name: z.string(),
  place_id: z.string().optional(),
  time: z.string(),
  duration_minutes: z.number(),
  editorial_note: z.string(),
  label: z.string().optional(),
});

export const ItineraryDaySchema = z.object({
  day: z.number(),
  title: z.string(),
  description: z.string(),
  stops: z.array(ItineraryStopSchema),
});

export const ItinerarySchema = z.object({
  destination: z.string(),
  days: z.array(ItineraryDaySchema),
});

export type ItineraryStop = z.infer<typeof ItineraryStopSchema>;
export type ItineraryDay = z.infer<typeof ItineraryDaySchema>;
export type Itinerary = z.infer<typeof ItinerarySchema>;
