"use client";

import { useState, useCallback, useEffect, useRef } from "react";

// ── Types ──

type EnrichedPlace = {
  name: string;
  location_hint?: string;
  category?: string;
  confidence: string;
  details?: string;
  source_clue?: string;
  place_id?: string;
  verified: boolean;
  canonical_name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  maps_url?: string;
  enrichment_status: "success" | "failed" | "skipped";
  rating?: number;
  review_count?: number;
  price_level?: string;
  phone?: string;
  website?: string;
  google_maps_category?: string;
  photo_url?: string;
  hours?: string[];
  open_now?: boolean;
};

type TripSource = {
  id: string;
  type: "url" | "image";
  label: string;
  addedAt: number;
  placeCount: number;
  mode: string; // tiktok, instagram, url, image
};

type TripState = {
  sources: TripSource[];
  places: EnrichedPlace[];
};

const STORAGE_KEY = "travel-ai-trip";

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Deduplicate key: place_id for verified, lowercase name+hint for unverified */
function placeKey(p: EnrichedPlace): string {
  if (p.place_id) return `pid:${p.place_id}`;
  const name = (p.canonical_name || p.name).toLowerCase().trim();
  const hint = (p.location_hint || "").toLowerCase().trim();
  return `name:${name}|${hint}`;
}

function mergePlaces(
  existing: EnrichedPlace[],
  incoming: EnrichedPlace[]
): EnrichedPlace[] {
  const seen = new Map<string, EnrichedPlace>();
  for (const p of existing) {
    seen.set(placeKey(p), p);
  }
  for (const p of incoming) {
    const key = placeKey(p);
    if (!seen.has(key)) {
      seen.set(key, p);
    }
    // If duplicate, keep the one with richer data (more fields populated)
  }
  return Array.from(seen.values());
}

// ── Persistence ──

function loadTrip(): TripState {
  if (typeof window === "undefined") return { sources: [], places: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { sources: [], places: [] };
}

function saveTrip(state: TripState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// ── Component ──

export default function Home() {
  const [mode, setMode] = useState<"url" | "image">("url");
  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [trip, setTrip] = useState<TripState>({ sources: [], places: [] });
  const initialized = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setTrip(loadTrip());
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (initialized.current) {
      saveTrip(trip);
    }
  }, [trip]);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      setError("Please upload an image file");
      return;
    }
    setFile(f);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const addSource = async () => {
    setLoading(true);
    setError(null);

    try {
      let response: Response;
      let label: string;

      if (mode === "image" && file) {
        const formData = new FormData();
        formData.append("image", file);
        response = await fetch("/api/analyze", {
          method: "POST",
          body: formData,
        });
        label = file.name;
      } else if (mode === "url" && url.trim()) {
        response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
        label = url.trim();
      } else {
        setError(mode === "image" ? "Upload an image first" : "Enter a URL");
        setLoading(false);
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Analysis failed");
        return;
      }

      const newPlaces: EnrichedPlace[] = data.enriched_places || [];

      const source: TripSource = {
        id: generateId(),
        type: mode,
        label,
        addedAt: Date.now(),
        placeCount: newPlaces.length,
        mode: data.mode || mode,
      };

      setTrip((prev) => ({
        sources: [...prev.sources, source],
        places: mergePlaces(prev.places, newPlaces),
      }));

      // Reset input for next addition
      setUrl("");
      setFile(null);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const removePlace = (index: number) => {
    setTrip((prev) => ({
      ...prev,
      places: prev.places.filter((_, i) => i !== index),
    }));
  };

  const removeSource = (sourceId: string) => {
    setTrip((prev) => ({
      ...prev,
      sources: prev.sources.filter((s) => s.id !== sourceId),
    }));
  };

  const clearTrip = () => {
    setTrip({ sources: [], places: [] });
    localStorage.removeItem(STORAGE_KEY);
  };

  const hasPlaces = trip.places.length > 0;
  const hasSources = trip.sources.length > 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-1">Travel AI</h1>
            <p className="text-zinc-400">
              Drop TikToks, screenshots, and links — we&apos;ll find the places.
            </p>
          </div>
          {hasSources && (
            <button
              onClick={clearTrip}
              className="text-xs text-zinc-600 hover:text-red-400 transition px-3 py-1.5 rounded border border-zinc-800 hover:border-red-800"
            >
              New trip
            </button>
          )}
        </div>

        {/* ── Input Section ── */}
        <div className="mb-8">
          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode("url")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                mode === "url"
                  ? "bg-white text-black"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              Paste URL
            </button>
            <button
              onClick={() => setMode("image")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                mode === "image"
                  ? "bg-white text-black"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              Upload Image
            </button>
          </div>

          {/* Input area */}
          {mode === "url" ? (
            <div className="flex gap-3">
              <input
                type="url"
                placeholder="Paste a TikTok, Instagram, or travel blog URL..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && addSource()}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500"
              />
              <button
                onClick={addSource}
                disabled={loading || !url.trim()}
                className="px-6 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-medium rounded-lg transition"
              >
                {loading ? "..." : "Add"}
              </button>
            </div>
          ) : (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() =>
                  document.getElementById("file-input")?.click()
                }
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                  dragOver
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-zinc-700 hover:border-zinc-500"
                }`}
              >
                <input
                  id="file-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                {preview ? (
                  <div className="flex flex-col items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview}
                      alt="Preview"
                      className="max-h-48 rounded-lg"
                    />
                    <p className="text-sm text-zinc-400">
                      Click or drag to replace
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-zinc-300 mb-1">
                      Drop a screenshot here or click to upload
                    </p>
                    <p className="text-sm text-zinc-500">
                      Screenshots from TikTok, Instagram, or travel content
                    </p>
                  </div>
                )}
              </div>
              {file && (
                <button
                  onClick={addSource}
                  disabled={loading}
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-medium py-3 rounded-lg transition"
                >
                  {loading ? "Analyzing..." : "Add screenshot"}
                </button>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Loading indicator */}
          {loading && (
            <div className="mt-3 p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 text-sm animate-pulse">
              Analyzing content and resolving places on Google Maps...
            </div>
          )}
        </div>

        {/* ── Sources ── */}
        {hasSources && (
          <div className="mb-8">
            <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide mb-3">
              Sources ({trip.sources.length})
            </h2>
            <div className="space-y-2">
              {trip.sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 rounded-lg border border-zinc-800"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 flex-shrink-0">
                      {source.mode}
                    </span>
                    <span className="text-sm text-zinc-300 truncate">
                      {source.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-zinc-500">
                      {source.placeCount} place
                      {source.placeCount !== 1 && "s"}
                    </span>
                    <button
                      onClick={() => removeSource(source.id)}
                      className="text-zinc-600 hover:text-red-400 transition text-xs"
                    >
                      remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Accumulated Places ── */}
        {hasPlaces && (
          <div className="mb-8">
            <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide mb-3">
              Places ({trip.places.length})
            </h2>
            <div className="space-y-3">
              {trip.places.map((place, i) => (
                <div
                  key={place.place_id || `${place.name}-${i}`}
                  className={`p-4 bg-zinc-900 rounded-lg border ${
                    place.verified
                      ? "border-zinc-800"
                      : "border-yellow-800/50"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {place.photo_url && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={place.photo_url}
                          alt={place.canonical_name || place.name}
                          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <h3 className="font-medium text-zinc-100">
                          {place.maps_url ? (
                            <a
                              href={place.maps_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-blue-400 transition"
                            >
                              {place.canonical_name || place.name} &rarr;
                            </a>
                          ) : (
                            place.name
                          )}
                        </h3>
                        {place.address && (
                          <p className="text-xs text-zinc-500 truncate">
                            {place.address}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {(place.google_maps_category || place.category) && (
                        <span className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400">
                          {place.google_maps_category || place.category}
                        </span>
                      )}
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          place.verified
                            ? "bg-green-900/50 text-green-400"
                            : "bg-yellow-900/50 text-yellow-400"
                        }`}
                      >
                        {place.verified ? "verified" : "unverified"}
                      </span>
                      <button
                        onClick={() => removePlace(i)}
                        className="text-zinc-600 hover:text-red-400 transition ml-1"
                        title="Remove place"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Rating + price + open status */}
                  {(place.rating ||
                    place.price_level ||
                    place.open_now !== undefined) && (
                    <div className="flex items-center gap-3 text-sm mb-2">
                      {place.rating && (
                        <span className="text-yellow-400">
                          {"★".repeat(Math.round(place.rating))}{" "}
                          <span className="text-zinc-400">
                            {place.rating}
                            {place.review_count && (
                              <span>
                                {" "}
                                ({place.review_count.toLocaleString()})
                              </span>
                            )}
                          </span>
                        </span>
                      )}
                      {place.price_level && (
                        <span className="text-zinc-400">
                          {place.price_level}
                        </span>
                      )}
                      {place.open_now !== undefined && (
                        <span
                          className={
                            place.open_now
                              ? "text-green-400"
                              : "text-red-400"
                          }
                        >
                          {place.open_now ? "Open now" : "Closed"}
                        </span>
                      )}
                    </div>
                  )}

                  {place.details && (
                    <p className="text-sm text-zinc-300 mt-1">
                      {place.details}
                    </p>
                  )}

                  {/* Links row */}
                  <div className="flex gap-3 mt-2 text-xs">
                    {place.maps_url && (
                      <a
                        href={place.maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Google Maps
                      </a>
                    )}
                    {place.website && (
                      <a
                        href={place.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Website
                      </a>
                    )}
                    {place.phone && (
                      <span className="text-zinc-500">{place.phone}</span>
                    )}
                  </div>

                  {/* Hours (collapsed) */}
                  {place.hours && place.hours.length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300">
                        Hours
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-zinc-400">
                        {place.hours.map((h, j) => (
                          <li key={j}>{h}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {!place.verified && (
                    <p className="text-xs text-yellow-600 mt-2">
                      Could not verify on Google Maps
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Plan My Trip CTA ── */}
        {hasPlaces && (
          <div className="sticky bottom-6">
            <button
              disabled
              className="w-full bg-zinc-800 text-zinc-500 font-medium py-4 rounded-xl text-lg cursor-not-allowed"
            >
              Plan my trip — coming soon
            </button>
            <p className="text-center text-xs text-zinc-600 mt-2">
              {trip.places.length} place{trip.places.length !== 1 && "s"} from{" "}
              {trip.sources.length} source{trip.sources.length !== 1 && "s"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
