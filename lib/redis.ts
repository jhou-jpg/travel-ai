import { Redis } from "@upstash/redis";

/**
 * Lazy-initialized Upstash Redis client.
 * Returns null when env vars are missing (local dev without Redis).
 */
let _redis: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn("[redis] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set — persistence disabled");
    _redis = null;
    return null;
  }

  _redis = new Redis({ url, token });
  return _redis;
}

// ── Key helpers ──

const PREFIX = "travelai";

/** Session → collection key */
export function collectionKey(sessionId: string) {
  return `${PREFIX}:col:${sessionId}`;
}

/** Session → chat history key */
export function chatKey(sessionId: string) {
  return `${PREFIX}:chat:${sessionId}`;
}

/** Session → user preferences key */
export function prefsKey(sessionId: string) {
  return `${PREFIX}:prefs:${sessionId}`;
}

/** Share slug → shared trip data */
export function shareKey(slug: string) {
  return `${PREFIX}:share:${slug}`;
}

// ── TTLs (seconds) ──

/** User collections persist 180 days */
export const COLLECTION_TTL = 180 * 24 * 60 * 60;

/** Chat history persists 30 days */
export const CHAT_TTL = 30 * 24 * 60 * 60;

/** Shared trips persist 30 days */
export const SHARE_TTL = 30 * 24 * 60 * 60;
