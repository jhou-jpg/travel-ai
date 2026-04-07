import {
  getRedis,
  collectionKey,
  prefsKey,
  COLLECTION_TTL,
} from "./redis";
import type { EnrichedPlace } from "./data/schemas";

// ── Types ──

export type UserPreferences = {
  travelStyle?: string;   // "foodie", "adventure", "culture", "relaxed"
  budget?: string;        // "budget", "mid-range", "luxury"
  pace?: string;          // "relaxed", "balanced", "packed"
  companions?: string;    // "solo", "couple", "friends", "family"
  interests?: string[];   // free-form interests extracted from chat
};

export type UserCollection = {
  places: EnrichedPlace[];
  preferences: UserPreferences;
  updatedAt: number;
};

// ── CRUD operations ──

export async function getCollection(
  sessionId: string
): Promise<UserCollection | null> {
  const redis = getRedis();
  if (!redis) return null;

  const data = await redis.get<UserCollection>(collectionKey(sessionId));
  return data ?? null;
}

export async function saveCollection(
  sessionId: string,
  places: EnrichedPlace[]
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const existing = await getCollection(sessionId);
  const collection: UserCollection = {
    places,
    preferences: existing?.preferences ?? {},
    updatedAt: Date.now(),
  };

  await redis.set(collectionKey(sessionId), collection, {
    ex: COLLECTION_TTL,
  });
}

export async function getPreferences(
  sessionId: string
): Promise<UserPreferences> {
  const redis = getRedis();
  if (!redis) return {};

  const data = await redis.get<UserPreferences>(prefsKey(sessionId));
  return data ?? {};
}

export async function savePreferences(
  sessionId: string,
  prefs: UserPreferences
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  await redis.set(prefsKey(sessionId), prefs, { ex: COLLECTION_TTL });
}
